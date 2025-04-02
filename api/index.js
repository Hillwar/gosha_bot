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

/**
 * Обработка команды /list - получение списка всех песен
 * @param {Object} msg - Сообщение от пользователя
 */
async function handleListCommand(msg) {
  const userId = msg.from.id;
  const userName = msg.from.first_name;
  
  logger.info(`User ${userId} (${userName}) requested song list`, {
    command: '/list',
    user: {
      id: userId,
      name: userName
    }
  });
  
  try {
    // Получаем документ
    const document = await getDocumentContent();
    
    if (!document || !document.body || !document.body.content) {
      throw new Error('Invalid document structure');
    }
    
    // Находим все заголовки (TITLE элементы) в документе
    const titleElements = document.body.content.filter(item => 
      item && item.paragraph && 
      item.paragraph.paragraphStyle && 
      item.paragraph.paragraphStyle.namedStyleType === 'TITLE' &&
      item.paragraph.elements && 
      item.paragraph.elements[0] && 
      item.paragraph.elements[0].textRun
    );
    
    if (titleElements.length <= 1) {
      await bot.sendMessage(msg.chat.id, 'В документе недостаточно песен.');
      return;
    }
    
    // Всегда пропускаем первый заголовок (правила) и начинаем со второго
    const songTitles = [];
    
    // Начинаем с индекса 1 (второй элемент)
    for (let i = 1; i < titleElements.length; i++) {
      const title = titleElements[i].paragraph.elements[0].textRun.content.trim();
      
      // Дополнительно фильтруем заголовки, которые явно не песни
      if (title && 
          !title.includes('Правила') && 
          !title.match(/^\d+\./) && // Не начинаются с номера и точки (правила)
          title !== 'Припев.' && 
          title !== 'Припев:' &&
          !title.match(/^Будь осознанным/)) {
        songTitles.push({ title, page: i + 1 });  // Страница = индекс + 1
      }
    }
    
    // Если после фильтрации не осталось песен
    if (songTitles.length === 0) {
      await bot.sendMessage(msg.chat.id, 'В документе не найдено песен после фильтрации.');
      return;
    }
    
    logger.info(`Found ${songTitles.length} songs for list command`);
    
    // Формируем сообщение с нумерованным списком песен
    let message = '<b>Список песен:</b>\n\n';
    
    // Добавляем все найденные песни с номерами
    for (let i = 0; i < songTitles.length; i++) {
      const songNumber = i + 1;
      const songTitle = songTitles[i].title.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      
      // Добавляем каждое название отдельной строкой с номером
      message += `${songNumber}. ${songTitle}\n`;
      
      // Если сообщение становится слишком длинным, разбиваем его на части
      if (message.length > MAX_MESSAGE_LENGTH - 200 && i < songTitles.length - 1) {
        await bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
        message = '<b>Продолжение списка песен:</b>\n\n';
      }
    }
    
    // Отправляем финальное сообщение (или единственное, если список был коротким)
    if (message.length > 0) {
      await bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
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
    
    await bot.sendMessage(msg.chat.id, 'Произошла ошибка при получении списка песен. Пожалуйста, попробуйте позже.');
  }
}

/**
 * Обработка команды /random - получение случайной песни
 * @param {Object} msg - Сообщение от пользователя
 */
async function handleRandomCommand(msg) {
  const userId = msg.from.id;
  const userName = msg.from.first_name;
  
  logger.info(`User ${userId} (${userName}) requested a random song`, {
    command: '/random',
    user: {
      id: userId,
      name: userName
    }
  });
  
  try {
    // Получаем документ
    const document = await getDocumentContent();
    
    if (!document || !document.body || !document.body.content) {
      throw new Error('Invalid document structure');
    }
    
    // Находим все заголовки (TITLE элементы) в документе
    const titleElements = document.body.content.filter(item => 
      item && item.paragraph && 
      item.paragraph.paragraphStyle && 
      item.paragraph.paragraphStyle.namedStyleType === 'TITLE' &&
      item.paragraph.elements && 
      item.paragraph.elements[0] && 
      item.paragraph.elements[0].textRun
    );
    
    if (titleElements.length <= 1) {
      await bot.sendMessage(msg.chat.id, 'В документе недостаточно песен.');
      return;
    }
    
    // Всегда пропускаем первый заголовок (правила) и начинаем со второго
    const songs = [];
    
    // Начинаем с индекса 1 (второй элемент)
    for (let i = 1; i < titleElements.length; i++) {
      const title = titleElements[i].paragraph.elements[0].textRun.content.trim();
      
      // Дополнительно фильтруем заголовки, которые явно не песни
      if (title && 
          !title.includes('Правила') && 
          !title.match(/^\d+\./) && // Не начинаются с номера и точки (правила)
          title !== 'Припев.' && 
          title !== 'Припев:' &&
          !title.match(/^Будь осознанным/)) {
        songs.push({ title, page: i + 1 });  // Страница = индекс + 1
      }
    }
    
    // Если после фильтрации не осталось песен
    if (songs.length === 0) {
      await bot.sendMessage(msg.chat.id, 'В документе не найдено песен после фильтрации.');
      return;
    }
    
    // Выбираем случайную песню
    const randomIndex = Math.floor(Math.random() * songs.length);
    const randomSong = songs[randomIndex];
    
    // Получаем содержимое случайной песни
    const documentId = getDocumentIdFromUrl(process.env.SONGBOOK_URL);
    const songContent = await getSongContent(documentId, randomSong.page);
    
    if (!songContent) {
      await bot.sendMessage(
        msg.chat.id, 
        `К сожалению, не удалось загрузить выбранную песню (${randomSong.title}). Пожалуйста, попробуйте еще раз.`
      );
      return;
    }
    
    // Сохраняем последнюю песню в состоянии пользователя
    userStates.set(userId, userStates.get(userId) || {});
    userStates.get(userId).lastSongPage = randomSong.page;
    
    // Отправляем песню пользователю
    await sendFormattedSong(msg.chat.id, randomSong.title, songContent, true);
    
    // Регистрируем статистику использования команды
    stats.commandsUsed['/random'] = (stats.commandsUsed['/random'] || 0) + 1;
    stats.userActivity[userId] = (stats.userActivity[userId] || 0) + 1;
  } catch (error) {
    logger.error('Error handling random command:', {
      error: error.message,
      stack: error.stack,
      userId
    });
    
    await bot.sendMessage(msg.chat.id, 'Произошла ошибка при получении случайной песни. Пожалуйста, попробуйте позже.');
  }
}

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
 * Анализирует текстовый элемент для определения, является ли он аккордом
 * @param {string} text - Текст для проверки
 * @return {boolean} - true, если текст похож на аккорд
 */
function isChord(text) {
  // Паттерны для распознавания аккордов (основные)
  const chordPatterns = [
    /^[ABCDEFGH][m]?$/,  // Базовые аккорды: A, Am, C, Cm, и т.д.
    /^[ABCDEFGH][m]?(7|9|11|13|maj7|min7|sus2|sus4|dim|aug)?$/,  // С добавлением 7, maj7, и т.д.
    /^[ABCDEFGH][m]?[\/#][ABCDEFGH]$/,  // Аккорды с басом: A/G, C/G, и т.д.
    /^[ABCDEFGH][#b]?[m]?$/  // Аккорды с диезами/бемолями: A#, Bb, F#m, и т.д.
  ];

  // Типичные названия аккордов вручную для проверки
  const commonChords = [
    'A', 'Am', 'A7', 'Amaj7', 'Am7', 'Asus', 'Asus4', 'A/E',
    'B', 'Bm', 'B7', 'Bmaj7', 'Bm7', 'Bsus', 'Bsus4', 'B/F#',
    'C', 'Cm', 'C7', 'Cmaj7', 'Cm7', 'Csus', 'Csus4', 'C/G',
    'D', 'Dm', 'D7', 'Dmaj7', 'Dm7', 'Dsus', 'Dsus4', 'D/A',
    'E', 'Em', 'E7', 'Emaj7', 'Em7', 'Esus', 'Esus4', 'E/B',
    'F', 'Fm', 'F7', 'Fmaj7', 'Fm7', 'Fsus', 'Fsus4', 'F/C',
    'G', 'Gm', 'G7', 'Gmaj7', 'Gm7', 'Gsus', 'Gsus4', 'G/D',
    'A#', 'A#m', 'Bb', 'Bbm', 'C#', 'C#m', 'Db', 'Dbm',
    'D#', 'D#m', 'Eb', 'Ebm', 'F#', 'F#m', 'Gb', 'Gbm',
    'G#', 'G#m', 'Ab', 'Abm'
  ];

  // Проверяем, соответствует ли текст одному из паттернов или является известным аккордом
  const trimmedText = text.trim();
  
  // Прямое совпадение со списком
  if (commonChords.includes(trimmedText)) {
    return true;
  }
  
  // Проверка по регулярным выражениям
  for (const pattern of chordPatterns) {
    if (pattern.test(trimmedText)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Определяет, является ли строка заголовком части песни (припев, куплет и т.д.)
 * @param {string} text - Текст для проверки
 * @return {boolean} - true, если текст является заголовком части песни
 */
function isSongSectionHeader(text) {
  const headerPatterns = [
    /^(Припев|Chorus)[\.:]?$/i,
    /^(Куплет|Verse)\s*\d*[\.:]?$/i,
    /^(Бридж|Bridge)[\.:]?$/i,
    /^(Вступление|Intro)[\.:]?$/i,
    /^(Кода|Coda)[\.:]?$/i,
    /^(Проигрыш|Interlude)[\.:]?$/i,
    /^(Финал|Outro)[\.:]?$/i
  ];
  
  const trimmedText = text.trim();
  
  for (const pattern of headerPatterns) {
    if (pattern.test(trimmedText)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Преобразует текст песни в HTML с форматированием аккордов и структуры
 * @param {string} title - Название песни
 * @param {string} content - Содержимое песни
 * @returns {string} - HTML-версия песни
 */
function formatSongToHTML(title, content) {
  if (!content) return '';
  
  // Экранируем специальные HTML-символы
  function escapeHTML(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  
  const escapedTitle = escapeHTML(title);
  const lines = content.split('\n');
  
  // Разбираем текст на информацию об авторе, ритме и основной текст
  let author = '';
  let rhythm = '';
  let notes = '';
  
  // Паттерны для метаданных
  const authorPatterns = [
    /^(Автор|Музыка|Слова|Муз\.|Сл\.|Автор и музыка)[:\s]+(.+)$/i,
    /^(Слова и музыка)[:\s]+(.+)$/i,
    /^.*?(автор|музыка)[:\s]+([^,]+).*/i
  ];
  
  const rhythmPatterns = [
    /^(Ритм|Ритмика|Бой)[:\s]+(.+)$/i,
    /^.*?(ритм|ритмика)[:\s]+([^,]+).*/i,
    /^(Сложный бой|Простой бой|Перебор)$/i
  ];
  
  const notesPatterns = [
    /^(Примечание|Note|Примеч\.)[:\s]+(.+)$/i,
    /^.*?(примечание)[:\s]+([^,]+).*/i
  ];
  
  // Ищем метаданные в первых строках
  const metadataLines = Math.min(10, lines.length);
  for (let i = 0; i < metadataLines; i++) {
    const line = lines[i].trim();
    
    // Ищем автора
    if (!author) {
      for (const pattern of authorPatterns) {
        const match = line.match(pattern);
        if (match && match[2]) {
          author = match[2].trim();
          lines[i] = ''; // Удаляем эту строку из основного текста
          break;
        }
      }
    }
    
    // Ищем информацию о ритме
    if (!rhythm) {
      for (const pattern of rhythmPatterns) {
        const match = line.match(pattern);
        if (match) {
          rhythm = match[2] ? match[2].trim() : match[1].trim();
          lines[i] = ''; // Удаляем эту строку из основного текста
          break;
        }
      }
    }
    
    // Ищем примечания
    if (!notes) {
      for (const pattern of notesPatterns) {
        const match = line.match(pattern);
        if (match && match[2]) {
          notes = match[2].trim();
          lines[i] = ''; // Удаляем эту строку из основного текста
          break;
        }
      }
    }
  }
  
  // Создаем HTML песни
  let html = '<div class="song">\n';
  html += `<h2 class="song-title">${escapedTitle}</h2>\n`;
  
  // Добавляем метаданные, если есть
  let metadataHTML = '';
  if (author) {
    metadataHTML += `<div class="song-author">Автор: ${escapeHTML(author)}</div>\n`;
  }
  if (rhythm) {
    metadataHTML += `<div class="song-rhythm">Ритм: ${escapeHTML(rhythm)}</div>\n`;
  }
  if (notes) {
    metadataHTML += `<div class="song-notes">Примечание: ${escapeHTML(notes)}</div>\n`;
  }
  
  if (metadataHTML) {
    html += `<div class="song-metadata">\n${metadataHTML}</div>\n`;
  }
  
  // Начинаем основной текст песни
  html += '<div class="song-content">\n';
  
  // Обработка строк текста
  let inChordSection = false;
  
  // Функция для распознавания и разметки аккордов в тексте
  function markupChords(line) {
    // Проверяем, содержит ли строка аккорды (обычно краткие группы символов разделенные пробелами)
    const words = line.split(/\s+/);
    let hasChords = false;
    const markedLine = words.map(word => {
      if (isChord(word)) {
        hasChords = true;
        return `<span class="chord">${escapeHTML(word)}</span>`;
      }
      return escapeHTML(word);
    }).join(' ');
    
    return { markedLine, hasChords };
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Пропускаем пустые строки или строки, которые мы уже обработали как метаданные
    if (line === '') {
      html += '<br>\n';
      continue;
    }
    
    // Проверяем, является ли строка заголовком секции (припев, куплет и т.д.)
    if (isSongSectionHeader(line)) {
      html += `<h3 class="section-header">${escapeHTML(line)}</h3>\n`;
      continue;
    }
    
    // Обработка строки с потенциальными аккордами
    const { markedLine, hasChords } = markupChords(line);
    
    if (hasChords) {
      html += `<div class="chord-line">${markedLine}</div>\n`;
    } else {
      html += `<p class="lyrics">${escapeHTML(line)}</p>\n`;
    }
  }
  
  html += '</div>\n'; // Закрываем song-content
  html += '</div>\n'; // Закрываем song
  
  return html;
}

/**
 * Отправляет отформатированную песню пользователю с улучшенным форматированием
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
    
    // Выделяем аккорды в тексте (в квадратных скобках или жирным)
    // Разбиваем на строки
    const lines = messageText.split('\n');
    let enhancedMessage = '';
    
    for (const line of lines) {
      if (line.trim() === '') {
        enhancedMessage += '\n';
        continue;
      }
      
      // Проверяем наличие аккордов
      const words = line.split(/\s+/);
      let hasChords = false;
      const modifiedLine = words.map(word => {
        const cleanWord = word.replace(/<\/?[^>]+(>|$)/g, ''); // Убираем HTML-теги для проверки
        if (isChord(cleanWord)) {
          hasChords = true;
          return word.replace(cleanWord, `<b>${cleanWord}</b>`);
        }
        return word;
      }).join(' ');
      
      enhancedMessage += modifiedLine + '\n';
    }
    
    // Проверяем длину сообщения
    if (enhancedMessage.length > MAX_MESSAGE_LENGTH) {
      // Разбиваем на части и отправляем по частям
      await sendLongMessage(chatId, enhancedMessage);
    } else {
      // Отправляем обычное сообщение
      await bot.sendMessage(chatId, enhancedMessage, {
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
 * Отправляет длинное сообщение, разбивая его на части с сохранением форматирования
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
    let songTitle = '';
    let songMetadata = [];
    let foundEmptyLine = false;
    
    // Ищем заголовок песни и метаданные (до второй пустой строки)
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const line = lines[i].trim();
      
      if (line === '') {
        // Пропускаем первую пустую строку, а на второй прекращаем сбор метаданных
        if (foundEmptyLine) {
          break;
        }
        foundEmptyLine = true;
        songMetadata.push('');
        continue;
      }
      
      // Первая непустая строка - заголовок
      if (songTitle === '' && line !== '') {
        songTitle = line;
        continue;
      }
      
      // Добавляем строку в метаданные (автор, ритм и т.д.)
      if (line.startsWith('<i>') || i < 5) {
        songMetadata.push(line);
      }
    }
    
    // Создаем заголовок для каждой части сообщения
    let messageHeader = songTitle ? songTitle : '';
    if (songMetadata.length > 0) {
      messageHeader += '\n' + songMetadata.join('\n');
    }
    
    // Добавляем заголовок в первую часть
    currentPart = messageHeader + '\n\n';
    
    // Определяем, сколько строк мы уже обработали (заголовок + метаданные)
    const skipLines = messageHeader.split('\n').length + 2; // +2 для пустых строк
    
    // Проходим по оставшимся строкам и собираем части сообщения
    for (let i = skipLines; i < lines.length; i++) {
      const line = lines[i];
      
      // Проверяем, не будет ли превышен лимит при добавлении строки
      if (currentPart.length + line.length + 1 > maxLength) {
        // Если часть не пустая, отправляем её
        if (currentPart.trim()) {
          await bot.sendMessage(chatId, currentPart, { parse_mode: 'HTML' });
        }
        
        // Начинаем новую часть с заголовком [Продолжение]
        currentPart = `<b>[Продолжение] ${songTitle.replace(/<\/?[^>]+(>|$)/g, '')}</b>\n\n${line}\n`;
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