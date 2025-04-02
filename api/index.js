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
bot.onText(/\/search(?:\s+(.+))?/, handleSearchCommand);
bot.onText(/\/text(?:\s+(.+))?/, handleTextCommand);
bot.onText(/\/last/, handleLastCommand);
bot.onText(/\/serach(?:\s+(.+))?/, handleSerachCommand);

// Регистрация обработчика текстовых сообщений
bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    handleTextMessage(msg);
  }
});

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
 * ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
 */

/**
 * Извлекает ID документа из URL Google Docs
 */
function getDocumentIdFromUrl(url) {
  if (!url) return null;
  
  if (url.includes('/d/')) {
    return url.split('/d/')[1].split('/')[0];
  } else if (url.includes('?id=')) {
    return url.split('?id=')[1].split('&')[0];
  } else if (url.match(/^[a-zA-Z0-9_-]{25,}$/)) {
    return url;
  }
  return null;
}

/**
 * Получает содержимое документа с кешированием
 */
async function getDocumentContent() {
  try {
    const now = Date.now();
    if (docCache.content && docCache.lastUpdate && (now - docCache.lastUpdate < docCache.updateInterval)) {
      return docCache.content;
    }

    const documentId = getDocumentIdFromUrl(process.env.SONGBOOK_URL);
    const document = await docs.documents.get({ documentId });
    
    docCache.content = document.data;
    docCache.lastUpdate = now;
    return document.data;
  } catch (error) {
    console.error('Error fetching document:', error.message);
    throw error;
  }
}

/**
 * Получение структурированного содержимого документа
 */
async function fetchSongbookContent() {
  try {
    const document = await getDocumentContent();
    
    // Парсим песни из документа
    const songs = [];
    let currentSong = null;
    
    // Итерируемся по всем элементам документа
    for (const element of document.body.content) {
      if (element.paragraph) {
        const paragraphText = extractParagraphText(element.paragraph);
        
        // Проверяем, является ли это заголовком новой песни (содержит маркер ♭)
        if (paragraphText.includes('♭')) {
          // Если у нас была предыдущая песня, сохраняем её
          if (currentSong) {
            songs.push(currentSong);
          }
          
          // Очищаем название от символов # ♭
          const cleanTitle = paragraphText.replace(/[#♭]/g, '').trim();
          
          // Создаём новую песню
          currentSong = {
            title: cleanTitle,
            author: '',
            fullText: paragraphText + '\n'
          };
        } 
        // Проверяем, является ли это строкой с автором (следует сразу за заголовком)
        else if (currentSong && !currentSong.author && paragraphText.includes('Слова') || 
                paragraphText.includes('слова') || 
                paragraphText.includes('Музыка') || 
                paragraphText.includes('музыка') ||
                paragraphText.includes('автор')) {
          currentSong.author = paragraphText.trim();
          currentSong.fullText += paragraphText + '\n';
        }
        // Добавляем текст к текущей песне
        else if (currentSong) {
          currentSong.fullText += paragraphText + '\n';
        }
      }
    }
    
    // Добавляем последнюю песню
    if (currentSong) {
      songs.push(currentSong);
    }
    
    return { songs };
  } catch (error) {
    console.error('Error parsing document:', error.message);
    throw error;
  }
}

/**
 * Извлекает текст из параграфа
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
  
  // Добавляем маркер для заголовков песен
  if (paragraph.paragraphStyle && paragraph.paragraphStyle.namedStyleType === 'TITLE') {
    const title = text.trim();
    if (title && 
        !title.includes('Правила') && 
        !title.match(/^\d+\./) && 
        !title.includes('Припев') &&
        !title.includes('Будь осознанным') &&
        !title.includes('песенная служба')) {
      text = '# ♭' + text;
    }
  }
  
  return text;
}

/**
 * Поиск песен
 */
async function searchSongs(query, searchByText = false) {
  try {
    query = query.toLowerCase().trim();
    const { songs } = await fetchSongbookContent();
    
    // Фильтруем песни
    const validSongs = songs.filter(song => 
      song.title && 
      song.title.trim().length > 2 && 
      !song.title.includes('Правила') &&
      !song.title.match(/^\d+\.\s/)
    );
    
    // Выполняем поиск
    if (searchByText) {
      // Поиск по тексту
      return validSongs.filter(song => 
        song.fullText.toLowerCase().includes(query)
      );
    } else {
      // Поиск по названию
      // Сначала ищем точные совпадения
      const exactMatches = validSongs.filter(song => 
        song.title.toLowerCase().includes(query)
      );
      
      if (exactMatches.length > 0) {
        return exactMatches;
      }
      
      // Если точных совпадений нет, ищем совпадения в тексте
      return validSongs.filter(song => 
        song.fullText.toLowerCase().includes(query)
      );
    }
  } catch (error) {
    console.error('Search error:', error.message);
    return [];
  }
}

/**
 * ОБРАБОТЧИКИ КОМАНД БОТА
 */

/**
 * Обработка команды /start
 */
async function handleStartCommand(msg) {
  const userId = msg.from.id;
  const welcomeMessage = 
    'Привет! Я бот для поиска песен.\n\n' +
    'Доступные команды:\n' +
    '/search - поиск песни по названию\n' +
    '/text - поиск песни по тексту\n' +
    '/list - список всех песен\n' +
    '/random - случайная песня\n' +
    '/last - последняя просмотренная песня\n' +
    '/serach - поиск песни по названию, тексту или автору\n' +
    '/help - справка';
  
  await bot.sendMessage(msg.chat.id, welcomeMessage);
  stats.commandsUsed['/start'] = (stats.commandsUsed['/start'] || 0) + 1;
  stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
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
  stats.commandsUsed['/help'] = (stats.commandsUsed['/help'] || 0) + 1;
  stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
}

/**
 * Обработка команды /search - поиск песни по названию
 */
async function handleSearchCommand(msg, match) {
  const userId = msg.from.id;
  const query = match && match[1] ? match[1].trim() : '';
  
  if (query) {
    // Если указан запрос, ищем песню
    await performSongSearch(msg, query, false);
  } else {
    // Если запрос не указан, запрашиваем его
    await bot.sendMessage(msg.chat.id, 'Введите название песни:');
    userStates.set(userId, userStates.get(userId) || {});
    userStates.get(userId).waitingForSongName = true;
  }
  
  stats.commandsUsed['/search'] = (stats.commandsUsed['/search'] || 0) + 1;
  stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
}

/**
 * Обработка команды /text - поиск песни по тексту
 */
async function handleTextCommand(msg, match) {
  const userId = msg.from.id;
  const query = match && match[1] ? match[1].trim() : '';
  
  if (query) {
    // Если указан запрос, ищем песню
    await performSongSearch(msg, query, true);
  } else {
    // Если запрос не указан, запрашиваем его
    await bot.sendMessage(msg.chat.id, 'Введите фрагмент текста песни:');
    userStates.set(userId, userStates.get(userId) || {});
    userStates.get(userId).waitingForTextSearch = true;
  }
  
  stats.commandsUsed['/text'] = (stats.commandsUsed['/text'] || 0) + 1;
  stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
}

/**
 * Выполнение поиска песни
 */
async function performSongSearch(msg, query, searchByText = false) {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Сообщение о поиске
    const waitMessage = await bot.sendMessage(
      chatId, 
      searchByText ? 'Ищу песню по тексту...' : 'Ищу песню по названию...'
    );
    
    // Выполняем поиск
    const songs = await searchSongs(query, searchByText);
    
    // Нет результатов
    if (songs.length === 0) {
      await bot.editMessageText('К сожалению, ничего не найдено. Попробуйте изменить запрос или воспользуйтесь /list.', {
        chat_id: chatId,
        message_id: waitMessage.message_id
      });
      return;
    }
    
    // Одна песня - отправляем сразу
    if (songs.length === 1) {
      const song = songs[0];
      
      // Очищаем название от символов # ♭
      const cleanTitle = song.title.replace(/[#♭]/g, '').trim();
      
      // Удаляем сообщение о поиске
      await bot.deleteMessage(chatId, waitMessage.message_id);
      
      // Отправляем песню
      const formattedText = formatSongForDisplay(cleanTitle, song.author, song.fullText);
      await sendFormattedSong(chatId, formattedText);
      
      // Сохраняем последнюю песню
      userStates.set(userId, userStates.get(userId) || {});
      userStates.get(userId).lastSongTitle = cleanTitle;
      return;
    }
    
    // Несколько песен - список с кнопками
    // Ограничиваем количество результатов для удобства
    const maxResults = Math.min(songs.length, 20);
    const songsToShow = songs.slice(0, maxResults);
    
    // Очищаем названия от символов # ♭
    songsToShow.forEach(song => {
      song.cleanTitle = song.title.replace(/[#♭]/g, '').trim();
    });
    
    await bot.editMessageText(`Найдено ${songs.length} песен${maxResults < songs.length ? ' (показаны первые ' + maxResults + ')' : ''}. Выберите нужную:`, {
      chat_id: chatId,
      message_id: waitMessage.message_id,
      reply_markup: {
        inline_keyboard: songsToShow.map((song, index) => [{
          text: `${song.cleanTitle}${song.author ? ' - ' + song.author.substring(0, 30) : ''}`,
          callback_data: `song_${index}`
        }])
      }
    });
    
    // Сохраняем для быстрого доступа
    userSongCache.set(userId, songsToShow);
  } catch (error) {
    console.error('Ошибка поиска:', error.message);
    await bot.sendMessage(msg.chat.id, 'Произошла ошибка. Попробуйте позже или используйте /list.');
  }
}

/**
 * Обработка обычных текстовых сообщений
 */
async function handleTextMessage(msg) {
  const userId = msg.from.id;
  const text = msg.text.trim();
  
  if (userStates.has(userId)) {
    const state = userStates.get(userId);
    
    if (state.waitingForSongName) {
      state.waitingForSongName = false;
      await performSongSearch(msg, text, false);
    }
    else if (state.waitingForTextSearch) {
      state.waitingForTextSearch = false;
      await performSongSearch(msg, text, true);
    }
    else if (state.waitingForSerachSearch) {
      state.waitingForSerachSearch = false;
      await searchSongsByAll(msg, text);
    }
    else {
      // Обычное сообщение - поиск по названию
      await performSongSearch(msg, text, false);
    }
  }
  else {
    // Обычное сообщение - поиск по названию
    await performSongSearch(msg, text, false);
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
      
      // Очищаем название от символов # ♭ если необходимо
      const cleanTitle = song.cleanTitle || song.title.replace(/[#♭]/g, '').trim();
      
      // Сохраняем выбранную песню в истории
      userStates.set(userId, userStates.get(userId) || {});
      userStates.get(userId).lastSongTitle = cleanTitle;
      
      // Отправляем песню
      const formattedText = formatSongForDisplay(cleanTitle, song.author, song.fullText);
      await sendFormattedSong(chatId, formattedText);
      
      // Удаляем сообщение со списком
      await bot.deleteMessage(chatId, callback.message.message_id);
      
      // Подтверждаем обработку
      await bot.answerCallbackQuery(callback.id);
      
      // Статистика
      stats.callbacksUsed['song_selection'] = (stats.callbacksUsed['song_selection'] || 0) + 1;
      stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
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
 * Отправляет форматированную песню
 */
async function sendFormattedSong(chatId, formattedText) {
  try {
    await sendLongMessage(chatId, formattedText);
  } catch (error) {
    console.error('Ошибка отправки песни:', error.message);
    await bot.sendMessage(chatId, 'Произошла ошибка при отправке песни. Попробуйте позже.');
  }
}

/**
 * Отправляет длинное сообщение по частям
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
        
        // Новая часть с заголовком (убедимся, что заголовок не содержит символы # ♭)
        const cleanTitleText = titleLine.replace(/<b>|<\/b>|#|♭/g, '').trim();
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
 * Форматирует песню для отображения
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
  
  // Очищаем название от символов # ♭
  const cleanTitle = title.replace(/[#♭]/g, '').trim();
  
  // Форматируем заголовок и автора
  let result = `<b>${escapeHtml(cleanTitle)}</b>\n`;
  
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
  if (lines.length > 0 && (lines[0].trim() === title || lines[0].trim() === cleanTitle)) {
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
 * Обработка команды /list - получение списка всех песен
 */
async function handleListCommand(msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  
  try {
    // Сообщение о загрузке
    const waitMessage = await bot.sendMessage(chatId, 'Загрузка списка песен...');
    
    // Получаем список песен
    const { songs } = await fetchSongbookContent();
    
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
      
      // Очищаем название от символов # ♭
      const cleanTitle = song.title.replace(/[#♭]/g, '').trim();
      
      // Нормализуем название для унификации
      const normalizedTitle = cleanTitle.toLowerCase().trim();
      
      // Сохраняем песню с очищенным названием
      uniqueSongs.set(normalizedTitle, { ...song, title: cleanTitle });
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
    stats.commandsUsed['/list'] = (stats.commandsUsed['/list'] || 0) + 1;
    stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
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
    const { songs } = await fetchSongbookContent();
    
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
    
    // Очищаем название от символов # ♭
    const cleanTitle = randomSong.title.replace(/[#♭]/g, '').trim();
    
    // Сохраняем информацию
    userStates.set(userId, userStates.get(userId) || {});
    userStates.get(userId).lastSongTitle = cleanTitle;
    
    // Отправляем песню
    const formattedContent = formatSongForDisplay(cleanTitle, randomSong.author, randomSong.fullText);
    await sendFormattedSong(chatId, formattedContent);
    
    // Статистика
    stats.commandsUsed['/random'] = (stats.commandsUsed['/random'] || 0) + 1;
    stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
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
    const { songs } = await fetchSongbookContent();
    
    // Находим песню
    const lastSong = songs.find(s => {
      const cleanTitle = s.title.replace(/[#♭]/g, '').trim();
      return cleanTitle === userState.lastSongTitle;
    });
    
    if (!lastSong) {
      await bot.sendMessage(chatId, 'Не удалось найти последнюю просмотренную песню.');
      return;
    }
    
    // Очищаем название от символов # ♭
    const cleanTitle = lastSong.title.replace(/[#♭]/g, '').trim();
    
    // Отправляем песню
    const formattedText = formatSongForDisplay(cleanTitle, lastSong.author, lastSong.fullText);
    await sendFormattedSong(chatId, formattedText);
    
    // Статистика
    stats.commandsUsed['/last'] = (stats.commandsUsed['/last'] || 0) + 1;
    stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
  } catch (error) {
    console.error('Ошибка при получении последней песни:', error.message);
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
  }
}

/**
 * Обработка команды /serach - поиск песни по названию, тексту и автору
 */
async function handleSerachCommand(msg, match) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const query = match && match[1] ? match[1].trim() : '';
  
  try {
    if (query) {
      // Если указан запрос, ищем песни
      await searchSongsByAll(msg, query);
    } else {
      // Если запрос не указан, запрашиваем его
      await bot.sendMessage(chatId, 'Введите название песни, автора или фрагмент текста для поиска:');
      
      userStates.set(userId, userStates.get(userId) || {});
      userStates.get(userId).waitingForSerachSearch = true;
    }
    
    // Статистика
    stats.commandsUsed['/serach'] = (stats.commandsUsed['/serach'] || 0) + 1;
    stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
  } catch (error) {
    console.error('Ошибка при выполнении поиска:', error.message);
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
  }
}

/**
 * Поиск песен по всем параметрам (названию, тексту, автору)
 */
async function searchSongsByAll(msg, query) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  
  try {
    const waitMessage = await bot.sendMessage(chatId, 'Ищу песню...');
    
    // Получаем список песен
    const { songs } = await fetchSongbookContent();
    
    // Комплексный поиск
    const foundSongs = songs.filter(song => {
      // Фильтруем недействительные песни
      if (!song.title || 
          song.title.trim().length < 3 || 
          song.title === 'Ритмика' || 
          song.title.includes('Правила') ||
          song.title.match(/^\d+\.\s/)) {
        return false;
      }
      
      // Очищаем название от символов # ♭ для поиска
      const cleanTitle = song.title.replace(/[#♭]/g, '').trim();
      const titleMatch = cleanTitle.toLowerCase().includes(query.toLowerCase());
      const textMatch = song.fullText.toLowerCase().includes(query.toLowerCase());
      const authorMatch = song.author && song.author.toLowerCase().includes(query.toLowerCase());
      
      return titleMatch || textMatch || authorMatch;
    });
    
    // Удаляем сообщение загрузки
    try {
      await bot.deleteMessage(chatId, waitMessage.message_id);
    } catch (error) {
      console.error('Ошибка удаления сообщения:', error.message);
    }
    
    // Нет результатов
    if (foundSongs.length === 0) {
      await bot.sendMessage(chatId, 'К сожалению, песен по вашему запросу не найдено.');
      return;
    }
    
    // Одна песня - отправляем сразу
    if (foundSongs.length === 1) {
      const song = foundSongs[0];
      
      // Очищаем название от символов # ♭
      const cleanTitle = song.title.replace(/[#♭]/g, '').trim();
      
      // Сохраняем последнюю песню
      userStates.set(userId, userStates.get(userId) || {});
      userStates.get(userId).lastSongTitle = cleanTitle;
      
      // Отправляем песню
      const formattedText = formatSongForDisplay(cleanTitle, song.author, song.fullText);
      await sendFormattedSong(chatId, formattedText);
      return;
    }
    
    // Несколько песен - список с кнопками
    const maxResults = Math.min(foundSongs.length, 15);
    const songsToShow = foundSongs.slice(0, maxResults);
    
    // Очищаем названия от символов # ♭
    songsToShow.forEach(song => {
      song.cleanTitle = song.title.replace(/[#♭]/g, '').trim();
    });
    
    let message = `Найдено ${foundSongs.length} песен${maxResults < foundSongs.length ? ' (показаны первые ' + maxResults + ')' : ''}. Выберите нужную:\n\n`;
    
    songsToShow.forEach((song, index) => {
      message += `${index + 1}. ${song.cleanTitle}${song.author ? ' - ' + song.author.substring(0, 30) : ''}\n`;
    });
    
    await bot.sendMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: songsToShow.map((song, index) => [{
          text: song.cleanTitle,
          callback_data: `song_${index}`
        }])
      }
    });
    
    // Сохраняем для быстрого доступа
    userSongCache.set(userId, songsToShow);
  } catch (error) {
    console.error('Ошибка комплексного поиска:', error.message);
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
  }
}

// Экспорт модуля (для тестирования)
module.exports = { bot, app };

