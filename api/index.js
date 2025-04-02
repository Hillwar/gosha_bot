/**
 * Gosha Bot - Telegram бот для поиска и отображения песен с аккордами
 */

// Основные зависимости
require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const winston = require('winston');
const { exec } = require('child_process');
const path = require('path');

// КОНСТАНТЫ
const MAX_MESSAGE_LENGTH = 4000; // Оставляем запас под максимальный размер сообщения Telegram (4096)

// Базовый логгер
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.simple(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.Console()
  ]
});

/**
 * Настройка Express
 */
const app = express();
app.use(express.json());

// Middleware для логирования запросов
app.use((req, res, next) => {
  logger.debug('Incoming request:', {
    method: req.method,
    path: req.path,
    body: req.body,
    headers: req.headers
  });
  next();
});

// Состояния и кеши
const userStates = new Map();
const userSongCache = new Map();
const docCache = {
  content: null,
  lastUpdate: null,
  updateInterval: 5 * 60 * 1000 // 5 минут
};

// Статистика
const stats = {
  searches: 0,
  commands: 0,
  songViews: {},
  commandsUsed: {},
  callbacksUsed: {},
  userActivity: {},
  lastReset: Date.now()
};

// Инициализация Google API
let auth;
try {
  auth = new google.auth.GoogleAuth({
    keyFile: require('path').join(__dirname, '..', 'Gosha IAM Admin.json'),
    scopes: ['https://www.googleapis.com/auth/documents.readonly']
  });
} catch (error) {
  console.error(`Ошибка инициализации Google API: ${error.message}`);
  auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/documents.readonly']
  });
}

const docs = google.docs({ version: 'v1', auth });

/**
 * Инициализация Telegram Bot
 */
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
  // Пропускаем команды
  if (msg.text && msg.text.startsWith('/')) return;
  
  // Обрабатываем только текстовые сообщения
  if (msg.text) {
    handleTextMessage(msg);
  }
});

// Регистрация обработчика callback-запросов
bot.on('callback_query', handleCallbackQuery);

// Инициализация статистики использования команд и callback-кнопок
stats.commandsUsed = {};
stats.callbacksUsed = {};
stats.userActivity = {};
stats.songViews = {};

// Проверка наличия необходимых переменных окружения при запуске
function checkRequiredEnvVariables() {
  const required = ['BOT_TOKEN', 'SONGBOOK_URL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`ОШИБКА: Следующие обязательные переменные окружения не установлены: ${missing.join(', ')}`);
    console.error('Бот не может быть запущен без этих переменных. Пожалуйста, проверьте файл .env');
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    return false;
  }
  
  return true;
}

// Инициализация бота
function initializeBot() {
  const PORT = process.env.PORT || 3333;
  app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
  
  if (!isDev) {
    setupWebhook();
  }
  
  console.log('Бот успешно запущен!');
}

// Запускаем бот
initializeBot();

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

    if (!process.env.SONGBOOK_URL) {
      throw new Error('SONGBOOK_URL is not configured');
    }

    const documentId = getDocumentIdFromUrl(process.env.SONGBOOK_URL);
    const document = await docs.documents.get({ documentId });
    
    if (!document || !document.data) {
      throw new Error('Empty document received from Google API');
    }
    
    docCache.content = document.data;
    docCache.lastUpdate = now;
    return document.data;
  } catch (error) {
    console.error('Error fetching document:', error.message);
    throw error;
  }
}

/**
 * Получение содержимого документа в текстовом формате
 */
async function fetchSongbookContent() {
  try {
    const document = await getDocumentContent();
    
    if (!document || !document.body || !document.body.content) {
      throw new Error('Invalid document structure');
    }
    
    // Преобразуем документ в текстовый формат
    let text = '';
    
    // Итерируемся по всем элементам документа
    for (const element of document.body.content) {
      if (element.paragraph) {
        // Если это параграф с текстом
        if (element.paragraph.elements) {
          for (const textElement of element.paragraph.elements) {
            if (textElement.textRun && textElement.textRun.content) {
              text += textElement.textRun.content;
            }
          }
        }
        
        // Проверяем, имеет ли параграф стиль заголовка (TITLE)
        if (element.paragraph.paragraphStyle && 
            element.paragraph.paragraphStyle.namedStyleType === 'TITLE') {
          const title = element.paragraph.elements && 
                       element.paragraph.elements[0] && 
                       element.paragraph.elements[0].textRun ?
                       element.paragraph.elements[0].textRun.content.trim() : '';
          
          // Проверяем, что это не правила
          if (title && 
              !title.includes('Правила') && 
              !title.match(/^\d+\./) && 
              title !== 'Припев.' && 
              title !== 'Припев:' &&
              !title.match(/^Будь осознанным/) &&
              !title.includes('песенная служба')) {
            // Добавляем символ ♭ перед заголовком для обозначения названия песни
            const lastIndex = text.lastIndexOf('\n');
            if (lastIndex !== -1) {
              text = text.substring(0, lastIndex) + '\n# ♭' + text.substring(lastIndex + 1);
            } else {
              text = '# ♭' + text;
            }
          }
        }
      } else if (element.table) {
        // Обработка таблиц
        if (element.table.tableRows) {
          for (const row of element.table.tableRows) {
            if (row.tableCells) {
              for (const cell of row.tableCells) {
                if (cell.content) {
                  for (const cellElement of cell.content) {
                    if (cellElement.paragraph && cellElement.paragraph.elements) {
                      for (const textElement of cellElement.paragraph.elements) {
                        if (textElement.textRun && textElement.textRun.content) {
                          text += textElement.textRun.content;
                        }
                      }
                    }
                  }
                }
                text += '\t';
              }
              text += '\n';
            }
          }
        }
      }
    }
    
    // Разбиваем текст на строки и создаем песни
    const lines = text.split('\n');
    const songs = [];
    let currentSong = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Проверяем, является ли строка названием песни (содержит символ ♭)
      if (line.includes('♭')) {
        // Если нашли новую песню, сохраняем предыдущую (если была)
        if (currentSong) {
          songs.push(currentSong);
        }
        
        // Извлекаем название песни - всё после символа ♭
        const titleParts = line.split('♭');
        const songTitle = titleParts[1] ? titleParts[1].trim() : '';
        
        // Следующая строка обычно содержит информацию об авторе
        let author = "";
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine.startsWith('Слова') || 
              nextLine.includes('Музыка') || 
              nextLine.includes('музыка') || 
              nextLine === 'Ритмика') {
            author = nextLine;
            i++; // Пропускаем строку автора
          }
        }
        
        // Создаем новую песню
        currentSong = {
          title: songTitle,
          author: author,
          content: []
        };
        
        // Добавляем название и автора в контент
        currentSong.content.push(songTitle);
        if (author) {
          currentSong.content.push(author);
        }
      }
      else if (currentSong) {
        // Добавляем строку к текущей песне
        currentSong.content.push(line);
      }
    }
    
    // Добавляем последнюю песню
    if (currentSong) {
      songs.push(currentSong);
    }
    
    // Форматируем контент песен и очищаем названия
    for (const song of songs) {
      // Очищаем название от лишних символов и форматирования
      song.title = song.title.replace(/#/g, '').trim();
      
      // Собираем полный текст песни
      song.fullText = song.content.join('\n');
    }
    
    return { text, songs };
  } catch (error) {
    console.error('Error fetching songbook content:', error);
    throw error;
  }
}

/**
 * Поиск песен по названию или тексту
 */
async function searchSongs(query, searchByText = false) {
  try {
    const { songs } = await fetchSongbookContent();
    if (!songs || songs.length === 0) return [];
    
    // Фильтруем песни - отбрасываем пустые и служебные
    const validSongs = songs.filter(song => {
      return song.title && 
             song.title.trim().length > 2 && 
             !song.title.includes('Правила') &&
             !song.title.match(/^\d+\.\s/) &&
             song.title !== 'Ритмика';
    });
    
    // Нормализуем поисковый запрос
    const normalizedQuery = query.toLowerCase().trim();
    
    // Поиск по названию или тексту
    if (!searchByText) {
      // Сначала ищем точное совпадение
      let foundSongs = validSongs.filter(song => 
        song.title.toLowerCase().trim() === normalizedQuery
      );
      
      // Если точных совпадений нет, ищем по словам
      if (foundSongs.length === 0) {
        const queryWords = normalizedQuery.split(/\s+/);
        
        foundSongs = validSongs.filter(song => {
          const titleLower = song.title.toLowerCase();
          return queryWords.every(word => titleLower.includes(word));
        });
        
        // Если и так нет совпадений, используем обычное вхождение
        if (foundSongs.length === 0) {
          foundSongs = validSongs.filter(song => 
            song.title.toLowerCase().includes(normalizedQuery)
          );
        }
      }
      
      return foundSongs;
    } else {
      // Поиск по тексту
      return validSongs.filter(song => 
        song.fullText.toLowerCase().includes(normalizedQuery)
      );
    }
  } catch (error) {
    console.error('Ошибка поиска песен:', error.message);
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
  const userName = msg.from.first_name;
  
  await bot.sendMessage(
    msg.chat.id, 
    `Привет, ${userName}! Я помогу найти тексты песен под гитару. Используй команду /search название_песни для поиска.`
  );
  
  if (!userStates.has(userId)) {
    userStates.set(userId, {
      waitingForSongName: false,
      waitingForTextSearch: false,
      lastSongTitle: null
    });
  }
  
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
    '/search <название песни> - поиск песни по названию\n' +
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
  let query = match && match[1] ? match[1].trim() : '';
  
  if (query) {
    // Если запрос передан, осуществляем поиск
    await performSongSearch(msg, query, false);
  } else {
    // Запрашиваем название песни
    await bot.sendMessage(msg.chat.id, 'Введите название песни для поиска:');
    
    userStates.set(userId, userStates.get(userId) || {});
    userStates.get(userId).waitingForSongName = true;
    userStates.get(userId).waitingForTextSearch = false;
  }
  
  stats.commandsUsed['/search'] = (stats.commandsUsed['/search'] || 0) + 1;
  stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
}

/**
 * Обработка команды /text - поиск песни по тексту
 */
async function handleTextCommand(msg, match) {
  const userId = msg.from.id;
  let query = match && match[1] ? match[1].trim() : '';
  
  if (query) {
    // Если запрос передан, осуществляем поиск
    await performSongSearch(msg, query, true);
  } else {
    // Запрашиваем текст для поиска
    await bot.sendMessage(msg.chat.id, 'Введите фрагмент текста песни для поиска:');
    
    userStates.set(userId, userStates.get(userId) || {});
    userStates.get(userId).waitingForSongName = false;
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
    
    // Сохраняем данные поиска
    userStates.set(userId, userStates.get(userId) || {});
    
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
  
  // Режим ожидания названия песни
  if (userStates.has(userId) && userStates.get(userId).waitingForSongName) {
    userStates.get(userId).waitingForSongName = false;
    await performSongSearch(msg, text, false);
  }
  // Режим ожидания текста для поиска
  else if (userStates.has(userId) && userStates.get(userId).waitingForTextSearch) {
    userStates.get(userId).waitingForTextSearch = false;
    await performSongSearch(msg, text, true);
  }
  // Режим ожидания текста для поиска аккордов
  else if (userStates.has(userId) && userStates.get(userId).waitingForChordsSearch) {
    userStates.get(userId).waitingForChordsSearch = false;
    await searchSongsForChords(msg, text);
  }
  // Режим ожидания комплексного поиска
  else if (userStates.has(userId) && userStates.get(userId).waitingForSerachSearch) {
    userStates.get(userId).waitingForSerachSearch = false;
    await searchSongsByAll(msg, text);
  }
  // Обычное сообщение - поиск по названию
  else {
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
  
  // Обработка выбора песни
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
    } catch (error) {
      console.error('Ошибка при обработке выбора песни:', error.message);
      await bot.answerCallbackQuery(callback.id, {
        text: 'Произошла ошибка. Попробуйте позже.',
        show_alert: true
      });
    }
    
    // Статистика
    stats.callbacksUsed['song_selection'] = (stats.callbacksUsed['song_selection'] || 0) + 1;
    stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
  }
  // Обработка выбора песни для аккордов
  else if (data.startsWith('chords_')) {
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
      
      // Показываем аккорды
      const chords = extractChords(song.fullText);
      
      if (chords.length === 0) {
        await bot.sendMessage(chatId, `Аккорды для песни "${cleanTitle}" не найдены.`);
      } else {
        await bot.sendMessage(chatId, 
          `Аккорды для песни "${cleanTitle}":\n\n${chords.join(', ')}`,
          { parse_mode: 'HTML' }
        );
      }
      
      // Удаляем сообщение со списком
      await bot.deleteMessage(chatId, callback.message.message_id);
      
      // Подтверждаем обработку
      await bot.answerCallbackQuery(callback.id);
    } catch (error) {
      console.error('Ошибка при обработке выбора песни для аккордов:', error.message);
      await bot.answerCallbackQuery(callback.id, {
        text: 'Произошла ошибка. Попробуйте позже.',
        show_alert: true
      });
    }
    
    // Статистика
    stats.callbacksUsed['chords_selection'] = (stats.callbacksUsed['chords_selection'] || 0) + 1;
    stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
  }
}

/**
 * Отправляет отформатированную песню
 */
async function sendFormattedSong(chatId, formattedText) {
  try {
    // Проверяем длину сообщения
    if (formattedText.length > MAX_MESSAGE_LENGTH) {
      // Разбиваем на части и отправляем
      await sendLongMessage(chatId, formattedText);
    } else {
      // Отправляем обычное сообщение
      await bot.sendMessage(chatId, formattedText, {
        parse_mode: 'HTML'
      });
    }
  } catch (error) {
    console.error('Ошибка отправки песни:', error.message);
    await bot.sendMessage(chatId, 'Произошла ошибка при отправке. Попробуйте позже.');
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
    await bot.sendMessage(chatId, 'Произошла ошибка при отправке. Попробуйте позже.');
  }
}

/**
 * Настройка webhook
 */
async function setupWebhook() {
  try {
    await bot.deleteWebHook();
    
    if (process.env.WEBHOOK_URL) {
      await bot.setWebHook(process.env.WEBHOOK_URL);
      console.log('Webhook установлен:', process.env.WEBHOOK_URL);
    }
  } catch (error) {
    console.error('Ошибка настройки webhook:', error.message);
  }
}

// Endpoint для webhook
app.post('/api/webhook', (req, res) => {
  try {
    bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('Ошибка обработки webhook:', error.message);
    res.sendStatus(500);
  }
});

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
    
    // Пропускаем метаданные, которые идут после заголовка (например, "Ритмика", "Перебор" и т.д.)
    if ((i === skipLines || i === skipLines + 1) && 
        (line.trim() === 'Ритмика' || 
         line.includes('Перебор') || 
         line.includes('Бой') ||
         line.includes('Особенность') ||
         line.includes('Повторение') ||
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
    
    if (songs.length === 0) {
      await bot.sendMessage(chatId, 'Песни не найдены.');
      return;
    }
    
    // Фильтруем песни
    const uniqueSongs = new Map();
    
    for (const song of songs) {
      // Пропускаем ненужные или пустые элементы
      if (!song.title || 
          song.title === 'Ритмика' || 
          song.title.includes('Припев') ||
          song.title.includes('Правила орлятского круга') ||
          song.title.match(/^\d+\.\s/) || 
          song.title.length < 3) {
        continue;
      }
      
      // Очищаем название от символов # ♭
      const cleanTitle = song.title.replace(/[#♭]/g, '').trim();
      
      // Нормализуем название для унификации
      const normalizedTitle = cleanTitle.toLowerCase().trim();
      
      // Обрабатываем дубликаты - оставляем версию с автором, если есть
      if (!uniqueSongs.has(normalizedTitle) || 
          (!uniqueSongs.get(normalizedTitle).author && song.author)) {
        
        // Сохраняем песню с очищенным названием
        const cleanedSong = { ...song, title: cleanTitle };
        uniqueSongs.set(normalizedTitle, cleanedSong);
      }
    }
    
    // Конвертируем в массив и сортируем
    const filteredSongs = Array.from(uniqueSongs.values());
    filteredSongs.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    
    // Формируем сообщение
    let message = `Список песен в аккорднике (${filteredSongs.length}):\n\n`;
    
    for (let i = 0; i < filteredSongs.length; i++) {
      const songNumber = i + 1;
      const song = filteredSongs[i];
      
      // Выводим только название песни без дополнительной информации
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
    // Сообщение о загрузке
    const waitMessage = await bot.sendMessage(chatId, 'Выбираю случайную песню...');
    
    // Получаем список песен
    const { songs } = await fetchSongbookContent();
    
    // Удаляем сообщение загрузки
    try {
      await bot.deleteMessage(chatId, waitMessage.message_id);
    } catch (error) {
      console.error('Ошибка удаления сообщения:', error.message);
    }
    
    if (songs.length === 0) {
      await bot.sendMessage(chatId, 'Песни не найдены.');
      return;
    }
    
    // Выбираем случайную песню
    const randomSong = songs[Math.floor(Math.random() * songs.length)];
    
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
 * Отправляет информацию о последней просмотренной песне
 */
async function handleLastCommand(msg) {
  const userId = msg.from.id;
  const userState = userStates.get(userId);
  
  if (!userState || !userState.lastSongTitle) {
    await bot.sendMessage(msg.chat.id, 'У вас еще нет последней просмотренной песни. Используйте команды /list, /random или /search.');
    return;
  }
  
  try {
    // Ищем последнюю просмотренную песню
    const { songs } = await fetchSongbookContent();
    
    // Найдем песню, сравнивая очищенные названия
    const lastSong = songs.find(s => {
      const cleanTitle = s.title.replace(/[#♭]/g, '').trim();
      return cleanTitle === userState.lastSongTitle;
    });
    
    if (!lastSong) {
      await bot.sendMessage(msg.chat.id, 'Не удалось найти последнюю просмотренную песню.');
      return;
    }
    
    // Очищаем название от символов # ♭
    const cleanTitle = lastSong.title.replace(/[#♭]/g, '').trim();
    
    // Отправляем песню
    const formattedText = formatSongForDisplay(cleanTitle, lastSong.author, lastSong.fullText);
    await sendFormattedSong(msg.chat.id, formattedText);
    
    // Статистика
    stats.commandsUsed['/last'] = (stats.commandsUsed['/last'] || 0) + 1;
    stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
  } catch (error) {
    console.error('Ошибка при получении последней песни:', error.message);
    await bot.sendMessage(msg.chat.id, 'Произошла ошибка. Попробуйте позже.');
  }
}

/**
 * Извлекает аккорды из текста песни
 */
function extractChords(songText) {
  if (!songText) return [];
  
  const lines = songText.split('\n');
  const chords = new Set();
  
  // Регулярное выражение для поиска аккордов
  // Ищем слова, состоящие только из A-G, a-g, #, b, m, dim, sus, maj, min, aug, +, -, 7, 9, 11, 13
  const chordRegex = /\b([A-G][#b]?(?:m|dim|sus|maj|min|aug|\+|\-)?(?:7|9|11|13)?)\b/g;
  
  for (const line of lines) {
    // Проверяем, что строка похожа на строку с аккордами (короткая, содержит аккорды)
    if (line.length < 30) {
      const matches = line.match(chordRegex);
      if (matches) {
        matches.forEach(chord => chords.add(chord));
      }
    }
  }
  
  return Array.from(chords).sort();
}

/**
 * Обработка команды /serach - поиск песни по названию, тексту и автору
 */
async function handleSerachCommand(msg, match) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  let query = match && match[1] ? match[1].trim() : '';
  
  try {
    if (query) {
      // Если указано название песни, ищем её
      await searchSongsByAll(msg, query);
    } else {
      // Если запрос не указан, запрашиваем его
      await bot.sendMessage(chatId, 'Введите название песни, автора или фрагмент текста для поиска:');
      
      userStates.set(userId, userStates.get(userId) || {});
      userStates.get(userId).waitingForSerachSearch = true;
      userStates.get(userId).waitingForSongName = false;
      userStates.get(userId).waitingForTextSearch = false;
      userStates.get(userId).waitingForChordsSearch = false;
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
    // Сообщение о поиске
    const waitMessage = await bot.sendMessage(chatId, 'Ищу песню...');
    
    // Получаем список песен
    const { songs } = await fetchSongbookContent();
    
    // Комплексный поиск по названию, тексту и автору
    let foundSongs = songs.filter(song => {
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
    // Ограничиваем количество результатов
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
