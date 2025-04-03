/**
 * Gosha Bot - Telegram бот для песен с аккордами
 */

// Подробное логирование
const fs = require('fs');
const util = require('util');

// Функция для расширенного логирования
function detailedLog(message, data = null) {
  const timestamp = new Date().toISOString();
  let logMessage = `[${timestamp}] ${message}`;
  
  if (data) {
    try {
      if (typeof data === 'object') {
        logMessage += '\n' + util.inspect(data, { depth: 5, colors: false });
      } else {
        logMessage += ' ' + String(data);
      }
    } catch (error) {
      logMessage += ' [Ошибка сериализации данных: ' + error.message + ']';
    }
  }
  
  console.log(logMessage);
  
  // Добавляем лог в файл, если мы не на Vercel
  if (process.env.NODE_ENV !== 'production') {
    try {
      fs.appendFileSync('bot.log', logMessage + '\n');
    } catch (error) {
      console.error('Ошибка записи в лог-файл:', error.message);
    }
  }
}

// Логируем старт приложения
detailedLog('===== ЗАПУСК ПРИЛОЖЕНИЯ =====');
detailedLog('Версия Node.js:', process.version);
detailedLog('Окружение:', process.env.NODE_ENV || 'development');

// Переменные окружения (без секретов)
detailedLog('Переменные окружения:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  SONGBOOK_URL: process.env.SONGBOOK_URL,
  BOT_NAME: process.env.BOT_NAME
});

// Добавляем обработчик необработанных исключений
process.on('uncaughtException', (error) => {
  detailedLog('КРИТИЧЕСКАЯ ОШИБКА:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  detailedLog('НЕОБРАБОТАННОЕ ОТКЛОНЕНИЕ ПРОМИСА:', { reason, promise });
});

// ----------------------- ОСНОВНОЙ КОД -----------------------

// Загрузка модулей
detailedLog('Загрузка модулей...');

try {
  require('dotenv').config();
  const express = require('express');
  const bodyParser = require('body-parser');
  const TelegramBot = require('node-telegram-bot-api');
  const { google } = require('googleapis');
  const path = require('path');

  detailedLog('Модули успешно загружены');

  // Инициализация Express
  const app = express();
  app.use(bodyParser.json());

  detailedLog('Express инициализирован');

  // Константы
  const MAX_MESSAGE_LENGTH = 4000;

  // Кеширование документа
  const docCache = {
    content: null,
    lastUpdate: null,
    updateInterval: 5 * 60 * 1000 // 5 минут
  };

  // Состояния пользователей и кеши
  const userStates = new Map();
  const userSongCache = new Map();

  // Статистика использования
  const stats = {
    songViews: {},
    commandsUsed: {},
    callbacksUsed: {},
    userActivity: {},
    lastReset: Date.now()
  };

  // Инициализация Google API
  detailedLog('Инициализация Google API...');
  
  // Объявляем auth и docs в глобальной области видимости
  let auth;
  let docs;
  
  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT отсутствует в переменных окружения');
    }
    
    const googleCredentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    detailedLog('Учетные данные Google получены:', {
      project_id: googleCredentials.project_id,
      client_email: googleCredentials.client_email
    });
    
    auth = new google.auth.GoogleAuth({
      credentials: googleCredentials,
      scopes: ['https://www.googleapis.com/auth/documents.readonly']
    });

    docs = google.docs({ version: 'v1', auth });
    detailedLog('Google API успешно инициализирован');
  } catch (error) {
    detailedLog('Ошибка инициализации Google API:', error);
    throw error;
  }

  // Инициализация Telegram Bot
  detailedLog('Инициализация Telegram Bot...');
  
  let bot;
  try {
    if (!process.env.BOT_TOKEN) {
      throw new Error('BOT_TOKEN отсутствует в переменных окружения');
    }
    
    if (process.env.NODE_ENV === 'production') {
      // В продакшн используем webhook
      bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
      detailedLog('Бот запущен в режиме webhook');
    } else {
      // В разработке используем polling
      bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
      detailedLog('Бот запущен в режиме polling');
    }
    
    detailedLog('Telegram Bot успешно инициализирован');
  } catch (error) {
    detailedLog('Ошибка инициализации Telegram Bot:', error);
    throw error;
  }

  // Объявление API эндпоинта для вебхука
  app.post('/api/webhook', (req, res) => {
    detailedLog('Получен webhook запрос:', {
      method: req.method,
      path: req.path,
      body: req.body,
      headers: req.headers
    });
    
    try {
      if (req.body && (req.body.message || req.body.callback_query)) {
        detailedLog('Обработка webhook обновления от Telegram');
        bot.processUpdate(req.body);
        detailedLog('Webhook обновление успешно обработано');
        res.sendStatus(200);
      } else {
        detailedLog('Некорректный webhook запрос, отсутствует message или callback_query');
        res.sendStatus(400);
      }
    } catch (error) {
      detailedLog('Ошибка обработки webhook:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  // Обработка GET запросов для проверки статуса
  app.get('/api/webhook', (req, res) => {
    detailedLog('Получен GET запрос к /api/webhook');
    res.status(200).json({
      status: 'OK', 
      mode: process.env.NODE_ENV === 'production' ? 'webhook' : 'polling',
      timestamp: new Date().toISOString()
    });
  });

  // Регистрация обработчиков команд
  detailedLog('Регистрация обработчиков команд бота');
  
  bot.onText(/\/start/, handleStartCommand);
  bot.onText(/\/help/, handleHelpCommand);
  bot.onText(/\/list/, handleListCommand);
  bot.onText(/\/random/, handleRandomCommand);
  bot.onText(/\/search(?:\s+(.+))?/, handleSearchCommand);
  bot.onText(/\/circlerules/, handleCircleRulesCommand);

  // Регистрация обработчика текстовых сообщений
  bot.on('message', msg => { 
    if (msg.text && !msg.text.startsWith('/')) {
      detailedLog('Получено текстовое сообщение:', { 
        chat_id: msg.chat.id, 
        from_id: msg.from.id,
        text: msg.text.substring(0, 100) + (msg.text.length > 100 ? '...' : '')
      });
      handleTextMessage(msg); 
    }
  });

  // Регистрация обработчика callback-запросов
  bot.on('callback_query', callback => {
    detailedLog('Получен callback_query:', { 
      id: callback.id,
      from_id: callback.from.id,
      data: callback.data
    });
    handleCallbackQuery(callback);
  });

  // Запуск сервера
  const PORT = process.env.PORT || 3333;
  app.listen(PORT, () => {
    detailedLog(`Сервер запущен на порту ${PORT}`);
  });

  // Экспорт модуля (для тестирования)
  module.exports = { bot, app };
  
  // Экспорт для Vercel
  module.exports.default = app;
  
  // ===================== ФУНКЦИИ =====================

  /**
   * Получение содержимого документа с кешированием
   */
  async function getDocumentContent() {
    detailedLog('Запрос содержимого документа');
    try {
      const now = Date.now();
      if (docCache.content && docCache.lastUpdate && (now - docCache.lastUpdate < docCache.updateInterval)) {
        detailedLog('Возвращаем кешированный документ');
        return docCache.content;
      }

      const documentId = process.env.SONGBOOK_URL.includes('/d/') 
        ? process.env.SONGBOOK_URL.split('/d/')[1].split('/')[0]
        : process.env.SONGBOOK_URL;
        
      detailedLog('Запрос к Google Docs API, documentId:', documentId);
      const document = await docs.documents.get({ documentId });
      detailedLog('Документ успешно получен, размер:', 
                  document.data.body.content ? document.data.body.content.length : 'unknown');
      
      docCache.content = document.data;
      docCache.lastUpdate = now;
      return document.data;
    } catch (error) {
      detailedLog('Ошибка получения документа:', error);
      throw error;
    }
  }

  /**
   * Получение документа и извлечение песен
   */
  async function getSongs() {
    detailedLog('Извлечение песен из документа');
    try {
      const document = await getDocumentContent();
      const songs = [];
      let currentSong = null;
      let nextLineIsAuthor = false;
      
      detailedLog('Начинаем обработку элементов документа');
      
      for (const element of document.body.content) {
        if (element.paragraph) {
          const text = extractParagraphText(element.paragraph);
          
          if (text.includes('♭')) {
            // Сохраняем предыдущую песню, если была
            if (currentSong) {
              songs.push(currentSong);
              detailedLog('Добавлена песня:', { 
                title: currentSong.title,
                author: currentSong.author,
                contentLength: currentSong.fullText.length
              });
            }
            
            // Начинаем новую песню
            const cleanTitle = text.replace('♭', '').trim();
            currentSong = { title: cleanTitle, author: '', fullText: text };
            nextLineIsAuthor = true; // Следующая строка будет автором
            detailedLog('Найдено название песни:', cleanTitle);
          } 
          else if (currentSong && nextLineIsAuthor) {
            // Эта строка - автор
            currentSong.author = text.trim();
            currentSong.fullText = currentSong.fullText + '\n' + text;
            nextLineIsAuthor = false; // Сбрасываем флаг
            detailedLog('Найден автор песни:', currentSong.author);
          }
          else if (currentSong) {
            // Добавляем строку к тексту песни
            currentSong.fullText = currentSong.fullText + '\n' + text;
          }
        }
      }
      
      // Сохраняем последнюю песню
      if (currentSong) {
        songs.push(currentSong);
        detailedLog('Добавлена последняя песня:', { 
          title: currentSong.title,
          author: currentSong.author,
          contentLength: currentSong.fullText.length
        });
      }
      
      const filteredSongs = songs.filter(song => song.title && song.title.trim().length > 2);
      detailedLog('Извлечение песен завершено, найдено:', filteredSongs.length);
      
      return filteredSongs;
    } catch (error) {
      detailedLog('Ошибка получения песен:', error);
      return [];
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
    
    detailedLog('Получена команда /search', { userId, chatId, query });
    
    if (query) {
      detailedLog('Выполняем поиск по запросу:', query);
      await performSearch(msg, query);
    } else {
      detailedLog('Запрос пустой, запрашиваем текст для поиска');
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
    
    detailedLog('Выполнение поиска', { chatId, userId, query });
    
    try {
      // Показываем анимированное сообщение загрузки
      const loadingAnimation = await showAnimatedLoading(chatId, 'Ищу песню');
      
      detailedLog('Получаем список песен для поиска');
      const songs = await getSongs();
      detailedLog('Фильтруем песни по запросу:', query);
      const results = filterSongs(songs, query);
      detailedLog('Найдено результатов:', results.length);
      
      // Останавливаем анимацию
      loadingAnimation.stop();
      
      if (results.length === 0) {
        detailedLog('Ничего не найдено по запросу');
        await bot.editMessageText('Ничего не найдено. Попробуйте изменить запрос.', {
          chat_id: chatId,
          message_id: loadingAnimation.message.message_id
        });
        return;
      }
      
      if (results.length === 1) {
        detailedLog('Найдена одна песня, отправляем');
        const song = results[0];
        
        await bot.deleteMessage(chatId, loadingAnimation.message.message_id);
        await sendSong(chatId, song.title, song.author, song.fullText);
        
        userStates.set(userId, { lastSongTitle: song.title });
        return;
      }
      
      // Несколько результатов - показываем список
      const maxResults = Math.min(results.length, 15);
      const songsToShow = results.slice(0, maxResults);
      
      detailedLog('Найдено несколько песен, отображаем список', { 
        total: results.length, 
        showing: maxResults 
      });
      
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
      detailedLog('Ошибка поиска:', error);
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
}
catch (error) {
  detailedLog('КРИТИЧЕСКАЯ ОШИБКА ПРИ ЗАПУСКЕ:', error);
}

