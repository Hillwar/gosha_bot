require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const winston = require('winston');
const { exec } = require('child_process');
const path = require('path');

// Configure logger with more detailed format
const logger = winston.createLogger({
  level: 'debug', // Set to debug for more detailed logs
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

const app = express();
app.use(express.json());

// Log all incoming requests
app.use((req, res, next) => {
  logger.debug('Incoming request:', {
    method: req.method,
    path: req.path,
    body: req.body,
    headers: req.headers
  });
  next();
});

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development';

// Initialize bot either with polling or webhook
let bot;
if (isDev) {
  logger.info('Starting bot in POLLING mode for local development');
  
  // Create bot with polling turned off initially
  bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
  
  // Clear updates before starting polling to avoid conflicts
  (async () => {
    try {
      // Get current offset
      const updates = await bot.getUpdates({});
      logger.info(`Found ${updates.length} pending updates`);
      
      if (updates.length > 0) {
        // Get highest update_id and use it to mark all updates as read
        const lastUpdateId = Math.max(...updates.map(update => update.update_id));
        await bot.getUpdates({ offset: lastUpdateId + 1 });
        logger.info(`Cleared ${updates.length} pending updates`);
      }
      
      // Start polling after clearing updates
      bot.startPolling();
      logger.info('Polling started successfully');
    } catch (error) {
      logger.error('Error preparing polling:', error);
      process.exit(1);
    }
  })();
  
  // Log polling events
  bot.on('polling_error', (error) => {
    logger.error('Polling error:', error);
  });
} else {
  logger.info('Starting bot in WEBHOOK mode');
  bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
  
  // Setup webhook based on environment
  setupWebhook().catch(error => {
    logger.error('Failed to setup webhook:', error);
    process.exit(1);
  });
}

// Log all bot events
bot.on('webhook_error', (error) => {
  logger.error('Webhook error:', error);
});

bot.on('error', (error) => {
  logger.error('Bot error:', error);
});

// Log all updates
bot.on('message', (msg) => {
  logger.debug('Received message:', {
    messageId: msg.message_id,
    from: msg.from,
    chat: msg.chat,
    text: msg.text,
    date: new Date(msg.date * 1000).toISOString()
  });
});

// Function to setup webhook with ngrok
async function setupWebhook() {
  try {
    // First, delete any existing webhook to clear previous sessions
    await bot.deleteWebHook();
    logger.info('Existing webhook deleted');
    
    // Check if webhook URL is provided directly
    if (process.env.WEBHOOK_URL) {
      await bot.setWebHook(process.env.WEBHOOK_URL);
      logger.info('New webhook set from environment:', process.env.WEBHOOK_URL);
      
      const webhookInfo = await bot.getWebHookInfo();
      logger.info('Webhook info:', webhookInfo);
      return;
    }
    
    // Otherwise use ngrok
    // Start ngrok
    const ngrokPath = path.join(__dirname, '..', 'ngrok.exe'); // Adjust path as needed
    const ngrok = exec(`${ngrokPath} http 3333`, (error, stdout, stderr) => {
      if (error) {
        logger.error('Error starting ngrok:', error);
        return;
      }
      logger.info('Ngrok started:', stdout);
    });

    // Wait for ngrok to start and get URL
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get ngrok URL
    const response = await fetch('http://localhost:4040/api/tunnels');
    const data = await response.json();
    const ngrokUrl = data.tunnels[0].public_url;

    // Set new webhook
    const webhookUrl = `${ngrokUrl}/api/webhook`;
    await bot.setWebHook(webhookUrl);
    logger.info('New webhook set with ngrok:', webhookUrl);

    // Get webhook info
    const webhookInfo = await bot.getWebHookInfo();
    logger.info('Webhook info:', webhookInfo);

    // Store ngrok process for cleanup
    process.ngrok = ngrok;
  } catch (error) {
    logger.error('Error setting up webhook:', error);
    throw error;
  }
}

// Cleanup on exit
process.on('SIGINT', () => {
  if (process.ngrok) {
    process.ngrok.kill();
  }
  process.exit();
});

// Webhook endpoint
app.post('/api/webhook', (req, res) => {
  try {
    bot.handleUpdate(req.body);
    logger.debug('Webhook update processed');
    res.sendStatus(200);
  } catch (error) {
    logger.error('Error processing webhook:', error);
    res.sendStatus(500);
  }
});

// Initialize Google Docs API with retry logic
const auth = new google.auth.GoogleAuth({
  credentials: process.env.GOOGLE_SERVICE_ACCOUNT_B64 
    ? JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString('utf-8'))
    : JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/documents.readonly']
});

const docs = google.docs({ version: 'v1', auth });

// Cache for Google Docs content
const docCache = {
  content: null,
  lastUpdate: null,
  updateInterval: 5 * 60 * 1000 // 5 minutes
};

// Store user states for search
const userStates = new Map();

// Объект для хранения статистики использования бота
const stats = {
  searches: 0,
  songViews: {},
  lastReset: Date.now()
};

// Cache to store the last song text for each user for copying
const userSongCache = new Map();
const lastSongPageMap = new Map();

// Helper function to extract document ID from URL
function getDocumentIdFromUrl(url) {
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

// Helper function to get document content with caching
async function getDocumentContent() {
  try {
    const now = Date.now();
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
    
    // Правильно извлекаем ID документа из URL
    const url = process.env.SONGBOOK_URL;
    const documentId = getDocumentIdFromUrl(url);
    
    logger.debug(`Извлечен ID документа: ${documentId} из URL: ${url}`);
    
    // Проверка учетных данных сервисного аккаунта
    if (!process.env.GOOGLE_SERVICE_ACCOUNT && !process.env.GOOGLE_SERVICE_ACCOUNT_B64) {
      logger.error('Google service account credentials not provided');
      throw new Error('Missing Google service account credentials');
    }
    
    // Добавляем подробное логирование API запроса
    logger.debug('Making API request to Google Docs', {
      documentId,
      serviceAccountType: process.env.GOOGLE_SERVICE_ACCOUNT_B64 ? 'Base64 encoded' : 'JSON'
    });
    
    const document = await docs.documents.get({
      documentId: documentId
    });
    
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

// Helper function to get song content with retry logic
async function getSongContent(documentId, pageNumber, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const document = await getDocumentContent();
      
      if (!document || !document.body || !document.body.content) {
        logger.error('Invalid document structure for getSongContent');
        throw new Error('Invalid document structure');
      }
      
      const content = document.body.content;
      let songText = '';
      let songTitle = '';
      let foundTargetSong = false;
      let currentPage = 1;
      let paragraphContent = [];
      
      // Находим песню с указанным номером страницы/индексом
      for (let i = 0; i < content.length; i++) {
        const element = content[i];
        
        // Если это заголовок (новая песня)
        if (element && element.paragraph && 
            element.paragraph.paragraphStyle && 
            element.paragraph.paragraphStyle.namedStyleType === 'TITLE') {
          
          // Если мы уже нашли нужную песню и встретили новый заголовок - значит песня закончилась
          if (foundTargetSong) {
            break;
          }
          
          // Проверяем, это нужная нам песня?
          if (currentPage === pageNumber) {
            foundTargetSong = true;
            
            // Извлекаем название из заголовка
            if (element.paragraph.elements && element.paragraph.elements[0] && 
                element.paragraph.elements[0].textRun) {
              songTitle = element.paragraph.elements[0].textRun.content.trim();
              paragraphContent.push({ type: 'title', text: songTitle });
            }
          }
          
          currentPage++;
        }
        // Если это содержимое текущей песни, добавляем его
        else if (foundTargetSong && element.paragraph) {
          // Проверяем, есть ли текст в этом параграфе
          if (element.paragraph.elements && element.paragraph.elements.length > 0) {
            // Извлекаем текст целиком
            let paraText = '';
            for (const paraElement of element.paragraph.elements) {
              if (paraElement && paraElement.textRun) {
                paraText += paraElement.textRun.content;
              }
            }
            
            paraText = paraText.trim();
            
            // Пропускаем пустые параграфы
            if (!paraText) continue;
            
            // Определяем тип параграфа
            if (/^(\d+\.|\d+:|Припев:|Куплет \d+:|Chorus:|Verse \d+:|Bridge:|Бридж:)/.test(paraText)) {
              paragraphContent.push({ type: 'header', text: paraText });
            } else {
              paragraphContent.push({ type: 'text', text: paraText });
            }
          }
        }
      }
      
      if (!foundTargetSong) {
        logger.error(`Song with page number ${pageNumber} not found`);
        throw new Error(`Song with page number ${pageNumber} not found`);
      }
      
      if (paragraphContent.length === 0) {
        logger.error(`Empty song content for page ${pageNumber}`);
        throw new Error('Empty song content');
      }
      
      // Форматируем текст песни
      songText = formatSongTextStructure(paragraphContent);
      
      logger.debug(`Successfully extracted song content`, {
        pageNumber,
        songTitle,
        contentLength: songText.length
      });
      
      return songText;
    } catch (error) {
      logger.error(`Attempt ${i + 1} failed to fetch song content:`, {
        error: error.message,
        stack: error.stack,
        pageNumber
      });
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
    }
  }
}

// Функция для структурированного форматирования текста песни
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

// Function to format the song text for display
function formatSongForDisplay(text) {
  if (!text) return '';
  
  // Escape HTML characters for HTML display
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Function to extract song information from text
function extractSongInfo(text) {
  const info = {
    author: null,
    rhythm: null,
    notes: null,
    cleanText: ''
  };
  
  const lines = text.split('\n');
  const authorRegex = /^(Автор|Музыка|Слова|Муз\.)[:\s]+(.+)$/i;
  const rhythmRegex = /^(Ритм|Ритмика)[:\s]+(.+)$/i;
  const notesRegex = /^(Примечание|Note)[:\s]+(.+)$/i;
  
  // Сохраняем метаданные и текст песни отдельно
  const metaLines = [];
  const songLines = [];
  let inMetaSection = true;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const authorMatch = line.match(authorRegex);
    const rhythmMatch = line.match(rhythmRegex);
    const notesMatch = line.match(notesRegex);
    
    if (authorMatch && !info.author) {
      info.author = authorMatch[2].trim();
      metaLines.push(i);
    } else if (rhythmMatch && !info.rhythm) {
      info.rhythm = rhythmMatch[2].trim();
      metaLines.push(i);
    } else if (notesMatch && !info.notes) {
      info.notes = notesMatch[2].trim();
      metaLines.push(i);
    } else {
      // Если встретили строку с аккордами или текстом после метаданных, 
      // значит метаданные закончились
      if (inMetaSection && line.trim()) {
        inMetaSection = false;
      }
      
      // Если это не метаданные, добавляем в текст песни
      if (!inMetaSection || !metaLines.includes(i-1)) {
        songLines.push(line);
      }
    }
  }
  
  // Собираем текст песни, сохраняя все переносы строк
  info.cleanText = songLines.join('\n');
  return info;
}

// Функция для форматирования текста песни
function formatSongText(text) {
  if (!text) return '';
  
  // Разбиваем текст на строки
  let lines = text.split('\n');
  
  // Удаляем пустые строки в начале и конце
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  
  // Удаляем лишние пробелы в каждой строке, сохраняя аккорды и структуру
  lines = lines.map(line => {
    const trimmedLine = line.trim();
    
    // Проверка, является ли строка строкой с аккордами
    // Поддержка русских аккордов (Am, C, H7, E, D, G, Dm и т.д.)
    const isChordLine = /^([ABCDEFGH][#b]?[m]?[0-9]*(\/[ABCDEFGH][#b]?)?(\s+|$))+$/.test(trimmedLine);
    
    // Проверка на номер куплета или припев
    const isVerseIndicator = /^(\d+\.|\d+:|Припев:|Куплет \d+:|Chorus:|Verse \d+:|Bridge:|Бридж:)/.test(trimmedLine);
    
    // Если это строка аккордов, сохраняем её полностью (с пробелами)
    if (isChordLine) return line;
    
    // Если это указатель на куплет или часть песни, оставляем как есть
    if (isVerseIndicator) return trimmedLine;
    
    // Для обычного текста убираем лишние пробелы в начале и конце
    return trimmedLine;
  });
  
  // Обрабатываем строки, группируя их по куплетам
  let result = [];
  let lastEmpty = false;
  let inVerse = false;
  let inChordSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isEmpty = !line.trim();
    
    // Пропускаем повторяющиеся пустые строки
    if (isEmpty && lastEmpty) continue;
    
    // Проверяем, начало ли это куплета
    const isVerseStart = /^(\d+\.|\d+:|Припев:|Куплет \d+:|Chorus:|Verse \d+:|Bridge:|Бридж:)/.test(line.trim());
    
    // Если начался новый куплет, добавляем пустую строку перед ним (если это не первый куплет)
    if (isVerseStart && result.length > 0 && result[result.length-1].trim() !== '') {
      result.push('');
      inVerse = true;
    }
    
    // Проверяем, является ли текущая строка строкой с аккордами
    const isChordLine = !isEmpty && /^([ABCDEFGH][#b]?[m]?[0-9]*(\/[ABCDEFGH][#b]?)?(\s+|$))+$/.test(line.trim());
    
    // Если это строка с аккордами, помечаем что мы в секции с аккордами
    if (isChordLine) {
      inChordSection = true;
      result.push(line);
      lastEmpty = false;
      continue;
    }
    
    // Если эта строка идёт сразу после строки с аккордами, она должна быть текстом песни
    if (inChordSection && !isEmpty) {
      inChordSection = false;
      result.push(line);
      lastEmpty = false;
      continue;
    }
    
    // Пустая строка означает конец текущего куплета
    if (isEmpty) {
      inVerse = false;
      inChordSection = false;
    }
    
    result.push(line);
    lastEmpty = isEmpty;
  }
  
  // Объединяем строки и убираем последовательные пустые строки
  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

// Helper function to search songs with improved error handling
async function searchSongs(query, searchByText = false) {
  try {
    const document = await getDocumentContent();
    
    if (!document || !document.body || !document.body.content) {
      logger.error('Document structure is invalid for searchSongs');
      throw new Error('Invalid document structure');
    }
    
    const songs = [];
    let currentPage = 1;
    let foundTitles = [];
    
    // Сначала собираем все заголовки (названия песен) с их страницами
    for (const element of document.body.content) {
      if (element && element.paragraph && 
          element.paragraph.paragraphStyle && 
          element.paragraph.paragraphStyle.namedStyleType === 'TITLE' &&
          element.paragraph.elements && 
          element.paragraph.elements[0] && 
          element.paragraph.elements[0].textRun) {
        const title = element.paragraph.elements[0].textRun.content.trim();
        if (title) {
          foundTitles.push({ title, page: currentPage });
          currentPage++;
        }
      }
    }
    
    // Отфильтруем заголовки по поисковому запросу
    const matchedTitles = searchByText ? foundTitles : foundTitles.filter(item => 
      item.title.toLowerCase().includes(query.toLowerCase())
    );
    
    // Если ищем по тексту, нам нужно получить содержимое каждой песни
    if (searchByText) {
      // Для каждого заголовка получаем содержимое песни
      for (const titleInfo of foundTitles) {
        try {
          const documentId = getDocumentIdFromUrl(process.env.SONGBOOK_URL);
          const songContent = await getSongContent(documentId, titleInfo.page);
          
          if (songContent && songContent.toLowerCase().includes(query.toLowerCase())) {
            songs.push({
              title: titleInfo.title,
              content: songContent,
              page: titleInfo.page
            });
          }
        } catch (error) {
          logger.error(`Error getting song content for page ${titleInfo.page}:`, {
            error: error.message
          });
          // Продолжаем поиск даже при ошибке для одной из песен
        }
      }
    } else {
      // Если ищем по названию, просто получаем содержимое для найденных заголовков
      for (const titleInfo of matchedTitles) {
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
          logger.error(`Error getting song content for page ${titleInfo.page}:`, {
            error: error.message
          });
          // Продолжаем поиск даже при ошибке для одной из песен
        }
      }
    }
    
    logger.info(`Found ${songs.length} songs matching query: ${query}`, {
      query,
      searchByText,
      songs: songs.map(s => ({ title: s.title, page: s.page }))
    });
    return songs;
  } catch (error) {
    logger.error('Error searching songs:', {
      error: error.message,
      stack: error.stack,
      query,
      searchByText
    });
    return [];
  }
}

// Check document access on startup
(async () => {
  try {
    logger.info('Testing access to Google Doc on startup...');
    const document = await getDocumentContent();
    
    if (!document || !document.body || !document.body.content) {
      logger.error('Invalid document structure returned on startup');
      return;
    }
    
    const titleCount = document.body.content.filter(item => 
      item && item.paragraph && 
      item.paragraph.paragraphStyle && 
      item.paragraph.paragraphStyle.namedStyleType === 'TITLE'
    ).length;
    
    logger.info(`Successfully connected to Google Doc. Found ${titleCount} songs.`);
  } catch (error) {
    logger.error('Failed to access Google Doc on startup:', {
      error: error.message,
      url: process.env.SONGBOOK_URL || 'not set'
    });
  }
})();

// Command handlers with detailed logging
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  logger.info(`User ${chatId} started the bot`, {
    user: msg.from,
    chat: msg.chat
  });
  const message = 'Привет! Я бот для поиска аккордов и песен. Используйте /help для просмотра доступных команд.';
  await bot.sendMessage(chatId, message);
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  logger.info(`User ${chatId} requested help`, {
    user: msg.from,
    chat: msg.chat
  });
  const message = `Доступные команды:
/chords - Поиск песни в аккорднике
/list - Список всех песен
/circlerules - Правила орлятского круга
/status - Статистика запросов
/random - Случайная песня`;
  await bot.sendMessage(chatId, message);
});

// Обработчик команды /circlerules
bot.onText(/\/circlerules/, async (msg) => {
  const chatId = msg.chat.id;
  logger.info(`User ${chatId} requested circle rules`, {
    user: msg.from,
    chat: msg.chat
  });
  
  const rules = `🔥 *ПРАВИЛА ОРЛЯТСКОГО КРУГА* 🔥

1. Орлятский круг - важная завершающая часть дня/общей встречи. Не опаздывай на него. Мы тебя ждём.
2. Пускай в круг каждого.
3. Если вы не пустили в круг, вам важно подойти после круга и объяснить товарищу почему.
4. Будь опрятным сам и напомни об опрятности другому.
5. Встаём в круг мальчик-девочка (по возможности).
6. Круг должен быть круглым. Это очень просто сделать! Просто обними товарищей сбоку и отходи максимально назад (без разрывания круга). Посмотри по сторонам. Ты должен видеть лицо каждого.
7. Покачиваемся в противоположную от противоположной стороны сторону. Направление и темп задаёт ДКС/ДКЗ/Командир.
8. Если песню запел и поёт один человек, то не прерываем. Не бойся и поддержи его, если знаешь часть слов!
9. Ориентируемся по пению на человека с гитарой.
10. Если случилось так, что два человека/две части круга запели одновременно, то оба/обе должны замолчать и уступить время третьей песне.
11. Не пересекай круг без острой необходимости. Если круг не сомкнут, то его можно пересечь.
12. Уважительно относись к песне и она даст тебе сил.
13. После орлятского круга не поём орлятские песни и стараемся не шуметь.
14. Нельзя перебивать завершающую песню.
15. Не пропускай орлятские круги.

Будь осознанным и помни о здравом смысле. 
С ❤️ песенная служба.`;

  await bot.sendMessage(chatId, rules, { parse_mode: 'Markdown' });
  logger.info(`Successfully sent circle rules to user ${chatId}`);
});

bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  logger.info(`User ${chatId} requested song list`, {
    user: msg.from,
    chat: msg.chat
  });
  try {
    const document = await getDocumentContent();
    
    if (!document || !document.body || !document.body.content) {
      logger.error('Document structure is invalid:', {
        document: document ? 'exists' : 'null',
        body: document?.body ? 'exists' : 'null',
        content: document?.body?.content ? 'exists' : 'null'
      });
      throw new Error('Invalid document structure');
    }
    
    const songs = document.body.content
      .filter(item => item && item.paragraph && item.paragraph.paragraphStyle && 
                       item.paragraph.paragraphStyle.namedStyleType === 'TITLE' &&
                       item.paragraph.elements && item.paragraph.elements[0] && 
                       item.paragraph.elements[0].textRun && 
                       item.paragraph.elements[0].textRun.content)
      .map(item => item.paragraph.elements[0].textRun.content.trim());
    
    if (songs.length === 0) {
      logger.warn('No songs found in document');
      await bot.sendMessage(chatId, 'Не удалось найти ни одной песни в документе.');
      return;
    }
    
    // Добавляем нумерацию к списку песен
    const numberedSongs = songs.map((song, index) => `${index + 1}. ${song}`);
    
    const message = 'Список всех песен:\n\n' + numberedSongs.join('\n');
    await bot.sendMessage(chatId, message);
    logger.info(`Successfully sent song list to user ${chatId}`, {
      songCount: songs.length
    });
  } catch (error) {
    logger.error(`Error fetching songs for user ${chatId}:`, {
      error: error.message,
      stack: error.stack,
      user: msg.from,
      chat: msg.chat,
      documentId: process.env.SONGBOOK_URL ? getDocumentIdFromUrl(process.env.SONGBOOK_URL) : 'not set'
    });
    await bot.sendMessage(chatId, 'Произошла ошибка при получении списка песен. Пожалуйста, убедитесь, что URL документа указан верно и у бота есть доступ к нему.');
  }
});

bot.onText(/\/chords/, async (msg) => {
  const chatId = msg.chat.id;
  logger.info(`User ${chatId} started song search`, {
    user: msg.from,
    chat: msg.chat
  });
  const message = 'Выберите тип поиска:\n1. По названию\n2. По тексту';
  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'По названию', callback_data: 'search_by_name' },
          { text: 'По тексту', callback_data: 'search_by_text' }
        ]
      ]
    }
  };
  const sentMessage = await bot.sendMessage(chatId, message, opts);
  
  // Сохраняем ID сообщения, чтобы удалить его позже
  if (!userStates.has(chatId)) {
    userStates.set(chatId, {});
  }
  userStates.get(chatId).lastBotMessageId = sentMessage.message_id;
});

// Добавляем функцию для разделения длинных сообщений (после определения bot)
// Максимальная длина сообщения Telegram - 4096 символов
const MAX_MESSAGE_LENGTH = 4000; // Оставляем запас для безопасности

// Функция для разделения сообщения на части и последовательной отправки
async function sendLongMessage(chatId, text, options = {}) {
  if (!text) {
    logger.error('Attempted to send empty message');
    return;
  }
  
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return await bot.sendMessage(chatId, text, options);
  }
  
  logger.info(`Splitting long message (${text.length} chars) into parts`);
  
  // Разбиваем текст на части, стараясь делать это по строкам
  const chunks = [];
  let currentChunk = '';
  
  const lines = text.split('\n');
  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > MAX_MESSAGE_LENGTH) {
      chunks.push(currentChunk);
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  logger.debug(`Message split into ${chunks.length} parts`);
  
  // Отправляем части сообщения последовательно
  let lastMessageSent = null;
  for (let i = 0; i < chunks.length; i++) {
    const chunkOptions = {...options};
    
    // Добавляем номер части, если их несколько
    if (chunks.length > 1) {
      const chunkText = `Часть ${i + 1}/${chunks.length}\n\n${chunks[i]}`;
      lastMessageSent = await bot.sendMessage(chatId, chunkText, chunkOptions);
    } else {
      lastMessageSent = await bot.sendMessage(chatId, chunks[i], chunkOptions);
    }
  }
  
  return lastMessageSent;
}

// Функция для отправки песни с форматированием и кнопками
async function sendFormattedSong(chatId, songTitle, songText, pageNumber, isRandom = false) {
  try {
    // Добавляем дополнительную информацию о песне, если она есть
    const songInfo = extractSongInfo(songText);
    
    // Формируем сообщение с названием песни
    let messageText;
    if (isRandom) {
      const randomEmoji = ['🎸', '🎵', '🎼', '🎶', '🎤', '🎧', '🎹', '🥁'][Math.floor(Math.random() * 8)];
      messageText = `${randomEmoji} Случайная песня:\n\n${songTitle}`;
    } else {
      messageText = `${songTitle}`;
    }
    
    if (songInfo.author) {
      messageText += `\nАвтор: ${songInfo.author}`;
    }
    
    if (songInfo.rhythm) {
      messageText += `\nРитм: ${songInfo.rhythm}`;
    }
    
    if (songInfo.notes) {
      messageText += `\nПримечание: ${songInfo.notes}`;
    }
    
    // Отправляем информацию о песне
    await bot.sendMessage(chatId, messageText);
    
    // Сохраняем содержимое песни для возможности копирования
    const originalText = songInfo.cleanText || songText;
    userSongCache.set(`song_${pageNumber}`, originalText);
    lastSongPageMap.set(chatId, pageNumber);
    
    // Опции для кнопки "копировать" в блоке с песней
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'копировать', callback_data: `copy_${pageNumber}` }]
        ]
      },
      parse_mode: 'HTML'
    };
    
    // Отправляем текст песни в формате моноширинного текста, сохраняя оригинальное форматирование
    const formattedText = formatSongForDisplay(originalText);
    const songMessage = await bot.sendMessage(chatId, `<pre>${formattedText}</pre>`, opts);
    
    // Добавляем кнопку "Открыть полный аккордник"
    await bot.sendMessage(chatId, `<b>Google Docs</b>\nАккордник Версия ${new Date().toLocaleDateString('ru-RU')}.docx`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Открыть полный аккордник', url: process.env.SONGBOOK_URL }]
        ]
      },
      parse_mode: 'HTML'
    });
    
    // Обновляем статистику просмотров песни
    stats.songViews[songTitle] = (stats.songViews[songTitle] || 0) + 1;
    
    logger.info(`Successfully sent song content to user ${chatId}`, {
      pageNumber,
      contentLength: formattedText.length,
      songTitle
    });
    
    return true;
  } catch (error) {
    logger.error(`Error sending formatted song to user ${chatId}:`, {
      error: error.message,
      stack: error.stack,
      songTitle
    });
    return false;
  }
}

// Handle text messages with detailed logging
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  // Skip if no text
  if (!text) return;
  
  // Skip if it's a command
  if (text.startsWith('/')) return;
  
  const userState = userStates.get(chatId);
  if (userState) {
    if (userState.mode === 'search_by_name' || userState.mode === 'search_by_text') {
      logger.info(`User ${chatId} searching for: ${text}`, {
        user: msg.from,
        chat: msg.chat,
        searchMode: userState.mode
      });
      
      // Удаляем предыдущее сообщение бота с запросом ввода
      if (userState.promptMessageId) {
        try {
          await bot.deleteMessage(chatId, userState.promptMessageId);
          logger.debug(`Deleted prompt message for user ${chatId}`);
        } catch (error) {
          logger.warn(`Failed to delete prompt message for user ${chatId}:`, {
            error: error.message
          });
          // Продолжаем работу даже если не удалось удалить сообщение
        }
      }
      
      // Обновляем счетчик поисков
      stats.searches++;
      
      const searchByText = userState.mode === 'search_by_text';
      const songs = await searchSongs(text, searchByText);
      
      if (songs.length === 0) {
        await bot.sendMessage(chatId, 'Песни не найдены. Попробуйте другой поисковый запрос.');
        logger.info(`No songs found for user ${chatId}`, {
          query: text,
          searchMode: userState.mode
        });
        
        // Очищаем состояние пользователя
        userStates.delete(chatId);
        return;
      }
      
      // If only one song found, show it directly
      if (songs.length === 1) {
        const songTitle = songs[0].title;
        const contentLines = songs[0].content.split('\n');
        const songTextOnly = contentLines.slice(1).join('\n').trim();
        
        // Отправляем песню в отформатированном виде
        const success = await sendFormattedSong(chatId, songTitle, songTextOnly, songs[0].page);
        
        if (!success) {
          await bot.sendMessage(chatId, 'Произошла ошибка при отправке песни.');
        }
      } else {
        // Create inline keyboard with numbered song options
        const keyboard = songs.map((song, index) => [{
          text: `${index + 1}. ${song.title}`,
          callback_data: `song_${song.page}`
        }]);
        
        const sentMessage = await bot.sendMessage(chatId, 'Выберите песню:', {
          reply_markup: {
            inline_keyboard: keyboard
          }
        });
        
        // Сохраняем ID сообщения со списком песен для последующего удаления
        userState.songListMessageId = sentMessage.message_id;
        
        logger.info(`Sent ${songs.length} song options to user ${chatId}`, {
          songs: songs.map((s, i) => ({ index: i + 1, title: s.title, page: s.page }))
        });
      }
    }
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Start server with error handling
const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// Обработчик команды /random
bot.onText(/\/random/, async (msg) => {
  const chatId = msg.chat.id;
  logger.info(`User ${chatId} requested random song`, {
    user: msg.from,
    chat: msg.chat
  });
  
  try {
    const document = await getDocumentContent();
    
    if (!document || !document.body || !document.body.content) {
      logger.error('Document structure is invalid for random song');
      throw new Error('Invalid document structure');
    }
    
    // Получаем все названия песен (заголовки)
    const songs = [];
    let currentPage = 1;
    
    for (const element of document.body.content) {
      if (element && element.paragraph && 
          element.paragraph.paragraphStyle && 
          element.paragraph.paragraphStyle.namedStyleType === 'TITLE' &&
          element.paragraph.elements && 
          element.paragraph.elements[0] && 
          element.paragraph.elements[0].textRun) {
        const title = element.paragraph.elements[0].textRun.content.trim() || '';
        if (title) {
          songs.push({ title, page: currentPage });
          currentPage++;
        }
      }
    }
    
    if (songs.length === 0) {
      logger.warn('No songs found for random selection');
      await bot.sendMessage(chatId, 'Не удалось найти ни одной песни в документе.');
      return;
    }
    
    // Выбираем случайную песню
    const randomIndex = Math.floor(Math.random() * songs.length);
    const selectedSong = songs[randomIndex];
    
    logger.debug('Selected random song', { 
      index: randomIndex, 
      title: selectedSong.title, 
      page: selectedSong.page,
      totalSongs: songs.length
    });
    
    // Получаем содержимое песни
    const documentId = getDocumentIdFromUrl(process.env.SONGBOOK_URL);
    const songContent = await getSongContent(documentId, selectedSong.page);
    
    if (!songContent) {
      logger.error('Empty song content returned', { 
        title: selectedSong.title, 
        page: selectedSong.page 
      });
      throw new Error('Song content is empty');
    }
    
    // Разделяем название и текст песни
    const contentLines = songContent.split('\n');
    let songTitle = selectedSong.title;
    let songTextOnly = contentLines.slice(1).join('\n').trim();
    
    // Отправляем песню в отформатированном виде
    const success = await sendFormattedSong(chatId, songTitle, songTextOnly, selectedSong.page, true);
    
    if (!success) {
      throw new Error('Failed to send formatted song');
    }
  } catch (error) {
    logger.error(`Error sending random song to user ${chatId}:`, {
      error: error.message,
      stack: error.stack,
      user: msg.from,
      chat: msg.chat
    });
    await bot.sendMessage(chatId, 'Произошла ошибка при получении случайной песни. Пожалуйста, убедитесь, что URL документа указан верно и у бота есть доступ к нему.');
  }
});

// Обработчик команды /status
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  logger.info(`User ${chatId} requested status`, {
    user: msg.from,
    chat: msg.chat
  });
  
  // Формируем статистику
  const topSongs = Object.entries(stats.songViews)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map((entry, index) => `${index + 1}. ${entry[0]} - ${entry[1]} просмотров`);
  
  const uptime = Math.floor((Date.now() - stats.lastReset) / (1000 * 60 * 60 * 24)); // дни
  
  const statusMessage = `📊 *Статистика бота*\n\n` +
    `🔍 Всего поисков: ${stats.searches}\n` +
    `⏱ Время работы: ${uptime} дней\n\n` +
    `🏆 Топ-5 популярных песен:\n${topSongs.length ? topSongs.join('\n') : 'Пока нет данных'}`;
  
  await bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
  logger.info(`Successfully sent status to user ${chatId}`);
});

// Handle callback queries with detailed logging
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;

  logger.info(`User ${chatId} selected option: ${data}`, {
    user: callbackQuery.from,
    chat: callbackQuery.message.chat,
    message: callbackQuery.message
  });

  if (data === 'search_by_name' || data === 'search_by_text') {
    // Удаляем сообщение с кнопками выбора типа поиска
    try {
      await bot.deleteMessage(chatId, messageId);
      logger.debug(`Deleted search type selection message for user ${chatId}`);
    } catch (error) {
      logger.warn(`Failed to delete search type selection message for user ${chatId}:`, {
        error: error.message
      });
    }
    
    const searchMode = data === 'search_by_name' ? 'search_by_name' : 'search_by_text';
    const promptText = data === 'search_by_name' ? 'Введите название песни:' : 'Введите текст песни:';
    
    // Создаем или обновляем состояние пользователя
    if (!userStates.has(chatId)) {
      userStates.set(chatId, {});
    }
    
    userStates.get(chatId).mode = searchMode;
    
    // Отправляем сообщение с запросом ввода и сохраняем его ID
    const promptMessage = await bot.sendMessage(chatId, promptText);
    userStates.get(chatId).promptMessageId = promptMessage.message_id;
    
  } else if (data.startsWith('song_')) {
    const pageNumber = parseInt(data.split('_')[1]);
    
    // Удаляем сообщение со списком песен
    try {
      await bot.deleteMessage(chatId, messageId);
      logger.debug(`Deleted song selection message for user ${chatId}`);
    } catch (error) {
      logger.warn(`Failed to delete song selection message for user ${chatId}:`, {
        error: error.message
      });
    }
    
    try {
      const documentId = getDocumentIdFromUrl(process.env.SONGBOOK_URL);
      const songContent = await getSongContent(documentId, pageNumber);
      if (songContent) {
        // Разделяем название и содержимое песни
        const contentLines = songContent.split('\n');
        const songTitle = contentLines[0].trim();
        
        // Получаем содержимое песни без названия
        const songTextOnly = contentLines.slice(1).join('\n').trim();
        
        // Отправляем песню в отформатированном виде
        const success = await sendFormattedSong(chatId, songTitle, songTextOnly, pageNumber);
        
        if (!success) {
          throw new Error('Failed to send formatted song');
        }
      } else {
        throw new Error('Song content is null');
      }
    } catch (error) {
      logger.error(`Error sending song content to user ${chatId}:`, {
        error: error.message,
        stack: error.stack,
        pageNumber,
        user: callbackQuery.from,
        chat: callbackQuery.message.chat
      });
      await bot.sendMessage(chatId, 'Произошла ошибка при получении текста песни.');
    }
    
    // Очищаем состояние пользователя после успешной обработки
    userStates.delete(chatId);
    
  } else if (data.startsWith('copy_')) {
    // Отправляем сообщение с полным текстом песни для копирования
    const pageNumber = parseInt(data.split('_')[1]);
    const songText = userSongCache.get(`song_${pageNumber}`);
    
    if (songText) {
      await bot.sendMessage(chatId, songText);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Текст скопирован' });
    } else {
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Ошибка при копировании текста' });
    }
  }
});