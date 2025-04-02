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
        // Сохраняем текущий режим поиска для повторного поиска
        const currentMode = userState.mode;
        
        // Отправляем сообщение о ненахождении песен с инлайн-кнопкой для нового поиска
        const opts = {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Новый поиск', callback_data: currentMode }]
            ]
          }
        };
        
        await bot.sendMessage(chatId, 'Песни не найдены. Попробуйте другой поисковый запрос.', opts);
        
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
    // Удаляем сообщение с кнопками выбора типа поиска или сообщение о ненахождении песен
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

// Initialize bot variables
const userStates = new Map();
const userSongCache = new Map();
const lastSongPageMap = new Map();

// Initialize statistics
const stats = {
  searches: 0,
  commands: 0,
  songViews: {},
  lastReset: Date.now()
};

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

// Get song content by page number
async function getSongContent(documentId, pageNumber) {
  try {
    const document = await getDocumentContent();
    
    if (!document || !document.body || !document.body.content) {
      logger.error('Document structure is invalid for getSongContent');
      throw new Error('Invalid document structure');
    }
    
    // Начинаем с номера страницы 2, т.к. на первой странице находятся правила отрядного круга
    // а песни начинаются со второй страницы
    let currentPage = 2; // Изменено: начинаем со второй страницы
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
          const paragraph = [];
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
    
    // Находим все TITLE элементы в документе
    const titleElements = document.body.content.filter(item => 
      item && item.paragraph && 
      item.paragraph.paragraphStyle && 
      item.paragraph.paragraphStyle.namedStyleType === 'TITLE' &&
      item.paragraph.elements && 
      item.paragraph.elements[0] && 
      item.paragraph.elements[0].textRun
    );
    
    if (titleElements.length === 0) {
      logger.warn('No song titles found in document');
      return [];
    }
    
    // Ищем индекс начала песен - после правил отрядного круга
    let songStartIndex = -1;
    let currentPage = 1;
    
    for (let i = 0; i < titleElements.length; i++) {
      const title = titleElements[i].paragraph.elements[0].textRun.content.trim();
      
      // Проверяем, является ли заголовок началом секции песен
      if (title === 'С' || title === 'C' || /^Алые паруса/.test(title)) {
        songStartIndex = i;
        break;
      }
      currentPage++;
    }
    
    if (songStartIndex === -1) {
      // Если не нашли чёткую границу, берём все заголовки после первого
      songStartIndex = 1;
      currentPage = 2; // Начинаем со второй страницы
    }
    
    // Собираем информацию о песнях, исключая правила
    const foundTitles = [];
    
    for (let i = songStartIndex; i < titleElements.length; i++) {
      const title = titleElements[i].paragraph.elements[0].textRun.content.trim();
      
      // Пропускаем заголовки, которые явно не песни
      if (title && 
          !title.includes('Правила') &&
          !title.match(/^\d+\./) && // Не начинаются с номера и точки (правила)
          title !== 'Припев.' && 
          title !== 'Припев:' &&
          !title.match(/^Будь осознанным/)) {
        foundTitles.push({ title, page: currentPage });
      }
      currentPage++;
    }
    
    logger.info(`Total songs found in document after filtering: ${foundTitles.length}`);
    
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
      
      logger.info(`Found ${exactMatches.length} matching titles for query: "${query}"`, {
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
          logger.error(`Error getting song content for page ${titleInfo.page}:`, {
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
          logger.error(`Error getting song content for page ${titleInfo.page}:`, {
            error: error.message
          });
          // Продолжаем поиск даже при ошибке для одной из песен
        }
      }
    }
    
    logger.info(`Found ${songs.length} songs matching query: "${query}"`, {
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
    
    // Находим все TITLE элементы в документе
    const titleElements = document.body.content.filter(item => 
      item && item.paragraph && 
      item.paragraph.paragraphStyle && 
      item.paragraph.paragraphStyle.namedStyleType === 'TITLE' &&
      item.paragraph.elements && 
      item.paragraph.elements[0] && 
      item.paragraph.elements[0].textRun
    );
    
    if (titleElements.length === 0) {
      logger.warn('No song titles found in document');
      await bot.sendMessage(chatId, 'Не удалось найти ни одной песни в документе.');
      return;
    }
    
    // Ищем индекс начала песен - после правил отрядного круга
    // Правила обычно заканчиваются фразой "Будь осознанным и помни о здравом смысле"
    // или "С ❤️ песенная служба" или просто "C"
    let songStartIndex = -1;
    
    for (let i = 0; i < titleElements.length; i++) {
      const title = titleElements[i].paragraph.elements[0].textRun.content.trim();
      
      // Проверяем, является ли заголовок началом секции песен
      // После фразы "С" обычно начинаются песни
      if (title === 'С' || title === 'C' || /^Алые паруса/.test(title)) {
        songStartIndex = i;
        break;
      }
    }
    
    if (songStartIndex === -1) {
      // Если не нашли чёткую границу, берём все заголовки после первого
      // (первый заголовок - правила отрядного круга)
      songStartIndex = 1;
    }
    
    // Получаем только названия песен, начиная с найденного индекса
    const songTitles = titleElements.slice(songStartIndex).map(item => 
      item.paragraph.elements[0].textRun.content.trim()
    ).filter(title => 
      // Дополнительно фильтруем пустые строки и строки, которые явно не песни
      title && 
      !title.includes('Правила') &&
      !title.match(/^\d+\./) && // Не начинаются с номера и точки (правила)
      title !== 'Припев.' && 
      title !== 'Припев:' &&
      !title.match(/^Будь осознанным/)
    );
    
    if (songTitles.length === 0) {
      logger.warn('No song titles found after filtering rules');
      await bot.sendMessage(chatId, 'Не удалось найти ни одной песни в документе.');
      return;
    }
    
    // Добавляем нумерацию к списку песен
    const numberedSongs = songTitles.map((song, index) => `${index + 1}. ${song}`);
    
    logger.info(`Found ${songTitles.length} songs after filtering rules`);
    
    const message = 'Список всех песен:\n\n' + numberedSongs.join('\n');
    await bot.sendMessage(chatId, message);
    logger.info(`Successfully sent song list to user ${chatId}`, {
      songCount: songTitles.length
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
    
    // Находим все TITLE элементы в документе
    const titleElements = document.body.content.filter(item => 
      item && item.paragraph && 
      item.paragraph.paragraphStyle && 
      item.paragraph.paragraphStyle.namedStyleType === 'TITLE' &&
      item.paragraph.elements && 
      item.paragraph.elements[0] && 
      item.paragraph.elements[0].textRun
    );
    
    if (titleElements.length === 0) {
      logger.warn('No songs found for random selection');
      await bot.sendMessage(chatId, 'Не удалось найти ни одной песни в документе.');
      return;
    }
    
    // Ищем индекс начала песен - после правил отрядного круга
    // Правила обычно заканчиваются фразой "Будь осознанным и помни о здравом смысле"
    // или "С ❤️ песенная служба" или просто "C"
    let songStartIndex = -1;
    let currentPage = 1;
    const songs = [];
    
    for (let i = 0; i < titleElements.length; i++) {
      const title = titleElements[i].paragraph.elements[0].textRun.content.trim();
      
      // Проверяем, является ли заголовок началом секции песен
      // После фразы "С" обычно начинаются песни
      if (title === 'С' || title === 'C' || /^Алые паруса/.test(title)) {
        songStartIndex = i;
        break;
      }
      currentPage++;
    }
    
    if (songStartIndex === -1) {
      // Если не нашли чёткую границу, берём все заголовки после первого
      // (первый заголовок - правила отрядного круга)
      songStartIndex = 1;
      currentPage = 2; // Начинаем со второй страницы
    }
    
    // Собираем информацию о песнях
    for (let i = songStartIndex; i < titleElements.length; i++) {
      const title = titleElements[i].paragraph.elements[0].textRun.content.trim();
      
      // Пропускаем заголовки, которые явно не песни
      if (title && 
          !title.includes('Правила') &&
          !title.match(/^\d+\./) && // Не начинаются с номера и точки (правила)
          title !== 'Припев.' && 
          title !== 'Припев:' &&
          !title.match(/^Будь осознанным/)) {
        songs.push({ title, page: currentPage });
      }
      currentPage++;
    }
    
    if (songs.length === 0) {
      logger.warn('No valid songs found for random selection after filtering');
      await bot.sendMessage(chatId, 'Не удалось найти ни одной песни для случайного выбора.');
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

// Function to send formatted song content with improved error handling
async function sendFormattedSong(chatId, songTitle, songText, pageNumber, isRandom = false) {
  try {
    logger.debug(`Sending formatted song to user ${chatId}`, {
      songTitle,
      textLength: songText.length
    });
    
    // Извлекаем информацию о песне (аккорды, название, примечания)
    const songInfo = extractSongInfo(songText);
    
    // Готовим текст сообщения
    let messageText = '';
    
    // Если это случайная песня, добавляем эмодзи и другой заголовок
    if (isRandom) {
      // Список эмодзи для случайного выбора
      const emojis = ['🎸', '🎵', '🎼', '🎶', '🎤', '🎧', '🎹', '🥁'];
      const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
      messageText = `${randomEmoji} Случайная песня: ${songTitle}`;
    } else {
      messageText = songTitle;
    }
    
    // Добавляем информацию об авторе, если есть
    if (songInfo.author) {
      messageText += `\nАвтор: ${songInfo.author}`;
    }
    
    // Добавляем информацию о ритме, если есть
    if (songInfo.rhythm) {
      messageText += `\nРитм: ${songInfo.rhythm}`;
    }
    
    // Добавляем примечания, если есть
    if (songInfo.notes) {
      messageText += `\nПримечание: ${songInfo.notes}`;
    }
    
    // Отправляем информацию о песне
    await bot.sendMessage(chatId, messageText);
    
    // Сохраняем содержимое песни для возможности копирования
    const originalText = songInfo.cleanText || songText;
    userSongCache.set(`song_${pageNumber}`, originalText);
    lastSongPageMap.set(chatId, pageNumber);
    
    // Опции для форматированного вывода текста песни с кнопкой копирования
    const opts = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'копировать', callback_data: `copy_${pageNumber}` }]
        ]
      }
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
      songTitle,
      hasAuthor: !!songInfo.author
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