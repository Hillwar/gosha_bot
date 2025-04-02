/**
 * Gosha Bot - Telegram бот для поиска и отображения песен с аккордами
 */

// Зависимости
require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const winston = require('winston');
const { exec } = require('child_process');
const path = require('path');

// КОНСТАНТЫ
const MAX_MESSAGE_LENGTH = 4000; // Оставляем запас под максимальный размер сообщения Telegram (4096)

/**
 * Настройка логирования
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...metadata }) => {
      let msg = `${timestamp} [${level}] : ${message}`;
      if (Object.keys(metadata).length > 0) {
        msg += JSON.stringify(metadata, null, 2);
      }
      return msg;
    })
  ),
  transports: [
    new winston.transports.File({ 
      filename: 'error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({ 
      filename: 'combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
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

// Инициализация состояний и кешей
const userStates = new Map();
const userSongCache = new Map();
const lastSongPageMap = new Map();
const docCache = {
  content: null,
  lastUpdate: null,
  updateInterval: 5 * 60 * 1000 // 5 минут
};

// Статистика использования бота
const stats = {
  searches: 0,
  commands: 0,
  songViews: {},
  commandsUsed: {},
  callbacksUsed: {},
  userActivity: {},
  lastReset: Date.now()
};

/**
 * Инициализация Google API
 */
let auth;
try {
  // Используем файл учетных данных напрямую
  const credentialsPath = path.join(__dirname, '..', 'Gosha IAM Admin.json');
  
  if (require('fs').existsSync(credentialsPath)) {
    console.log('✅ Найден файл учетных данных Google API');
    logger.info(`Используется файл учетных данных: ${credentialsPath}`);
    
    auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/documents.readonly']
    });
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_B64) {
    // Используем учетные данные в формате base64 в качестве запасного варианта
    console.log('⚠️ Файл учетных данных не найден, используется переменная окружения GOOGLE_SERVICE_ACCOUNT_B64');
    logger.info('Используются учетные данные из переменной окружения GOOGLE_SERVICE_ACCOUNT_B64');
    
    let credentials;
    try {
      const decodedCredentials = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString('utf-8');
      credentials = JSON.parse(decodedCredentials);
      
      // Проверяем, нет ли символа конца строки, который может вызвать ошибку
      if (credentials.private_key && credentials.private_key.indexOf('\\n') !== -1) {
        credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
      }
      
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/documents.readonly']
      });
    } catch (err) {
      logger.error('Ошибка при декодировании GOOGLE_SERVICE_ACCOUNT_B64:', {
        error: err.message,
        stack: err.stack
      });
      throw new Error(`Не удалось декодировать учетные данные из переменной GOOGLE_SERVICE_ACCOUNT_B64: ${err.message}`);
    }
  } else {
    // Если учетные данные не предоставлены, выводим предупреждение
    console.warn('ВНИМАНИЕ: Учетные данные Google API не найдены!');
    logger.warn('Учетные данные Google API не найдены. Бот не сможет получать данные из Google Docs.');
    throw new Error('Учетные данные Google API не найдены.');
  }
} catch (error) {
  console.error(`❌ Ошибка инициализации Google API: ${error.message}`);
  logger.error('Ошибка инициализации Google API:', {
    error: error.message,
    stack: error.stack
  });
  
  // Создаем базовую авторизацию для возможности запуска приложения с ошибкой
  auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/documents.readonly']
  });
}

const docs = google.docs({ version: 'v1', auth });

/**
 * Инициализация Telegram Bot
 */
const isDev = process.env.NODE_ENV === 'development';
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

// Общее логирование ошибок бота
bot.on('webhook_error', (error) => {
  logger.error('Webhook error:', error);
});

bot.on('error', (error) => {
  logger.error('Bot error:', error);
});

bot.on('polling_error', (error) => {
  logger.error('Polling error:', error);
});

// Регистрация обработчиков команд
bot.onText(/\/start/, handleStartCommand);
bot.onText(/\/help/, handleHelpCommand);
bot.onText(/\/list/, handleListCommand);
bot.onText(/\/random/, handleRandomCommand);
bot.onText(/\/search(?:\s+(.+))?/, handleSearchCommand);
bot.onText(/\/text(?:\s+(.+))?/, handleTextCommand);

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
async function initializeBot() {
  try {
    console.log('');
    console.log('=====================================');
    console.log('        🎸 Gosha Bot Запуск 🎵       ');
    console.log('=====================================');
    console.log('');
    
    // Проверяем переменные окружения
    if (!checkRequiredEnvVariables()) {
      return;
    }
    
    // Запускаем Express-сервер
    const PORT = process.env.PORT || 3333;
    const server = app.listen(PORT, () => {
      logger.info(`Сервер запущен на порту ${PORT}`);
      console.log(`✅ Сервер запущен на порту ${PORT}`);
    });
    
    // Обработка ошибок сервера
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Порт ${PORT} уже используется. Выберите другой порт.`);
        console.error(`❌ Ошибка: порт ${PORT} уже используется. Выберите другой порт в .env файле.`);
      } else {
        logger.error('Ошибка запуска сервера:', {
          error: error.message,
          stack: error.stack
        });
        console.error('❌ Ошибка запуска сервера:', error.message);
      }
    });
    
    // Активируем бота
    try {
      if (!process.env.BOT_TOKEN) {
        throw new Error('BOT_TOKEN не задан в переменных окружения');
      }
      
      // Проверяем режим работы бота
      if (isDev) {
        logger.info('Бот запущен в режиме опроса (polling)');
        console.log('🤖 Бот запущен в режиме опроса (polling)');
        bot.startPolling();
      } else {
        logger.info('Бот запущен в режиме webhook');
        console.log('🤖 Бот запущен в режиме webhook');
        await setupWebhook();
      }
      
      console.log('✅ Бот успешно активирован и готов к обработке сообщений');
    } catch (error) {
      logger.error('Ошибка активации бота:', {
        error: error.message,
        stack: error.stack
      });
      console.error('❌ Ошибка активации бота:', error.message);
      return;
    }
    
    // Тестируем доступ к Google Docs
    try {
      logger.info('Проверка доступа к Google Docs...');
      console.log('🔄 Проверка доступа к Google Docs...');
      
      const document = await getDocumentContent();
      
      if (!document || !document.body || !document.body.content) {
        logger.error('Недопустимая структура документа при запуске');
        console.error('❌ Ошибка доступа к документу: недопустимая структура документа');
        console.error('⚠️ Бот запущен, но функции, связанные с Google Docs, могут не работать');
        return;
      }
      
      const titleCount = document.body.content.filter(item => 
        item && item.paragraph && 
        item.paragraph.paragraphStyle && 
        item.paragraph.paragraphStyle.namedStyleType === 'TITLE'
      ).length;
      
      logger.info(`Успешное подключение к Google Docs. Найдено ${titleCount} заголовков.`);
      console.log(`✅ Успешное подключение к Google Docs. Найдено ${titleCount} заголовков`);
      console.log('');
      console.log('🤖 Бот запущен и готов к работе!');
      console.log('');
    } catch (error) {
      logger.error('Ошибка доступа к Google Docs при запуске:', {
        error: error.message,
        url: process.env.SONGBOOK_URL || 'не задан'
      });
      console.error('❌ Ошибка доступа к Google Docs:', error.message);
      console.error('⚠️ Бот запущен, но функции, связанные с Google Docs, могут не работать');
      console.log('');
    }
  } catch (error) {
    logger.error('Ошибка инициализации бота:', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ Критическая ошибка при запуске бота:', error.message);
  }
}

// Запускаем бот
initializeBot();

/**
 * ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
 */

/**
 * Извлекает ID документа из URL Google Docs
 * @param {string} url - URL документа Google Docs
 * @returns {string} - ID документа
 */
function getDocumentIdFromUrl(url) {
  if (!url) {
    throw new Error('URL документа не указан');
  }
  
  if (url.includes('/d/')) {
    // Формат: https://docs.google.com/document/d/DOCUMENT_ID/edit
    return url.split('/d/')[1].split('/')[0];
  } else if (url.includes('?id=')) {
    // Формат: https://docs.google.com/document/edit?id=DOCUMENT_ID
    return url.split('?id=')[1].split('&')[0];
  } else if (url.match(/^[a-zA-Z0-9_-]{25,}$/)) {
    // Если указан только ID документа
    return url;
  } else {
    throw new Error(`Неверный формат URL документа: ${url}`);
  }
}

/**
 * Получает содержимое документа с кешированием
 * @returns {Promise<Object>} - Данные документа от Google API
 */
async function getDocumentContent() {
  try {
    const now = Date.now();
    // Возвращаем кешированный контент, если он актуален
    if (docCache.content && docCache.lastUpdate && (now - docCache.lastUpdate < docCache.updateInterval)) {
      logger.debug('Using cached document content');
      return docCache.content;
    }

    // Проверяем наличие URL документа
    if (!process.env.SONGBOOK_URL) {
      logger.error('SONGBOOK_URL is not set in environment variables');
      throw new Error('SONGBOOK_URL is not configured');
    }

    logger.info('Fetching fresh document content');
    
    // Извлекаем ID документа из URL
    const url = process.env.SONGBOOK_URL;
    const documentId = getDocumentIdFromUrl(url);
    
    logger.debug(`Извлечен ID документа: ${documentId} из URL: ${url}`);
    
    // Проверка учетных данных сервисного аккаунта
    if (!process.env.GOOGLE_SERVICE_ACCOUNT && !process.env.GOOGLE_SERVICE_ACCOUNT_B64) {
      logger.error('Google service account credentials not provided');
      throw new Error('Missing Google service account credentials');
    }
    
    // Делаем запрос к Google API
    logger.debug('Making API request to Google Docs', {
      documentId,
      serviceAccountType: process.env.GOOGLE_SERVICE_ACCOUNT_B64 ? 'Base64 encoded' : 'JSON'
    });
    
    const document = await docs.documents.get({
      documentId: documentId
    });
    
    // Проверяем результат запроса
    if (!document || !document.data) {
      logger.error('Google API returned empty document', {
        responseStatus: document ? document.status : 'undefined',
        documentId
      });
      throw new Error('Empty document received from Google API');
    }
    
    logger.debug('Document received from Google API', { 
      documentTitle: document.data.title,
      hasContent: document.data.body && document.data.body.content ? 'yes' : 'no',
      contentLength: document.data.body && document.data.body.content ? document.data.body.content.length : 0
    });
    
    // Обновляем кеш
    docCache.content = document.data;
    docCache.lastUpdate = now;
    logger.debug('Document content updated successfully');
    return document.data;
  } catch (error) {
    logger.error('Error fetching document content:', {
      error: error.message,
      stack: error.stack,
      url: process.env.SONGBOOK_URL || 'not set',
      apiError: error.response ? JSON.stringify(error.response.data) : 'No API response'
    });
    throw error;
  }
}

/**
 * Получает содержимое песни по номеру страницы
 * @param {string} documentId - ID документа Google Docs
 * @param {number} pageNumber - Номер страницы/песни
 * @returns {Promise<string|null>} - Текст песни или null при ошибке
 */
async function getSongContent(documentId, pageNumber) {
  try {
    const document = await getDocumentContent();
    
    if (!document || !document.body || !document.body.content) {
      logger.error('Document structure is invalid for getSongContent');
      throw new Error('Invalid document structure');
    }
    
    // Начинаем со второй страницы (пропускаем правила)
    let currentPage = 2;
    let foundSong = false;
    let title = '';
    let paragraphContent = [];
    
    for (const element of document.body.content) {
      if (element && element.paragraph) {
        const paragraphStyle = element.paragraph.paragraphStyle;
        const paragraphElements = element.paragraph.elements;
        
        // Если это заголовок (начало новой песни)
        if (paragraphStyle && paragraphStyle.namedStyleType === 'TITLE' && paragraphElements && paragraphElements[0]) {
          // Если мы уже нашли нужную песню и наткнулись на следующий заголовок, 
          // значит дошли до конца песни и можем выходить из цикла
          if (foundSong) {
            break;
          }
          
          // Если это нужная нам страница, начинаем собирать текст песни
          if (currentPage === pageNumber) {
            foundSong = true;
            const titleText = paragraphElements[0].textRun ? paragraphElements[0].textRun.content.trim() : '';
            title = titleText;
            
            // Сохраняем заголовок в структуру данных
            paragraphContent.push({
              type: 'title',
              text: titleText
            });
          }
          
          // Увеличиваем счетчик страниц на каждом заголовке
          currentPage++;
        } 
        // Если это не заголовок и мы уже нашли нужную песню
        else if (foundSong && paragraphElements) {
          let isParagraphHeader = false;
          
          // Проверяем, содержит ли параграф ключевые слова, указывающие на заголовок раздела песни
          const headerKeywords = ['припев', 'chorus', 'куплет', 'verse', 'бридж', 'bridge'];
          let paragraphText = '';
          
          // Собираем текст из всех элементов параграфа
          for (const paraElement of paragraphElements) {
            if (paraElement.textRun) {
              paragraphText += paraElement.textRun.content;
            }
          }
          
          paragraphText = paragraphText.trim();
          
          // Проверяем, является ли это заголовком (например, "Припев:", "Chorus:" и т.д.)
          for (const keyword of headerKeywords) {
            if (paragraphText.toLowerCase().includes(keyword.toLowerCase() + ':') || 
                paragraphText.toLowerCase().includes(keyword.toLowerCase() + '.')) {
              isParagraphHeader = true;
              break;
            }
          }
          
          // Определяем тип параграфа и добавляем его в структуру
          if (isParagraphHeader) {
            paragraphContent.push({
              type: 'header',
              text: paragraphText
            });
          } else if (paragraphText.trim() !== '') {
            // Добавляем текст, только если он не пустой
            paragraphContent.push({
              type: 'text',
              text: paragraphText
            });
          }
        }
      }
    }
    
    // Если песня не найдена, выбрасываем ошибку
    if (!foundSong) {
      logger.error(`Song with page number ${pageNumber} not found`);
      throw new Error(`Song with page number ${pageNumber} not found`);
    }
    
    // Форматируем структуру песни в текст
    const songText = formatSongTextStructure(paragraphContent);
    
    // Для аналитики
    stats.songViews[title] = (stats.songViews[title] || 0) + 1;
    
    return songText;
  } catch (error) {
    logger.error('Error getting song content:', {
      error: error.message,
      documentId,
      pageNumber
    });
    return null;
  }
}

/**
 * Форматирует структурированную песню в текст
 * @param {Array} paragraphs - Массив параграфов с типами и текстом
 * @returns {string} - Отформатированный текст песни
 */
function formatSongTextStructure(paragraphs) {
  if (!paragraphs || paragraphs.length === 0) return '';
  
  let result = '';
  let currentSection = null;
  
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    
    if (para.type === 'title') {
      // Добавляем название песни
      result += para.text + '\n\n';
      currentSection = 'title';
    } 
    else if (para.type === 'header') {
      // Перед заголовком куплета добавляем пустую строку, если еще не было заголовка
      if (currentSection && currentSection !== 'title') {
        result += '\n';
      }
      result += para.text + '\n';
      currentSection = 'header';
    } 
    else if (para.type === 'text') {
      // Обычный текст просто добавляем
      result += para.text + '\n';
      currentSection = 'text';
    }
  }
  
  return result.trim();
}

/**
 * Экранирует HTML-специальные символы для корректного отображения
 * @param {string} text - Исходный текст
 * @returns {string} - Текст с экранированными HTML-символами
 */
function formatSongForDisplay(text) {
  if (!text) return '';
  
  // Экранируем HTML-символы для корректного отображения
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Извлекает метаданные из текста песни
 * @param {string} text - Текст песни
 * @returns {Object} - Объект с метаданными песни
 */
function extractSongInfo(text) {
  const info = {
    author: null,
    rhythm: null,
    notes: null,
    cleanText: ''
  };
  
  // Если текст не предоставлен, возвращаем пустую информацию
  if (!text) return info;
  
  const lines = text.split('\n');
  
  // Расширенные регулярные выражения для поиска метаданных
  const authorRegexes = [
    /^(Автор|Музыка|Слова|Муз\.|Сл\.|Автор и музыка)[:\s]+(.+)$/i,
    /^(Слова и музыка)[:\s]+(.+)$/i,
    /^.*?(автор|музыка)[:\s]+([^,]+).*/i
  ];
  
  const rhythmRegexes = [
    /^(Ритм|Ритмика|Бой)[:\s]+(.+)$/i,
    /^.*?(ритм|ритмика)[:\s]+([^,]+).*/i,
    /^(Сложный бой|Простой бой|Перебор)$/i
  ];
  
  const notesRegexes = [
    /^(Примечание|Note|Примеч\.)[:\s]+(.+)$/i,
    /^.*?(примечание)[:\s]+([^,]+).*/i
  ];
  
  // Дополнительно ищем строки с "Слова и музыка" или другими форматами указания авторства
  const titleAuthorRegex = /^(.+)\s+\((.+)\)$/;
  
  // Сохраняем метаданные и текст песни отдельно
  const songLines = [];
  let inMetaSection = true;
  let skipFirstLine = true; // Пропускаем первую строку, т.к. это название песни
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Пропускаем первую строку (название)
    if (skipFirstLine) {
      skipFirstLine = false;
      continue;
    }
    
    // Проверяем на совпадение с форматом "Название (Автор)"
    if (i === 0 && titleAuthorRegex.test(line)) {
      const match = line.match(titleAuthorRegex);
      if (match && match[2]) {
        info.author = match[2].trim();
      }
      continue;
    }
    
    // Проверяем на совпадение с шаблонами автора
    let isAuthor = false;
    for (const regex of authorRegexes) {
      const match = line.match(regex);
      if (match && match[2]) {
        info.author = match[2].trim();
        isAuthor = true;
        break;
      }
    }
    if (isAuthor) continue;
    
    // Проверяем на совпадение с шаблонами ритма
    let isRhythm = false;
    for (const regex of rhythmRegexes) {
      const match = line.match(regex);
      if (match) {
        if (match[2]) {
          info.rhythm = match[2].trim();
        } else if (match[1]) {
          info.rhythm = match[1].trim();
        }
        isRhythm = true;
        break;
      }
    }
    if (isRhythm) continue;
    
    // Проверяем на совпадение с шаблонами примечаний
    let isNote = false;
    for (const regex of notesRegexes) {
      const match = line.match(regex);
      if (match && match[2]) {
        info.notes = match[2].trim();
        isNote = true;
        break;
      }
    }
    if (isNote) continue;
    
    // Если встретили строку с текстом песни после метаданных, 
    // значит метаданные закончились
    if (inMetaSection && line) {
      inMetaSection = false;
    }
    
    // Если это не метаданные, добавляем в текст песни
    songLines.push(lines[i]);
  }
  
  // Проверяем наличие информации об авторе в первых строках
  if (!info.author) {
    // Ищем во всех строках упоминания об авторе
    for (let i = 0; i < Math.min(5, songLines.length); i++) {
      const line = songLines[i].trim();
      
      // Поиск строк вида "Автор: Ю. Устинова" или похожих форматов
      for (const regex of authorRegexes) {
        const match = line.match(regex);
        if (match && match[2]) {
          info.author = match[2].trim();
          // Удаляем эту строку из текста песни
          songLines.splice(i, 1);
          break;
        }
      }
      
      if (info.author) break;
    }
  }
  
  // Собираем текст песни, сохраняя все переносы строк
  info.cleanText = songLines.join('\n');
  return info;
}

/**
 * Поиск песен по названию или тексту
 * @param {string} query - Поисковый запрос
 * @param {boolean} searchByText - Флаг поиска по тексту (если false - по названию)
 * @returns {Promise<Array>} - Массив найденных песен
 */
async function searchSongs(query, searchByText = false) {
  try {
    const document = await getDocumentContent();
    
    if (!document || !document.body || !document.body.content) {
      logger.error('Document structure is invalid for searchSongs');
      throw new Error('Invalid document structure');
    }
    
    // Находим все TITLE элементы в документе
    const titleElements = document.body.content.filter(item => 
      item && item.paragraph && 
      item.paragraph.paragraphStyle && 
      item.paragraph.paragraphStyle.namedStyleType === 'TITLE' &&
      item.paragraph.elements && 
      item.paragraph.elements[0] && 
      item.paragraph.elements[0].textRun
    );
    
    if (titleElements.length <= 1) {
      logger.warn('В документе недостаточно песен для поиска');
      return [];
    }
    
    // Всегда пропускаем первый заголовок (правила) и начинаем со второго
    const foundTitles = [];
    
    // Начинаем с индекса 1 (второй элемент)
    for (let i = 1; i < titleElements.length; i++) {
      const title = titleElements[i].paragraph.elements[0].textRun.content.trim();
      
      // Пропускаем заголовки, которые явно не песни
      if (title && 
          !title.includes('Правила') &&
          !title.match(/^\d+\./) && // Не начинаются с номера и точки (правила)
          title !== 'Припев.' && 
          title !== 'Припев:' &&
          !title.match(/^Будь осознанным/)) {
        foundTitles.push({ title, page: i + 1 });  // Страница = индекс + 1
      }
    }
    
    logger.info(`Всего найдено ${foundTitles.length} песен в документе после фильтрации`);
    
    const songs = [];
    
    // Для поиска по названию используем более точное сопоставление
    if (!searchByText) {
      const normalizedQuery = query.toLowerCase().trim();
      
      // Сначала проверяем точное соответствие (слово в слово)
      let exactMatches = foundTitles.filter(item => 
        item.title.toLowerCase() === normalizedQuery
      );
      
      // Если точных совпадений нет, тогда ищем по вхождению слова в название
      if (exactMatches.length === 0) {
        // Разбиваем запрос на слова для более точного поиска
        const queryWords = normalizedQuery.split(/\s+/);
        
        // Проверяем, содержит ли название каждое из слов запроса
        exactMatches = foundTitles.filter(item => {
          const titleLower = item.title.toLowerCase();
          // Песня должна содержать все слова из запроса
          return queryWords.every(word => titleLower.includes(word));
        });
        
        // Если и так не нашли совпадений, то используем обычное частичное совпадение
        if (exactMatches.length === 0) {
          exactMatches = foundTitles.filter(item => 
            item.title.toLowerCase().includes(normalizedQuery)
          );
        }
      }
      
      logger.info(`Найдено ${exactMatches.length} совпадений по названию для запроса "${query}"`, {
        query,
        matches: exactMatches.map(m => m.title)
      });
      
      // Получаем содержимое для найденных заголовков
      for (const titleInfo of exactMatches) {
        try {
          const documentId = getDocumentIdFromUrl(process.env.SONGBOOK_URL);
          const songContent = await getSongContent(documentId, titleInfo.page);
          
          if (songContent) {
            songs.push({
              title: titleInfo.title,
              content: songContent,
              page: titleInfo.page
            });
          }
        } catch (error) {
          logger.error(`Ошибка получения содержимого песни для страницы ${titleInfo.page}:`, {
            error: error.message
          });
          // Продолжаем поиск даже при ошибке для одной из песен
        }
      }
    } 
    // Поиск по тексту песни
    else {
      const normalizedQuery = query.toLowerCase().trim();
      
      // Для каждого заголовка получаем содержимое песни
      for (const titleInfo of foundTitles) {
        try {
          const documentId = getDocumentIdFromUrl(process.env.SONGBOOK_URL);
          const songContent = await getSongContent(documentId, titleInfo.page);
          
          if (songContent && songContent.toLowerCase().includes(normalizedQuery)) {
            songs.push({
              title: titleInfo.title,
              content: songContent,
              page: titleInfo.page
            });
          }
        } catch (error) {
          logger.error(`Ошибка получения содержимого песни для страницы ${titleInfo.page}:`, {
            error: error.message
          });
          // Продолжаем поиск даже при ошибке для одной из песен
        }
      }
    }
    
    logger.info(`Найдено ${songs.length} песен для запроса "${query}"`, {
      query,
      searchByText,
      songs: songs.map(s => ({ title: s.title, page: s.page }))
    });
    return songs;
  } catch (error) {
    logger.error('Ошибка поиска песен:', {
      error: error.message,
      stack: error.stack,
      query,
      searchByText
    });
    return [];
  }
}

/**
 * ОБРАБОТЧИКИ КОМАНД БОТА
 */

/**
 * Обработка команды /start
 * @param {Object} msg - Сообщение от пользователя
 */
async function handleStartCommand(msg) {
  const userId = msg.from.id;
  const userName = msg.from.first_name;
  
  logger.info(`User ${userId} (${userName}) started the bot`, {
    command: '/start',
    user: {
      id: userId,
      name: userName
    }
  });
  
  await bot.sendMessage(
    msg.chat.id, 
    `Привет, ${userName}! Я помогу найти тексты песен под гитару. Используй команду /search название_песни для поиска.`,
    { parse_mode: 'HTML' }
  );
  
  // Инициализируем состояние пользователя, если его ещё нет
  if (!userStates.has(userId)) {
    userStates.set(userId, {
      waitingForSongName: false,
      waitingForTextSearch: false,
      lastSongPage: null,
      lastSearch: null
    });
  }
  
  // Регистрируем статистику использования команды
  stats.commandsUsed['/start'] = (stats.commandsUsed['/start'] || 0) + 1;
  stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
}

/**
 * Обработка команды /help
 * @param {Object} msg - Сообщение от пользователя
 */
async function handleHelpCommand(msg) {
  const userId = msg.from.id;
  const userName = msg.from.first_name;
  
  logger.info(`User ${userId} (${userName}) requested help`, {
    command: '/help',
    user: {
      id: userId,
      name: userName
    }
  });
  
  const helpMessage = 
    'Список доступных команд:\n\n' +
    '/search <название песни> - поиск песни по названию\n' +
    '/text <текст> - поиск песни по тексту\n' +
    '/list - список всех песен\n' +
    '/random - случайная песня\n' +
    '/help - эта справка';
  
  await bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'HTML' });
  
  // Регистрируем статистику использования команды
  stats.commandsUsed['/help'] = (stats.commandsUsed['/help'] || 0) + 1;
  stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
}

// Функция для отправки сообщения с анимацией загрузки
const sendLoadingMessage = async (ctx) => {
  return await ctx.sendMessage('Загрузка...');
};

// Функция для удаления сообщения с анимацией загрузки
const deleteLoadingMessage = async (ctx, messageId) => {
  try {
    await ctx.deleteMessage(messageId);
  } catch (error) {
    console.error('Ошибка при удалении сообщения:', error);
  }
};

/**
 * Обработка команды /search - поиск песни по названию
 * @param {Object} msg - Сообщение от пользователя
 * @param {string} match - Результат регулярного выражения
 */
async function handleSearchCommand(msg, match) {
  const userId = msg.from.id;
  const userName = msg.from.first_name;
  
  // Определяем поисковый запрос из текста сообщения
  let query = '';
  
  // Если пришло сообщение с параметром сразу (например, /search Алые паруса)
  if (match && match[1]) {
    query = match[1].trim();
  }
  
  logger.info(`User ${userId} (${userName}) searching for song by name`, {
    command: '/search',
    query,
    user: {
      id: userId,
      name: userName
    }
  });
  
  if (query) {
    // Если запрос передан, осуществляем поиск
    await performSongSearch(msg, query, false);
  } else {
    // Если запрос не передан, запрашиваем название песни
    await bot.sendMessage(msg.chat.id, 'Введите название песни для поиска:');
    
    // Устанавливаем флаг ожидания названия песни для данного пользователя
    userStates.set(userId, userStates.get(userId) || {});
    userStates.get(userId).waitingForSongName = true;
    userStates.get(userId).waitingForTextSearch = false;
  }
  
  // Регистрируем статистику использования команды
  stats.commandsUsed['/search'] = (stats.commandsUsed['/search'] || 0) + 1;
  stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
}

/**
 * Обработка команды /text - поиск песни по тексту
 * @param {Object} msg - Сообщение от пользователя
 * @param {string} match - Результат регулярного выражения
 */
async function handleTextCommand(msg, match) {
  const userId = msg.from.id;
  const userName = msg.from.first_name;
  
  // Определяем поисковый запрос из текста сообщения
  let query = '';
  
  // Если пришло сообщение с параметром сразу (например, /text Уеду к северному)
  if (match && match[1]) {
    query = match[1].trim();
  }
  
  logger.info(`User ${userId} (${userName}) searching for song by text`, {
    command: '/text',
    query,
    user: {
      id: userId,
      name: userName
    }
  });
  
  if (query) {
    // Если запрос передан, осуществляем поиск по тексту
    await performSongSearch(msg, query, true);
  } else {
    // Если запрос не передан, запрашиваем текст для поиска
    await bot.sendMessage(msg.chat.id, 'Введите фрагмент текста песни для поиска:');
    
    // Устанавливаем флаг ожидания текста для данного пользователя
    userStates.set(userId, userStates.get(userId) || {});
    userStates.get(userId).waitingForSongName = false;
    userStates.get(userId).waitingForTextSearch = true;
  }
  
  // Регистрируем статистику использования команды
  stats.commandsUsed['/text'] = (stats.commandsUsed['/text'] || 0) + 1;
  stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
}

/**
 * Выполнение поиска песни
 * @param {Object} msg - Сообщение от пользователя
 * @param {string} query - Поисковый запрос
 * @param {boolean} searchByText - Флаг поиска по тексту (если false - по названию)
 */
async function performSongSearch(msg, query, searchByText = false) {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    let messageText = '';
    
    // Отправляем сообщение о том, что поиск начат
    const waitMessage = await bot.sendMessage(
      chatId, 
      searchByText ? 'Ищу песню по тексту...' : 'Ищу песню по названию...'
    );
    
    // Выполняем поиск песен
    const songs = await searchSongs(query, searchByText);
    
    // Сохраняем последний поисковый запрос в состоянии пользователя
    userStates.set(userId, userStates.get(userId) || {});
    userStates.get(userId).lastSearch = {
      query: query,
      searchByText: searchByText
    };
    
    // Обработка результатов поиска
    if (songs.length === 0) {
      messageText = 'К сожалению, по вашему запросу ничего не найдено. Попробуйте изменить запрос или воспользуйтесь командой /list для просмотра всех доступных песен.';
      await bot.editMessageText(messageText, {
        chat_id: chatId,
        message_id: waitMessage.message_id
      });
      
      logger.info(`No songs found for query "${query}"`, {
        searchByText,
        userId
      });
      return;
    }
    
    // Если найдена только одна песня, отправляем её сразу
    if (songs.length === 1) {
      const song = songs[0];
      
      // Удаляем предыдущее сообщение о поиске
      await bot.deleteMessage(chatId, waitMessage.message_id);
      
      // Отправляем найденную песню
      await sendFormattedSong(chatId, song.title, song.content);
      
      // Сохраняем номер страницы последней отправленной песни
      userStates.get(userId).lastSongPage = song.page;
      
      logger.info(`Found and sent one song for query "${query}"`, {
        searchByText,
        userId,
        songTitle: song.title
      });
      return;
    }
    
    // Если найдено несколько песен, отправляем список с кнопками выбора
    messageText = `Найдено ${songs.length} песен. Выберите нужную:`;
    
    // Создаем клавиатуру с названиями песен
    const keyboard = songs.map(song => {
      return [{
        text: song.title,
        callback_data: `song_${song.page}`
      }];
    });
    
    // Отправляем сообщение с вариантами выбора
    await bot.editMessageText(messageText, {
      chat_id: chatId,
      message_id: waitMessage.message_id,
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
    
    logger.info(`Found ${songs.length} songs for query "${query}"`, {
      searchByText,
      userId,
      songTitles: songs.map(s => s.title)
    });
  } catch (error) {
    logger.error('Error performing song search:', {
      error: error.message,
      stack: error.stack,
      query,
      searchByText,
      userId: msg.from.id
    });
    
    await bot.sendMessage(
      msg.chat.id, 
      'Произошла ошибка при поиске. Пожалуйста, попробуйте позже или воспользуйтесь командой /list для просмотра всех доступных песен.'
    );
  }
}

/**
 * Обработка обычных текстовых сообщений для поиска песен
 * @param {Object} msg - Сообщение от пользователя
 */
async function handleTextMessage(msg) {
  const userId = msg.from.id;
  const text = msg.text.trim();
  
  // Если у пользователя активен режим ожидания ввода названия песни
  if (userStates.has(userId) && userStates.get(userId).waitingForSongName) {
    userStates.get(userId).waitingForSongName = false;
    
    logger.info(`User ${userId} provided song name for search: "${text}"`, {
      messageType: 'text',
      user: {
        id: userId,
        name: msg.from.first_name
      }
    });
    
    // Выполняем поиск песни по названию
    await performSongSearch(msg, text, false);
  }
  // Если у пользователя активен режим ожидания ввода текста для поиска
  else if (userStates.has(userId) && userStates.get(userId).waitingForTextSearch) {
    userStates.get(userId).waitingForTextSearch = false;
    
    logger.info(`User ${userId} provided text for song search: "${text}"`, {
      messageType: 'text',
      user: {
        id: userId,
        name: msg.from.first_name
      }
    });
    
    // Выполняем поиск песни по тексту
    await performSongSearch(msg, text, true);
  }
  // Обычное текстовое сообщение, обрабатываем как поиск по названию песни
  else {
    logger.info(`User ${userId} sent text message: "${text}"`, {
      messageType: 'text',
      user: {
        id: userId,
        name: msg.from.first_name
      }
    });
    
    // Выполняем поиск песни по названию
    await performSongSearch(msg, text, false);
  }
}

/**
 * Обработка нажатий на встроенные кнопки
 * @param {Object} callback - Callback query от пользователя
 */
async function handleCallbackQuery(callback) {
  const userId = callback.from.id;
  const userName = callback.from.first_name;
  const data = callback.data;
  const chatId = callback.message.chat.id;
  
  logger.info(`User ${userId} (${userName}) clicked button: ${data}`, {
    messageType: 'callbackQuery',
    user: {
      id: userId,
      name: userName
    }
  });
  
  // Проверяем, что callback является запросом на получение песни
  if (data.startsWith('song_')) {
    const pageNumber = parseInt(data.split('_')[1], 10);
    
    // Пытаемся скачать песню по номеру страницы
    try {
      const documentId = getDocumentIdFromUrl(process.env.SONGBOOK_URL);
      const songContent = await getSongContent(documentId, pageNumber);
      
      if (!songContent) {
        await bot.answerCallbackQuery(callback.id, {
          text: 'Не удалось загрузить песню. Пожалуйста, попробуйте еще раз или выберите другую песню.',
          show_alert: true
        });
        return;
      }
      
      // Извлекаем заголовок песни из содержимого
      const songTitle = songContent.split('\n')[0].trim();
      
      // Сохраняем номер страницы последней отправленной песни
      userStates.set(userId, userStates.get(userId) || {});
      userStates.get(userId).lastSongPage = pageNumber;
      
      // Отправляем песню пользователю
      await sendFormattedSong(chatId, songTitle, songContent);
      
      // Удаляем сообщение со списком песен
      await bot.deleteMessage(chatId, callback.message.message_id);
      
      // Сообщаем, что запрос обработан успешно
      await bot.answerCallbackQuery(callback.id);
    } catch (error) {
      logger.error('Error handling callback query for song selection:', {
        error: error.message,
        stack: error.stack,
        userId,
        pageNumber
      });
      
      await bot.answerCallbackQuery(callback.id, {
        text: 'Произошла ошибка при загрузке песни. Пожалуйста, попробуйте позже.',
        show_alert: true
      });
    }
    
    // Регистрируем статистику использования callback-кнопок
    stats.callbacksUsed['song_selection'] = (stats.callbacksUsed['song_selection'] || 0) + 1;
    stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
  }
}

/**
 * Отправляет отформатированную песню пользователю
 * @param {number} chatId - ID чата для отправки
 * @param {string} title - Название песни
 * @param {string} content - Содержимое песни
 * @param {boolean} isRandom - Признак случайной песни
 */
async function sendFormattedSong(chatId, title, content, isRandom = false) {
  try {
    if (!content) {
      await bot.sendMessage(chatId, 'Не удалось загрузить содержимое песни.');
      return;
    }
    
    // Извлекаем информацию о песне (автор, ритм, примечания)
    const songInfo = extractSongInfo(content);
    
    // Форматируем текст песни для отображения
    const formattedText = formatSongForDisplay(content);
    
    // Определяем текст сообщения
    let messageText = '';
    
    // Для случайной песни добавляем соответствующий заголовок
    if (isRandom) {
      messageText = `🎲 <b>Случайная песня</b>\n\n`;
    }
    
    // Добавляем заголовок песни без лишнего вступления
    messageText += `<b>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b>`;
    
    // Добавляем информацию об авторе, если она есть
    if (songInfo.author) {
      messageText += `\n<i>${songInfo.author.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</i>`;
    }
    
    // Добавляем информацию о ритме, если она есть
    if (songInfo.rhythm) {
      messageText += `\n<i>Ритм: ${songInfo.rhythm.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</i>`;
    }
    
    // Добавляем примечания, если они есть
    if (songInfo.notes) {
      messageText += `\n<i>Примечание: ${songInfo.notes.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</i>`;
    }
    
    // Добавляем основной текст песни
    messageText += `\n\n${formattedText}`;
    
    // Проверяем длину сообщения
    if (messageText.length > MAX_MESSAGE_LENGTH) {
      // Разбиваем на части и отправляем по частям
      await sendLongMessage(chatId, messageText);
    } else {
      // Отправляем обычное сообщение
      await bot.sendMessage(chatId, messageText, {
        parse_mode: 'HTML'
      });
    }
    
    // Увеличиваем счетчик просмотров для данной песни
    stats.songViews[title] = (stats.songViews[title] || 0) + 1;
  } catch (error) {
    logger.error('Error sending formatted song:', {
      error: error.message,
      stack: error.stack,
      chatId,
      title
    });
    
    await bot.sendMessage(
      chatId, 
      'Произошла ошибка при отправке песни. Пожалуйста, попробуйте позже.'
    );
  }
}

/**
 * Отправляет длинное сообщение, разбивая его на части
 * @param {number} chatId - ID чата для отправки
 * @param {string} text - Длинное сообщение
 */
async function sendLongMessage(chatId, text) {
  try {
    // Определяем максимальную длину одного сообщения (с запасом)
    const maxLength = MAX_MESSAGE_LENGTH - 300;
    
    // Если сообщение укладывается в лимит, отправляем его напрямую
    if (text.length <= maxLength) {
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
      return;
    }
    
    // Разбиваем текст на строки
    const lines = text.split('\n');
    let currentPart = '';
    
    // Определяем, является ли первая часть заголовком
    let firstLines = [];
    let titleLine = '';
    
    // Ищем заголовок и метаданные (до первой пустой строки)
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      if (lines[i].trim() === '') {
        break;
      }
      
      if (i === 0) {
        titleLine = lines[i];
      }
      
      firstLines.push(lines[i]);
    }
    
    // Собираем заголовок и метаданные
    const headerText = firstLines.join('\n');
    currentPart = headerText + '\n\n';
    
    // Проходим по оставшимся строкам и собираем части сообщения
    for (let i = firstLines.length; i < lines.length; i++) {
      const line = lines[i];
      
      // Проверяем, не будет ли превышен лимит при добавлении строки
      if (currentPart.length + line.length + 1 > maxLength) {
        // Если часть не пустая, отправляем её
        if (currentPart.trim()) {
          await bot.sendMessage(chatId, currentPart, { parse_mode: 'HTML' });
        }
        
        // Начинаем новую часть (первая часть каждой следующей части - это заголовок)
        currentPart = titleLine ? `<b>[Продолжение] ${titleLine.replace(/<b>|<\/b>/g, '')}</b>\n\n${line}\n` : line + '\n';
      } else {
        // Добавляем строку к текущей части
        currentPart += line + '\n';
      }
    }
    
    // Отправляем последнюю часть, если есть
    if (currentPart.trim()) {
      await bot.sendMessage(chatId, currentPart, { parse_mode: 'HTML' });
    }
  } catch (error) {
    logger.error('Error sending long message:', {
      error: error.message,
      stack: error.stack,
      chatId
    });
    
    await bot.sendMessage(
      chatId, 
      'Произошла ошибка при отправке сообщения. Пожалуйста, попробуйте позже.'
    );
  }
}

/**
 * Настройка webhook с использованием ngrok или заданного URL
 * @returns {Promise<void>}
 */
async function setupWebhook() {
  try {
    // Сначала удаляем существующий webhook для очистки предыдущих сессий
    await bot.deleteWebHook();
    logger.info('Существующий webhook удален');
    
    // Проверяем, предоставлен ли URL webhook напрямую
    if (process.env.WEBHOOK_URL) {
      await bot.setWebHook(process.env.WEBHOOK_URL);
      logger.info('Новый webhook установлен из окружения:', process.env.WEBHOOK_URL);
      
      const webhookInfo = await bot.getWebHookInfo();
      logger.info('Информация о webhook:', webhookInfo);
      return;
    }
    
    // В противном случае используем ngrok
    // Запускаем ngrok
    const ngrokPath = path.join(__dirname, '..', 'ngrok.exe'); // Настройте путь при необходимости
    const ngrok = exec(`${ngrokPath} http 3333`, (error, stdout, stderr) => {
      if (error) {
        logger.error('Ошибка запуска ngrok:', error);
        return;
      }
      logger.info('Ngrok запущен:', stdout);
    });

    // Ждем запуска ngrok
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Получаем URL ngrok
    const response = await fetch('http://localhost:4040/api/tunnels');
    const data = await response.json();
    const ngrokUrl = data.tunnels[0].public_url;

    // Устанавливаем новый webhook
    const webhookUrl = `${ngrokUrl}/api/webhook`;
    await bot.setWebHook(webhookUrl);
    logger.info('Новый webhook установлен с ngrok:', webhookUrl);

    // Получаем информацию о webhook
    const webhookInfo = await bot.getWebHookInfo();
    logger.info('Информация о webhook:', webhookInfo);

    // Сохраняем процесс ngrok для очистки
    process.ngrok = ngrok;
  } catch (error) {
    logger.error('Ошибка настройки webhook:', error);
    throw error;
  }
}

// Очистка при выходе
process.on('SIGINT', () => {
  if (process.ngrok) {
    process.ngrok.kill();
  }
  process.exit();
});

// Endpoint для webhook
app.post('/api/webhook', (req, res) => {
  try {
    bot.handleUpdate(req.body);
    logger.debug('Webhook-обновление обработано');
    res.sendStatus(200);
  } catch (error) {
    logger.error('Ошибка обработки webhook:', error);
    res.sendStatus(500);
  }
});

/**
 * Получение содержимого документа в текстовом формате
 * @returns {Promise<Object>} Объект с текстовым содержимым документа
 */
async function fetchSongbookContent() {
  try {
    // Получаем документ через Google Docs API
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
          // Добавляем символ ♭ перед заголовком для обозначения песни
          // Но только если это не правила орлятского круга
          const title = element.paragraph.elements && 
                       element.paragraph.elements[0] && 
                       element.paragraph.elements[0].textRun ?
                       element.paragraph.elements[0].textRun.content.trim() : '';
          
          // Проверяем, что это не правила
          if (title && 
              !title.includes('Правила') && 
              !title.match(/^\d+\./) && // Не начинаются с номера и точки (правила)
              title !== 'Припев.' && 
              title !== 'Припев:' &&
              !title.match(/^Будь осознанным/) &&
              !title.includes('песенная служба')) {
            // Ищем последний символ новой строки и заменяем его на новую строку + символ ♭
            const lastIndex = text.lastIndexOf('\n');
            if (lastIndex !== -1) {
              text = text.substring(0, lastIndex) + '\n♭' + text.substring(lastIndex + 1);
            }
          }
        }
      } else if (element.table) {
        // Если это таблица, добавляем её содержимое
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
                text += '\t'; // Добавляем табуляцию между ячейками
              }
              text += '\n'; // Добавляем новую строку после каждой строки таблицы
            }
          }
        }
      }
    }
    
    return { text };
  } catch (error) {
    console.error('Error fetching songbook content:', error);
    throw error;
  }
}

/**
 * Обработка команды /list - получение списка всех песен
 * @param {Object} msg - Сообщение от пользователя
 */
async function handleListCommand(msg) {
  const userId = msg.from.id;
  const userName = msg.from.first_name;
  const chatId = msg.chat.id;
  
  logger.info(`User ${userId} (${userName}) requested song list`, {
    command: '/list',
    user: {
      id: userId,
      name: userName
    }
  });
  
  try {
    // Отправка сообщения с анимацией загрузки
    const waitMessage = await bot.sendMessage(chatId, 'Загрузка списка песен...');
    
    // Получаем текст из документа
    const { text } = await fetchSongbookContent();
    
    // Разбиваем текст на строки
    const lines = text.split('\n');
    
    // Ищем песни по символу ♭
    const songTitles = [];
    let songTitle = '';
    let songAuthor = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('♭')) {
        // Нашли название песни (без символа ♭)
        songTitle = line.substring(1).trim();
        
        // Попытка получить автора из следующей строки
        if (i + 1 < lines.length) {
          songAuthor = lines[i + 1].trim();
          
          // Добавляем песню и автора в список
          songTitles.push(`${songTitle} — ${songAuthor}`);
        } else {
          // Если нет строки автора, добавляем только название
          songTitles.push(songTitle);
        }
      }
    }
    
    // Удаляем сообщение с анимацией загрузки
    try {
      await bot.deleteMessage(chatId, waitMessage.message_id);
    } catch (error) {
      logger.error('Ошибка при удалении сообщения загрузки:', error);
    }
    
    // Проверяем, есть ли песни
    if (songTitles.length === 0) {
      await bot.sendMessage(chatId, 'Песни не найдены.');
      return;
    }
    
    // Формируем сообщение со списком песен
    let message = `Список песен в аккорднике (${songTitles.length}):\n\n`;
    
    // Добавляем номера к песням
    for (let i = 0; i < songTitles.length; i++) {
      const songNumber = i + 1;
      message += `${songNumber}. ${songTitles[i]}\n`;
      
      // Если сообщение становится слишком длинным, разбиваем его на части
      if (message.length > MAX_MESSAGE_LENGTH - 200 && i < songTitles.length - 1) {
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        message = `Продолжение списка песен:\n\n`;
      }
    }
    
    // Отправляем финальное сообщение (или единственное, если список был коротким)
    if (message.length > 0) {
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    }
    
    // Регистрируем статистику использования команды
    stats.commandsUsed['/list'] = (stats.commandsUsed['/list'] || 0) + 1;
    stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
  } catch (error) {
    logger.error('Error handling list command:', {
      error: error.message,
      stack: error.stack,
      userId
    });
    
    await bot.sendMessage(chatId, 'Произошла ошибка при получении списка песен. Пожалуйста, попробуйте позже.');
  }
}

/**
 * Обработка команды /random - получение случайной песни
 * @param {Object} msg - Сообщение от пользователя
 */
async function handleRandomCommand(msg) {
  const userId = msg.from.id;
  const userName = msg.from.first_name;
  const chatId = msg.chat.id;
  
  logger.info(`User ${userId} (${userName}) requested a random song`, {
    command: '/random',
    user: {
      id: userId,
      name: userName
    }
  });
  
  try {
    // Отправка сообщения с анимацией загрузки
    const waitMessage = await bot.sendMessage(chatId, 'Выбираю случайную песню...');
    
    // Получаем текст из документа
    const { text } = await fetchSongbookContent();
    
    // Разбиваем текст на строки
    const lines = text.split('\n');
    
    // Ищем песни по символу ♭
    const songs = [];
    let currentSongStartIndex = -1;
    let currentSongTitle = '';
    let currentSongAuthor = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('♭')) {
        // Если нашли предыдущую песню, сохраняем её
        if (currentSongStartIndex !== -1) {
          const songContent = lines.slice(currentSongStartIndex, i).join('\n');
          songs.push({
            title: currentSongTitle,
            author: currentSongAuthor,
            content: songContent
          });
        }
        
        // Запоминаем новую песню
        currentSongTitle = line.substring(1).trim();
        
        // Попытка получить автора из следующей строки
        if (i + 1 < lines.length) {
          currentSongAuthor = lines[i + 1].trim();
          currentSongStartIndex = i;  // Запоминаем индекс начала песни
        }
      }
    }
    
    // Добавляем последнюю песню
    if (currentSongStartIndex !== -1) {
      const songContent = lines.slice(currentSongStartIndex).join('\n');
      songs.push({
        title: currentSongTitle,
        author: currentSongAuthor,
        content: songContent
      });
    }
    
    // Удаляем сообщение с анимацией загрузки
    try {
      await bot.deleteMessage(chatId, waitMessage.message_id);
    } catch (error) {
      logger.error('Ошибка при удалении сообщения загрузки:', error);
    }
    
    // Проверяем, есть ли песни
    if (songs.length === 0) {
      await bot.sendMessage(chatId, 'Песни не найдены.');
      return;
    }
    
    // Выбираем случайную песню
    const randomSong = songs[Math.floor(Math.random() * songs.length)];
    
    // Сохраняем последнюю песню в состоянии пользователя
    userStates.set(userId, userStates.get(userId) || {});
    userStates.get(userId).lastSongPage = -1; // Используем -1 для обозначения песни из текстового поиска
    
    // Отправляем случайную песню в чат
    const formattedContent = `<b>${randomSong.title}</b>\n<i>${randomSong.author}</i>\n\n${randomSong.content}`;
    await bot.sendMessage(chatId, formattedContent, { parse_mode: 'HTML' });
    
    // Регистрируем статистику использования команды
    stats.commandsUsed['/random'] = (stats.commandsUsed['/random'] || 0) + 1;
    stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
  } catch (error) {
    logger.error('Error handling random command:', {
      error: error.message,
      stack: error.stack,
      userId
    });
    
    await bot.sendMessage(chatId, 'Произошла ошибка при получении случайной песни. Пожалуйста, попробуйте позже.');
  }
}