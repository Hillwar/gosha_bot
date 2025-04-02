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
  keyFile: path.join(__dirname, '..', 'Gosha IAM Admin.json'),
  scopes: ['https://www.googleapis.com/auth/documents.readonly']
});

const docs = google.docs({ version: 'v1', auth });

// Инициализация Telegram Bot
const isDev = process.env.NODE_ENV === 'development';
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: isDev });

// Регистрация обработчиков команд
bot.onText(/\/start/, handleStartCommand);
bot.onText(/\/help/, handleHelpCommand);
bot.onText(/\/list/, handleListCommand);
bot.onText(/\/random/, handleRandomCommand);
bot.onText(/\/search(?:\s+(.+))?/, (msg, match) => handleSearchCommand(msg, match, false));
bot.onText(/\/text(?:\s+(.+))?/, (msg, match) => handleSearchCommand(msg, match, true));
bot.onText(/\/last/, handleLastCommand);
bot.onText(/\/serach(?:\s+(.+))?/, handleAdvancedSearchCommand);

// Регистрация обработчика текстовых сообщений
bot.on('message', msg => { if (msg.text && !msg.text.startsWith('/')) handleTextMessage(msg); });

// Регистрация обработчика callback-запросов
bot.on('callback_query', handleCallbackQuery);

// Запуск сервера
const PORT = process.env.PORT || 3333;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));

// Настройка webhook если не в режиме разработки
if (!isDev) {
  setupWebhook();
}

console.log('Бот успешно запущен!');

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
    
    for (const element of document.body.content) {
      if (element.paragraph) {
        const { text, isSongTitle } = extractParagraphText(element.paragraph);
        
        if (isSongTitle) {
          if (currentSong) songs.push(currentSong);
          currentSong = { title: text.trim(), author: '', fullText: text + '\n' };
        } 
        else if (currentSong && !currentSong.author && 
                (text.includes('Слова') || text.includes('Музыка') || 
                 text.includes('автор'))) {
          currentSong.author = text.trim();
          currentSong.fullText += text + '\n';
        }
        else if (currentSong) {
          currentSong.fullText += text + '\n';
        }
      }
    }
    
    if (currentSong) songs.push(currentSong);
    
    return songs.filter(song => 
      song.title && 
      song.title.trim().length > 2 && 
      !song.title.includes('Правила') &&
      !song.title.match(/^\d+\.\s/) &&
      song.title !== 'Ритмика'
    );
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
  
  // Определяем, является ли параграф заголовком песни
  const isSongTitle = paragraph.paragraphStyle && 
                      paragraph.paragraphStyle.namedStyleType === 'TITLE' && 
                      text.trim() && 
                      !text.includes('Правила') && 
                      !text.match(/^\d+\./) && 
                      !text.includes('Припев') &&
                      !text.includes('Будь осознанным') &&
                      !text.includes('песенная служба');
  
  return { text, isSongTitle };
}

/**
 * Общая функция обработки команд поиска
 */
async function handleSearchCommand(msg, match, searchByText = false) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const query = match && match[1] ? match[1].trim() : '';
  
  if (query) {
    await performSearch(msg, query, searchByText ? 'text' : 'title');
  } else {
    await bot.sendMessage(chatId, `Введите ${searchByText ? 'текст' : 'название'} песни:`);
    userStates.set(userId, { waitingFor: searchByText ? 'text' : 'title' });
  }
  
  updateStats(userId, searchByText ? '/text' : '/search');
}

/**
 * Расширенный поиск по названию, тексту, автору
 */
async function handleAdvancedSearchCommand(msg, match) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const query = match && match[1] ? match[1].trim() : '';
  
  if (query) {
    await performSearch(msg, query, 'advanced');
  } else {
    await bot.sendMessage(chatId, 'Введите название, автора или текст песни:');
    userStates.set(userId, { waitingFor: 'advanced' });
  }
  
  updateStats(userId, '/serach');
}

/**
 * Выполнение поиска песен
 */
async function performSearch(msg, query, searchType) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  try {
    const waitMessage = await bot.sendMessage(
      chatId, 
      `Ищу песню${searchType === 'text' ? ' по тексту' : ''}...`
    );
    
    const songs = await getSongs();
    const results = filterSongs(songs, query, searchType);
    
    if (results.length === 0) {
      await bot.editMessageText('Ничего не найдено. Попробуйте изменить запрос.', {
        chat_id: chatId,
        message_id: waitMessage.message_id
      });
      return;
    }
    
    if (results.length === 1) {
      const song = results[0];
      
      await bot.deleteMessage(chatId, waitMessage.message_id);
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
        message_id: waitMessage.message_id,
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
function filterSongs(songs, query, searchType) {
  const normalizedQuery = query.toLowerCase().trim();
  
  return songs.filter(song => {
    if (searchType === 'title') {
      return song.title.toLowerCase().includes(normalizedQuery);
    } 
    else if (searchType === 'text') {
      return song.fullText.toLowerCase().includes(normalizedQuery);
    }
    else if (searchType === 'advanced') {
      return song.title.toLowerCase().includes(normalizedQuery) || 
             song.fullText.toLowerCase().includes(normalizedQuery) ||
             (song.author && song.author.toLowerCase().includes(normalizedQuery));
    }
  });
}

/**
 * Отправка песни пользователю
 */
async function sendSong(chatId, title, author, text) {
  try {
    const formattedText = formatSongForDisplay(title, author, text);
    await sendLongMessage(chatId, formattedText);
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
  
  // Форматируем заголовок и автора
  let result = `<b>${escapeHtml(title)}</b>\n`;
  
  if (author && author.trim()) {
    result += `<i>${escapeHtml(author)}</i>\n\n`;
  } else {
    result += '\n';
  }
  
  // Обрабатываем текст песни
  // Разбиваем на строки для анализа
  const lines = text.split('\n');
  let processedText = '';
  
  // Пропускаем первые строки, которые повторяют название и автора
  let skipLines = 0;
  if (lines.length > 0 && lines[0].trim() === title) {
    skipLines++;
    if (lines.length > 1 && author && lines[1].trim() === author) {
      skipLines++;
    }
  }
  
  // Обрабатываем остальные строки
  for (let i = skipLines; i < lines.length; i++) {
    const line = lines[i];
    
    // Пропускаем метаданные
    if ((i === skipLines || i === skipLines + 1) && 
        (line.trim() === 'Ритмика' || 
         line.includes('Перебор') || 
         line.includes('Бой') ||
         line.includes('Особенность') ||
         line.includes('Группа'))) {
      continue;
    }
    
    // Добавляем обработанную строку к результату
    processedText += escapeHtml(line) + '\n';
  }
  
  // Добавляем текст к результату
  result += processedText;
  
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
      headerText += '\n' + authorLine;
    }
    currentPart = headerText + '\n\n';
    
    // Начальный индекс для контента
    let startIndex = headerText === titleLine ? 1 : 2;
    if (startIndex < lines.length && lines[startIndex].trim() === '') {
      startIndex++;
    }
    
    // Собираем и отправляем части
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      
      // Проверяем лимит
      if (currentPart.length + line.length + 1 > maxLength) {
        if (currentPart.trim()) {
          await bot.sendMessage(chatId, currentPart, { parse_mode: 'HTML' });
        }
        
        // Новая часть с заголовком
        const cleanTitleText = titleLine.replace(/<b>|<\/b>/g, '').trim();
        currentPart = `<b>[Продолжение]</b> ${cleanTitleText}\n\n`;
      }
      
      // Добавляем строку
      currentPart += line + '\n';
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
 * Обработка команды /start
 */
async function handleStartCommand(msg) {
  const userId = msg.from.id;
  const welcomeMessage = 
    'Привет! Я бот для поиска песен.\n\n' +
    'Доступные команды:\n' +
    '/search - поиск по названию\n' +
    '/text - поиск по тексту\n' +
    '/list - список всех песен\n' +
    '/random - случайная песня\n' +
    '/last - последняя просмотренная\n' +
    '/serach - поиск по названию/тексту/автору\n' +
    '/help - справка';
  
  await bot.sendMessage(msg.chat.id, welcomeMessage);
  updateStats(userId, '/start');
}

/**
 * Обработка команды /help
 */
async function handleHelpCommand(msg) {
  const userId = msg.from.id;
  const helpMessage = 
    'Список доступных команд:\n\n' +
    '/search <название> - поиск песни по названию\n' +
    '/text <текст> - поиск песни по тексту\n' +
    '/list - список всех песен\n' +
    '/random - случайная песня\n' +
    '/last - последняя просмотренная песня\n' +
    '/serach <запрос> - поиск песни по названию, тексту или автору\n' +
    '/help - эта справка';
  
  await bot.sendMessage(msg.chat.id, helpMessage);
  updateStats(userId, '/help');
}

/**
 * Обработка команды /list - получение списка всех песен
 */
async function handleListCommand(msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  
  try {
    // Сообщение о загрузке
    const waitMessage = await bot.sendMessage(chatId, 'Загрузка списка песен...');
    
    // Получаем список песен
    const songs = await getSongs();
    
    // Удаляем сообщение загрузки
    try {
      await bot.deleteMessage(chatId, waitMessage.message_id);
    } catch (error) {
      console.error('Ошибка удаления сообщения:', error.message);
    }
    
    // Фильтруем песни
    const uniqueSongs = new Map();
    
    for (const song of songs) {
      // Пропускаем ненужные или пустые элементы
      if (!song.title || 
          song.title.trim().length < 3 || 
          song.title === 'Ритмика' || 
          song.title.includes('Припев') ||
          song.title.includes('Правила') ||
          song.title.match(/^\d+\.\s/)) {
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
    let message = `Список песен в аккорднике (${filteredSongs.length}):\n\n`;
    
    for (let i = 0; i < filteredSongs.length; i++) {
      const songNumber = i + 1;
      const song = filteredSongs[i];
      
      // Выводим только название песни
      message += `${songNumber}. ${song.title}\n`;
      
      // Разбиваем на части при необходимости
      if (message.length > MAX_MESSAGE_LENGTH - 200 && i < filteredSongs.length - 1) {
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        message = `Продолжение списка песен:\n\n`;
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
    const waitMessage = await bot.sendMessage(chatId, 'Выбираю случайную песню...');
    
    // Получаем список песен
    const songs = await getSongs();
    
    // Удаляем сообщение загрузки
    try {
      await bot.deleteMessage(chatId, waitMessage.message_id);
    } catch (error) {
      console.error('Ошибка удаления сообщения:', error.message);
    }
    
    // Фильтруем песни
    const validSongs = songs.filter(song => 
      song.title && 
      song.title.trim().length > 2 && 
      !song.title.includes('Правила') &&
      !song.title.match(/^\d+\.\s/)
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
 * Обработка команды /last - последняя просмотренная песня
 */
async function handleLastCommand(msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const userState = userStates.get(userId);
  
  if (!userState || !userState.lastSongTitle) {
    await bot.sendMessage(chatId, 'У вас еще нет последней просмотренной песни. Используйте команды /list, /random или /search.');
    return;
  }
  
  try {
    // Ищем последнюю просмотренную песню
    const songs = await getSongs();
    
    // Находим песню
    const lastSong = songs.find(s => s.title === userState.lastSongTitle);
    
    if (!lastSong) {
      await bot.sendMessage(chatId, 'Не удалось найти последнюю просмотренную песню.');
      return;
    }
    
    // Отправляем песню
    await sendSong(chatId, lastSong.title, lastSong.author, lastSong.fullText);
    
    // Статистика
    updateStats(userId, '/last');
  } catch (error) {
    console.error('Ошибка при получении последней песни:', error.message);
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
  
  if (state && state.waitingFor) {
    const searchType = state.waitingFor;
    userStates.set(userId, {});
    await performSearch(msg, text, searchType);
  } else {
    await performSearch(msg, text, 'title'); // По умолчанию ищем по названию
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
 * Настройка вебхука
 */
async function setupWebhook() {
  try {
    const webhookUrl = process.env.WEBHOOK_URL || `https://${process.env.HOST}/bot${process.env.BOT_TOKEN}`;
    await bot.setWebHook(webhookUrl);
    console.log(`Webhook установлен на ${webhookUrl}`);
  } catch (error) {
    console.error('Ошибка установки webhook:', error.message);
  }
}

/**
 * Обновление статистики
 */
function updateStats(userId, command) {
  stats.commandsUsed[command] = (stats.commandsUsed[command] || 0) + 1;
  stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
}

// Экспорт модуля (для тестирования)
module.exports = { bot, app };

