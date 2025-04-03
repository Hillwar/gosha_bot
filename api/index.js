/**
 * Gosha Bot - Telegram бот для песен с аккордами
 */

// Зависимости
require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const path = require('path');

// Константы
const MAX_MESSAGE_LENGTH = 4000;

// Express приложение
const app = express();
app.use(express.json());

// Состояния, кеши и статистика
const userStates = new Map();
const userSongCache = new Map();
const docCache = {
  content: null,
  lastUpdate: null,
  updateInterval: 5 * 60 * 1000 // 5 минут
};

const stats = {
  songViews: {},
  commandsUsed: {},
  callbacksUsed: {},
  userActivity: {},
  lastReset: Date.now()
};

// Инициализация Google API
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/documents.readonly']
});

const docs = google.docs({ version: 'v1', auth });

// Инициализация Telegram Bot
let bot;
if (process.env.NODE_ENV === 'production') {
  // В продакшн используем webhook
  bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
  console.log('Бот запущен в режиме webhook');
} else {
  // В разработке используем polling
  bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
  console.log('Бот запущен в режиме polling');
}

// Регистрация обработчиков команд
bot.onText(/\/start/, handleStartCommand);
bot.onText(/\/help/, handleHelpCommand);
bot.onText(/\/list/, handleListCommand);
bot.onText(/\/random/, handleRandomCommand);
bot.onText(/\/search(?:\s+(.+))?/, handleSearchCommand);
bot.onText(/\/circlerules/, handleCircleRulesCommand);

// Регистрация обработчика текстовых сообщений
bot.on('message', msg => { if (msg.text && !msg.text.startsWith('/')) handleTextMessage(msg); });

// Регистрация обработчика callback-запросов
bot.on('callback_query', handleCallbackQuery);

// Запуск сервера
const PORT = process.env.PORT || 3333;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));

// API эндпоинт для вебхука
app.post('/api/webhook', (req, res) => {
  if (req.body.message || req.body.callback_query) {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } else {
    res.sendStatus(400);
  }
});

/**
 * ОСНОВНЫЕ ФУНКЦИИ
 */

/**
 * Получение документа и извлечение песен
 */
async function getSongs() {
  try {
    const document = await getDocumentContent();
    const songs = [];
    let currentSong = null;
    let nextLineIsAuthor = false;
    
    for (const element of document.body.content) {
      if (element.paragraph) {
        const text = extractParagraphText(element.paragraph);
        
        if (text.includes('♭')) {
          // Сохраняем предыдущую песню, если была
          if (currentSong) songs.push(currentSong);
          
          // Начинаем новую песню
          const cleanTitle = text.replace('♭', '').trim();
          currentSong = { title: cleanTitle, author: '', fullText: text };
          nextLineIsAuthor = true; // Следующая строка будет автором
        } 
        else if (currentSong && nextLineIsAuthor) {
          // Эта строка - автор
          currentSong.author = text.trim();
          currentSong.fullText = currentSong.fullText + text;
          nextLineIsAuthor = false; // Сбрасываем флаг
        }
        else if (currentSong) {
          // Добавляем строку к тексту песни
          currentSong.fullText = currentSong.fullText + text;
        }
      }
    }
    
    // Сохраняем последнюю песню
    if (currentSong) songs.push(currentSong);
    
    return songs.filter(song => song.title && song.title.trim().length > 2);
  } catch (error) {
    console.error('Ошибка получения песен:', error.message);
    return [];
  }
}

/**
 * Получение содержимого документа с кешированием
 */
async function getDocumentContent() {
  try {
    const now = Date.now();
    if (docCache.content && docCache.lastUpdate && (now - docCache.lastUpdate < docCache.updateInterval)) {
      return docCache.content;
    }

    const documentId = process.env.SONGBOOK_URL.includes('/d/') 
      ? process.env.SONGBOOK_URL.split('/d/')[1].split('/')[0]
      : process.env.SONGBOOK_URL;
      
    const document = await docs.documents.get({ documentId });
    docCache.content = document.data;
    docCache.lastUpdate = now;
    return document.data;
  } catch (error) {
    console.error('Ошибка получения документа:', error.message);
    throw error;
  }
}

/**
 * Извлечение текста из параграфа
 */
function extractParagraphText(paragraph) {
  let text = '';
  
  if (paragraph.elements) {
    for (const element of paragraph.elements) {
      if (element.textRun && element.textRun.content) {
        text += element.textRun.content;
      }
    }
  }
  
  return text;
}

/**
 * Обработка команды поиска
 */
async function handleSearchCommand(msg, match) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const query = match && match[1] ? match[1].trim() : '';
  
  if (query) {
    await performSearch(msg, query);
  } else {
    await bot.sendMessage(chatId, 'Введите название или текст песни:');
    userStates.set(userId, { waitingFor: 'search' });
  }
  
  updateStats(userId, '/search');
}

/**
 * Отображение анимированного сообщения загрузки
 * @param {number} chatId - ID чата
 * @param {string} actionText - Текст действия (например, "Ищу песню")
 * @param {number} [duration=5000] - Максимальная длительность анимации в мс
 * @returns {Promise<Object>} - Объект сообщения для последующего редактирования/удаления
 */
async function showAnimatedLoading(chatId, actionText, duration = 5000) {
  // Варианты анимации
  const animationSets = {
    // Прогресс-бар с эмодзи
    progressBar: [
      '🔍 ⬜⬜⬜⬜⬜ 0%',
      '🔍 🟦⬜⬜⬜⬜ 20%',
      '🔍 🟦🟦⬜⬜⬜ 40%',
      '🔍 🟦🟦🟦⬜⬜ 60%',
      '🔍 🟦🟦🟦🟦⬜ 80%',
      '🔍 🟦🟦🟦🟦🟦 100%'
    ],
    
    // Вращающийся спиннер
    spinner: [
      '🎵 ◐ Загрузка...',
      '🎵 ◓ Загрузка...',
      '🎵 ◑ Загрузка...',
      '🎵 ◒ Загрузка...'
    ],
    
    // Мигающие ноты
    notes: [
      '🎵 ♪ ♪ ♪',
      '♪ 🎵 ♪ ♪',
      '♪ ♪ 🎵 ♪',
      '♪ ♪ ♪ 🎵'
    ],
  
    // Музыкальные инструменты
    instruments: [
      '🎸 Поиск...',
      '🎹 Поиск...',
      '🎤 Поиск...',
      '🥁 Поиск...',
      '🎻 Поиск...',
      '🎺 Поиск...'
    ]
  };
  
  // Выбираем случайный набор анимации
  const animationKeys = Object.keys(animationSets);
  const selectedAnimation = animationSets[animationKeys[Math.floor(Math.random() * animationKeys.length)]];
  
  // Отправляем начальное сообщение
  const message = await bot.sendMessage(
    chatId, 
    `${selectedAnimation[0]} ${actionText}...`
  );
  
  let currentFrame = 0;
  const startTime = Date.now();
  
  // Запускаем интервал обновления
  const intervalId = setInterval(async () => {
    // Проверяем, не превысили ли мы максимальную длительность
    if (Date.now() - startTime >= duration) {
      clearInterval(intervalId);
      return;
    }
    
    // Увеличиваем номер кадра
    currentFrame = (currentFrame + 1) % selectedAnimation.length;
    
    try {
      // Обновляем сообщение
      await bot.editMessageText(
        `${selectedAnimation[currentFrame]} ${actionText}...`,
        {
          chat_id: chatId,
          message_id: message.message_id
        }
      );
    } catch (error) {
      // Игнорируем ошибки при редактировании сообщения
      console.error('Ошибка обновления анимации:', error.message);
      clearInterval(intervalId);
    }
  }, 400);
  
  // Возвращаем сообщение для дальнейшего взаимодействия
  return {
    message,
    stop: () => {
      clearInterval(intervalId);
    }
  };
}

/**
 * Показывает приветственную анимацию
 * @param {number} chatId - ID чата
 * @returns {Promise<void>}
 */
async function showWelcomeAnimation(chatId) {
  const welcomeFrames = [
    '🎵 Привет! Я бот для поиска песен.',
    '🎸 Привет! Я бот для поиска песен..',
    '🎼 Привет! Я бот для поиска песен...',
    '🎤 Привет! Я бот для поиска песен....',
    '🎧 Привет! Я бот для поиска песен.....',
    '🎹 Привет! Я бот для поиска песен......'
  ];
  
  // Отправляем начальное сообщение
  const message = await bot.sendMessage(chatId, welcomeFrames[0]);
  
  // Анимируем в течение нескольких секунд
  for (let i = 1; i < welcomeFrames.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      await bot.editMessageText(welcomeFrames[i], {
        chat_id: chatId,
        message_id: message.message_id
      });
    } catch (error) {
      console.error('Ошибка анимации приветствия:', error.message);
      break;
    }
  }
  
  // Финальное сообщение после анимации
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const commandsList = 
    'Доступные команды:\n' +
    '/search - поиск по названию или тексту\n' +
    '/list - список всех песен\n' +
    '/random - случайная песня\n' +
    '/circlerules - правила круга\n' +
    '/help - справка';
  
  try {
    await bot.editMessageText('🎵 Привет! Я бот для поиска песен.\n\n' + commandsList, {
      chat_id: chatId,
      message_id: message.message_id
    });
  } catch (error) {
    console.error('Ошибка обновления приветствия:', error.message);
  }
}

/**
 * Выполнение поиска песен
 */
async function performSearch(msg, query) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  try {
    // Показываем анимированное сообщение загрузки
    const loadingAnimation = await showAnimatedLoading(chatId, 'Ищу песню');
    
    const songs = await getSongs();
    const results = filterSongs(songs, query);
    
    // Останавливаем анимацию
    loadingAnimation.stop();
    
    if (results.length === 0) {
      await bot.editMessageText('Ничего не найдено. Попробуйте изменить запрос.', {
        chat_id: chatId,
        message_id: loadingAnimation.message.message_id
      });
      return;
    }
    
    if (results.length === 1) {
      const song = results[0];
      
      await bot.deleteMessage(chatId, loadingAnimation.message.message_id);
      await sendSong(chatId, song.title, song.author, song.fullText);
      
      userStates.set(userId, { lastSongTitle: song.title });
      return;
    }
    
    // Несколько результатов - показываем список
    const maxResults = Math.min(results.length, 15);
    const songsToShow = results.slice(0, maxResults);
    
    await bot.editMessageText(
      `Найдено ${results.length} песен${maxResults < results.length ? ' (показаны первые ' + maxResults + ')' : ''}. Выберите:`, 
      {
        chat_id: chatId,
        message_id: loadingAnimation.message.message_id,
        reply_markup: {
          inline_keyboard: songsToShow.map((song, index) => [{
            text: `${song.title}${song.author ? ' - ' + song.author.substring(0, 30) : ''}`,
            callback_data: `song_${index}`
          }])
        }
      }
    );
    
    userSongCache.set(userId, songsToShow);
  } catch (error) {
    console.error('Ошибка поиска:', error.message);
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
  }
}

/**
 * Фильтрация песен по запросу
 */
function filterSongs(songs, query) {
  const normalizedQuery = query.toLowerCase().trim();
  
  return songs.filter(song => 
    song.title.toLowerCase().includes(normalizedQuery) || 
    song.fullText.toLowerCase().includes(normalizedQuery) ||
    (song.author && song.author.toLowerCase().includes(normalizedQuery))
  );
}

/**
 * Отправка песни пользователю
 */
async function sendSong(chatId, title, author, text) {
  try {
    const formattedText = formatSongForDisplay(title, author, text);
    await sendLongMessage(chatId, formattedText);
    
    // Отправляем ссылку на аккордник после песни
    const songbookUrl = process.env.SONGBOOK_URL || 'https://docs.google.com/document/d/1UPg7HOeYbU-MxG_NlM-w5h-ReLpaaZSNg_cB_KUPaqM/edit';
    await bot.sendMessage(chatId, `<a href="${songbookUrl}">Открыть аккордник</a>`, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  } catch (error) {
    console.error('Ошибка отправки песни:', error.message);
    await bot.sendMessage(chatId, 'Произошла ошибка при отправке песни.');
  }
}

/**
 * Форматирование песни для отображения
 */
function formatSongForDisplay(title, author, text) {
  // Экранирует HTML-теги в тексте
  const escapeHtml = (unsafe) => {
    if (!unsafe) return '';
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };
  
  // Заголовок с красивым форматированием
  let result = `🎵 <b>${escapeHtml(title)}</b>`;
  
  // Добавляем автора, если есть
  if (author && author.trim()) {
    result += `\n🎸 <i>${escapeHtml(author)}</i>`;
  }
  
  // Разбиваем текст на строки
  const lines = text.split('\n');
  
  // Пропускаем первые строки (заголовок и автор)
  let startIndex = 0;
  if (lines.length > 0 && lines[0].includes('♭')) {
    startIndex++;
    // Вторая строка - автор
    if (lines.length > 1) {
      startIndex++;
    }
  }
  
  // Ищем таблицу с метаданными (ритмика, особенности, группа)
  let metadataFound = false;
  let metadataLines = [];
  
  // Просматриваем строки после заголовка и автора для поиска метаданных
  for (let i = startIndex; i < Math.min(startIndex + 10, lines.length); i++) {
    const line = lines[i].trim();
    
    // Ищем строки с метаданными
    if (line.includes('Ритмика:') || line.includes('Особенность:') || line.includes('Группа:')) {
      metadataLines.push(i);
      metadataFound = true;
    } else if (metadataFound && line === '') {
      // Пустая строка после метаданных означает конец таблицы
      break;
    } else if (metadataFound) {
      // Продолжение метаданных
      metadataLines.push(i);
    }
  }
  
  // Если нашли метаданные, форматируем их красиво
  if (metadataFound && metadataLines.length > 0) {
    result += '\n\n<pre>┌─────────────────────────────┐';
    
    for (const lineIndex of metadataLines) {
      const line = lines[lineIndex].trim();
      
      if (line) {
        // Форматируем строки метаданных
        if (line.includes(':')) {
          const [key, value] = line.split(':').map(part => part.trim());
          result += `\n│ <b>${escapeHtml(key)}</b>: ${escapeHtml(value || '-')}`;
        } else {
          result += `\n│ ${escapeHtml(line)}`;
        }
      }
    }
    
    result += '\n└─────────────────────────────┘</pre>';
    
    // Обновляем начальный индекс для текста песни, пропуская метаданные
    startIndex = Math.max(...metadataLines) + 1;
    
    // Пропускаем пустые строки после метаданных
    while (startIndex < lines.length && lines[startIndex].trim() === '') {
      startIndex++;
    }
  } else {
    // Если метаданных нет, просто добавляем разделитель
    result += '\n\n━━━━━━━━━━━━━━━━━━━━━━';
  }
  
  // Добавляем основной текст песни
  let inChordSection = false;
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    
    // Пропускаем пустые строки в начале текста
    if (i === startIndex && line.trim() === '') {
      continue;
    }
    
    // Проверяем, является ли строка аккордами
    const isChordLine = /^[A-G][#b]?(m|maj|dim|aug|sus|add)?[0-9]?(\s+[A-G][#b]?(m|maj|dim|aug|sus|add)?[0-9]?)*$/.test(line.trim());
    
    if (isChordLine) {
      // Форматируем аккорды моноширинным шрифтом
      result += '\n<code>' + escapeHtml(line) + '</code>';
      inChordSection = true;
    } else if (line.trim() === '') {
      // Пустые строки добавляем как есть
      result += '\n' + escapeHtml(line);
      inChordSection = false;
    } else {
      // Текст песни
      if (inChordSection) {
        // Текст под аккордами - обычный
        result += '\n' + escapeHtml(line);
      } else if (line.toLowerCase().trim().startsWith('припев') || 
                line.toLowerCase().trim().startsWith('chorus')) {
        // Выделяем припев
        result += '\n<b>🔄 ' + escapeHtml(line) + '</b>';
      } else if (/^\d+\./.test(line.trim())) {
        // Выделяем куплеты (строки, начинающиеся с цифр и точки)
        result += '\n<b>' + escapeHtml(line) + '</b>';
      } else {
        // Обычный текст
        result += '\n' + escapeHtml(line);
      }
      inChordSection = false;
    }
  }
  
  return result;
}

/**
 * Отправка длинного сообщения по частям
 */
async function sendLongMessage(chatId, text) {
  try {
    const maxLength = MAX_MESSAGE_LENGTH - 300;
    
    // Если укладывается, отправляем целиком
    if (text.length <= maxLength) {
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
      return;
    }
    
    // Разбиваем на строки
    const lines = text.split('\n');
    let currentPart = '';
    
    // Собираем заголовок
    let titleLine = '';
    let authorLine = '';
    
    if (lines.length > 0 && lines[0].includes('<b>')) {
      titleLine = lines[0];
      if (lines.length > 1 && lines[1].includes('<i>')) {
        authorLine = lines[1];
      }
    }
    
    // Заголовок и автор
    let headerText = titleLine;
    if (authorLine) {
      headerText = titleLine + '\n' + authorLine;
    }
    currentPart = headerText;
    
    // Начальный индекс для контента
    let startIndex = headerText === titleLine ? 1 : 2;
    
    // Собираем и отправляем части
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      
      // Проверяем лимит с учетом следующей строки
      if (currentPart.length + line.length + 1 > maxLength) {
        if (currentPart.trim()) {
          await bot.sendMessage(chatId, currentPart, { parse_mode: 'HTML' });
        }
        
        // Новая часть с заголовком
        const cleanTitleText = titleLine.replace(/<b>|<\/b>/g, '').trim();
        currentPart = `<b>[Продолжение]</b> ${cleanTitleText}`;
      }
      
      // Добавляем строку
      if (currentPart.length > 0) {
        currentPart += '\n';
      }
      currentPart += line;
    }
    
    // Отправляем последнюю часть
    if (currentPart.trim()) {
      await bot.sendMessage(chatId, currentPart, { parse_mode: 'HTML' });
    }
  } catch (error) {
    console.error('Ошибка отправки длинного сообщения:', error.message);
    throw error;
  }
}

/**
 * ОБРАБОТЧИКИ КОМАНД
 */

/**
 * Обработка команды /start и /help
 */
async function handleStartCommand(msg) {
  const userId = msg.from.id;
  
  await showWelcomeAnimation(msg.chat.id);
  updateStats(userId, '/start');
}

/**
 * Обработка команды /help (алиас для /start)
 */
async function handleHelpCommand(msg) {
  handleStartCommand(msg);
  updateStats(msg.from.id, '/help');
}

/**
 * Обработка команды /list - получение списка всех песен
 */
async function handleListCommand(msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  
  try {
    // Сообщение о загрузке с анимацией
    const loadingAnimation = await showAnimatedLoading(chatId, 'Загружаю список песен');
    
    // Получаем список песен
    const songs = await getSongs();
    
    // Останавливаем анимацию и удаляем сообщение
    loadingAnimation.stop();
    try {
      await bot.deleteMessage(chatId, loadingAnimation.message.message_id);
    } catch (error) {
      console.error('Ошибка удаления сообщения:', error.message);
    }
    
    // Фильтруем песни
    const uniqueSongs = new Map();
    
    for (const song of songs) {
      // Пропускаем ненужные или пустые элементы
      if (!song.title || song.title.trim().length < 3) {
        continue;
      }
      
      // Нормализуем название для унификации
      const normalizedTitle = song.title.toLowerCase().trim();
      
      // Сохраняем песню
      uniqueSongs.set(normalizedTitle, song);
    }
    
    // Конвертируем в массив и сортируем
    const filteredSongs = Array.from(uniqueSongs.values());
    filteredSongs.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    
    // Формируем сообщение
    let message = `Список песен в аккорднике (${filteredSongs.length}):`;
    
    for (let i = 0; i < filteredSongs.length; i++) {
      const songNumber = i + 1;
      const song = filteredSongs[i];
      
      // Добавляем перенос строки перед каждой песней
      message += '\n' + `${songNumber}. ${song.title}`;
      
      // Разбиваем на части при необходимости
      if (message.length > MAX_MESSAGE_LENGTH - 200 && i < filteredSongs.length - 1) {
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        message = 'Продолжение списка песен:';
      }
    }
    
    // Отправляем финальное сообщение
    if (message.length > 0) {
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    }
    
    // Статистика
    updateStats(userId, '/list');
  } catch (error) {
    console.error('Ошибка получения списка песен:', error.message);
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
  }
}

/**
 * Обработка команды /random - получение случайной песни
 */
async function handleRandomCommand(msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  
  try {
    // Сообщение о загрузке с анимацией
    const loadingAnimation = await showAnimatedLoading(chatId, 'Выбираю случайную песню');
    
    // Получаем список песен
    const songs = await getSongs();
    
    // Останавливаем анимацию и удаляем сообщение
    loadingAnimation.stop();
    try {
      await bot.deleteMessage(chatId, loadingAnimation.message.message_id);
    } catch (error) {
      console.error('Ошибка удаления сообщения:', error.message);
    }
    
    // Фильтруем песни
    const validSongs = songs.filter(song => 
      song.title && song.title.trim().length > 2
    );
    
    if (validSongs.length === 0) {
      await bot.sendMessage(chatId, 'Песни не найдены.');
      return;
    }
    
    // Выбираем случайную песню
    const randomSong = validSongs[Math.floor(Math.random() * validSongs.length)];
    
    // Сохраняем информацию
    userStates.set(userId, { lastSongTitle: randomSong.title });
    
    // Отправляем песню
    await sendSong(chatId, randomSong.title, randomSong.author, randomSong.fullText);
    
    // Статистика
    updateStats(userId, '/random');
  } catch (error) {
    console.error('Ошибка получения случайной песни:', error.message);
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
  }
}

/**
 * Обработка текстовых сообщений
 */
async function handleTextMessage(msg) {
  const userId = msg.from.id;
  const text = msg.text.trim();
  const state = userStates.get(userId);
  
  if (state && state.waitingFor === 'search') {
    userStates.set(userId, {});
    await performSearch(msg, text);
  } else {
    await performSearch(msg, text);
  }
}

/**
 * Обработка нажатий на кнопки
 */
async function handleCallbackQuery(callback) {
  const userId = callback.from.id;
  const data = callback.data;
  const chatId = callback.message.chat.id;
  
  if (data.startsWith('song_')) {
    const songIndex = parseInt(data.split('_')[1], 10);
    
    try {
      // Получаем песню из кэша
      const userSongs = userSongCache.get(userId);
      
      if (!userSongs || !userSongs[songIndex]) {
        await bot.answerCallbackQuery(callback.id, {
          text: 'Песня не найдена. Повторите поиск.',
          show_alert: true
        });
        return;
      }
      
      const song = userSongs[songIndex];
      
      // Сохраняем выбранную песню в истории
      userStates.set(userId, { lastSongTitle: song.title });
      
      // Отправляем песню
      await sendSong(chatId, song.title, song.author, song.fullText);
      
      // Удаляем сообщение со списком
      await bot.deleteMessage(chatId, callback.message.message_id);
      
      // Подтверждаем обработку
      await bot.answerCallbackQuery(callback.id);
      
      // Статистика
      updateStats(userId, 'callback');
    } catch (error) {
      console.error('Ошибка при обработке выбора песни:', error.message);
      await bot.answerCallbackQuery(callback.id, {
        text: 'Произошла ошибка. Попробуйте позже.',
        show_alert: true
      });
    }
  }
}

/**
 * Обновление статистики
 */
function updateStats(userId, command) {
  stats.commandsUsed[command] = (stats.commandsUsed[command] || 0) + 1;
  stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
}

/**
 * Обработка команды /circlerules - получение правил круга
 */
async function handleCircleRulesCommand(msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  
  try {
    // Сообщение о загрузке с анимацией
    const loadingAnimation = await showAnimatedLoading(chatId, 'Загружаю правила круга');
    
    // Получаем документ
    const document = await getDocumentContent();
    let rules = '';
    let foundRules = false;
    let isFirstLine = true;
    
    // Ищем текст до первого символа ♭
    for (const element of document.body.content) {
      if (element.paragraph) {
        const text = extractParagraphText(element.paragraph);
        
        if (text.includes('♭')) {
          // Достигли первого названия песни - останавливаемся
          foundRules = true;
          break;
        }
        
        // Добавляем текст к правилам если он не пустой
        const trimmedText = text.trim();
        if (trimmedText) {
          if (isFirstLine) {
            rules += trimmedText;
            isFirstLine = false;
          } else {
            rules += '\n' + trimmedText;
          }
        }
      }
    }
    
    // Останавливаем анимацию и удаляем сообщение
    loadingAnimation.stop();
    try {
      await bot.deleteMessage(chatId, loadingAnimation.message.message_id);
    } catch (error) {
      console.error('Ошибка удаления сообщения:', error.message);
    }
    
    if (!foundRules || rules.trim().length === 0) {
      await bot.sendMessage(chatId, 'Правила круга не найдены в документе.');
      return;
    }
    
    // Форматируем и отправляем правила
    const formattedRules = '<b>Правила круга</b>\n\n' + rules;
    await sendLongMessage(chatId, formattedRules);
    
    // Статистика
    updateStats(userId, '/circlerules');
  } catch (error) {
    console.error('Ошибка получения правил круга:', error.message);
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
  }
}

// Экспорт модуля (для тестирования)
module.exports = { bot, app };

