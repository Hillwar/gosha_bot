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
  BOT_NAME: process.env.BOT_NAME,
  DISABLE_ANIMATIONS: process.env.DISABLE_ANIMATIONS
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
  
  // Предзагруженный кэш основных песен в случае, если API недоступно
  const backupSongCache = [
    {
      title: "Бумбокс - Вахтерам",
      author: "Бумбокс",
      fullText: "♭Бумбокс - Вахтерам\nБумбокс\n\nВступление: Am F C G\n\nAm\nТа холодна вода\nF\nВ якій я чую дивний жар\nC\nЦі дні, як пори року\nG\nПочинають свій незвичний танок\nAm\nЇї дивне ім'я\nF\nТака блаженна і п'янка\nC\nМоя перепустка минає\nG\nАле я тую перепустку\n\nAm\nВахтерам не покажу\nF\nТа вони мене так не пускають\nC\nЧуєш музика грай\nG\nГрай і вахтерам не відволікаться\nAm\nЯ хочу до неї\nF\nА вони не пускають\nC\nКоли вони дивляться\nG\nЯ хочу стати невидимкою\n\nAm\nҐрати а не дім\nF\nНевидимки мене не пускаєте\nC\nВахтерам шоколадку\nG\nВона ж нагляд не послабляє\nAm\nСистема охорони\nF\nЧому ж ви на її лиці\nC\nЧому ж ви так пильнуєте\nG\nМоє щастя з нею розділити\n\nAm\nВахтерам не покажу\nF\nТа вони мене так не пускають\nC\nЧуєш музика грай\nG\nҐрай і вахтерам не відволікаться\nAm\nЯ хочу до неї\nF\nА вони не пускають\nC\nКоли вони дивляться\nG\nЯ хочу стати невидимкою\n\nAm\nҐрати а не дім\nF\nНевидимки мене не пускаєте\nC\nВахтерам шоколадку\nG\nВона ж нагляд не послабляє\nAm\nСистема охорони\nF\nЧому ж ви на її лиці\nC\nЧому ж ви так пильнуєте\nG\nМоє щастя з нею розділити\n\nAm\nВахтерам не покажу\nF\nТа вони мене так не пускають\nC\nЧуєш музика грай\nG\nҐрай і вахтерам не відволікаться\nAm\nЯ хочу до неї\nF\nА вони не пускають\nC\nКоли вони дивляться\nG\nЯ хочу стати невидимкою\n\nAm F C G\nAm F C G\nAm"
    },
    {
      title: "Сплин - Выхода нет",
      author: "Сплин",
      fullText: "♭Сплин - Выхода нет\nСплин\n\nАккорды: G Bm F C\n\nG               Bm           F                 C\nСквозь поток машин зажатая, вращается Земля\nG               Bm           F             C\nСтрелки указали все пути до апреля\nG                 Bm          F                  C\nИ глобус вдаль посмотрит, и вновь увидит рельсы\nG                  Bm        F                   C\nКоторые ведут в единственную дверь\n\nG              Bm          F               C\nНе вижу смысла ждать и проклинать дорогу\nG                 Bm        F             C\nВедь, если посмотреть, то все ушли не сразу\nG                  Bm           F               C\nИ только Бог один подскажет из тумана\nG                    Bm\nНо выхода нет, выхода нет."
    },
    {
      title: "Кино - Группа крови",
      author: "Виктор Цой",
      fullText: "♭Кино - Группа крови\nВиктор Цой\n\nВступление: H Em | G F# | H Em | G F#\n\nH                          Em\nТеплое место, но улицы ждут\nG                   F#\nОтпечатков наших ног\nH              Em\nЗвездная пыль на сапогах\nG                      F#\nМягкое кресло, клетчатый плед\nH               Em\nНе нажатый вовремя курок\nG              F#\nТихий выстрел в спину\n\nПрипев:\nH   Em   G      F#\nГруппа крови на рукаве\nH  Em   G       F#\nМой порядковый номер на рукаве\nH  Em G       F#\nПожелай мне удачи в бою\nH  Em G       F#\nПожелай мне...\nH  Em G   F#\nНе остаться в этой траве\nH  Em G            F#\nНе остаться в этой траве\nH  Em G         F#\nПожелай мне удачи\nH  Em G    F#\nПожелай мне удачи!\n\nH Em | G F# | H Em | G F#\n\nИ есть чем платить, но я не хочу\nПобеды любой ценой\nЯ никому не хочу ставить ногу на грудь\nЯ хотел бы остаться с тобой\nПросто остаться с тобой\nНо высокая в небе звезда\nЗовет меня в путь\n\nПрипев:\nГруппа крови на рукаве\nМой порядковый номер на рукаве\nПожелай мне удачи в бою\nПожелай мне...\nНе остаться в этой траве\nНе остаться в этой траве\nПожелай мне удачи\nПожелай мне удачи!"
    },
    {
      title: "ДДТ - Что такое осень",
      author: "ДДТ",
      fullText: "♭ДДТ - Что такое осень\nДДТ\n\nВступление: Am-Am-Dm-E\n\nAm\nЧто такое осень - это небо, \nDm\nПлачущее небо под ногами.\nG                   C\nВ лужах разлетаются птицы с облаками,  \nDm            E               Am    E\nПрячась в каплях дождя, умытых росой.\nAm\nТо, что было, и то, что будет, \nDm\nПеремешалось, и обратно уже не поймать.\nG                   C\nМысли навылет, голова кругом, словно ветер,     \nDm         E         E7\nИскры в глазах все это осень. \n\nПрипев:\nAm      Dm\nВидишь, вон там, за окнами, бродит она\nG           C\nВ прохладном саду ожиданий.\nAm      Dm\nЭта странная осень-любовь\nE\nТак бессильно, нежно кружит.\nAm      Dm\nВидишь, там за окнами, ночь, нет, рассвет.\nG               C\nВспыхнул пожар заката,         \nAm           Dm\nТам все иначе, так просто и быстро,\nE                  E7\nНаше последнее время\n\nЧто такое осень? Это камни.\nБаррикады, осень. Это пламя. \nВ сердце тонкой вязью. Это птицы, \nРазбивающиеся о стекло. \nПодожгите, и ты увидишь,\nВсе это ляжет вам на плечи тяжестью. \nРуки в огне, и гордость, ЭТО Осень,\nТы убьешь, словно врага.\n\nПрипев(2раза)"
    },
    {
      title: "Ляпис Трубецкой - Капитал",
      author: "Ляпис Трубецкой",
      fullText: "♭Ляпис Трубецкой - Капитал\nЛяпис Трубецкой\n\nAm\nДве морских пучины на двух чашах весов.\nF\nДва столетних дуба на двух чашах весов.\nC\nДве снежных лавины на двух чашах весов.\nG\nЛевый берег Сены и правый берег Сены.\n\nAm\nНикто не застрахован из людей от зверей и камней.\nF\nНикто не спасётся от полуночных вестей и смертей.\nC\nНикто не возьмёт на себя смелость спастись и уйти.\nG\nНикто не покажет на себя пальцем - только на тебя.\n\nAm\nКапитал, капитал - тебя ждут тёмные дела.\nF\nКапитал, капитал - всё решает капитал.\nC\nКапитал, капитал, капитал - всё решает капитал.\nG\nКапитал, капитал, капитал, капитал...\n\nДве морских пучины на двух чашах весов.\nДва столетних дуба на двух берегах богов.\nДве снежных лавины на двух башнях часов.\nЛевый берег Сены и правый берег Сены.\n\nНикто не обязан из людей улыбаться другим.\nНикто не покажет из друзей, как найти магазин.\nНикто не сломает наш электрический щит.\nНикто не прочитает нам нотацию - только помолчит.\n\nКапитал, капитал - тебя ждут тёмные дела.\nКапитал, капитал - всё решает капитал.\nКапитал, капитал, капитал - всё решает капитал.\nКапитал, капитал, капитал, капитал...\n\nАм-ам, ам-ам...\nШоколадный батончик \"Марс\" доведет тебя до Марса.\nБаунти, Сникерс, Милки Вэй дарят радость детворе.\n\nКапитал, капитал - тебя ждут тёмные дела.\nКапитал, капитал - всё решает капитал.\nКапитал, капитал - всё решает капитал.\nКапитал, капитал, капитал, капитал..."
    }
  ];
  
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
    
    // Настройка параметров запроса
    const requestOptions = {
      timeout: 60000, // Увеличиваем таймаут до 60 секунд
      retryAfter: 2000,
      testConnection: false, // Отключаем проверку соединения
      baseApiUrl: 'https://api.telegram.org'
    };
    
    if (process.env.NODE_ENV === 'production') {
      // В продакшн используем webhook
      bot = new TelegramBot(process.env.BOT_TOKEN, { 
        polling: false,
        request: requestOptions
      });
      detailedLog('Бот запущен в режиме webhook');
    } else {
      // В разработке используем polling
      bot = new TelegramBot(process.env.BOT_TOKEN, { 
        polling: true,
        request: requestOptions
      });
      detailedLog('Бот запущен в режиме polling');
    }
    
    // Добавляем обработчик ошибок для объекта бота
    bot.on('error', (error) => {
      detailedLog('Ошибка Telegram Bot API:', error);
    });
    
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
        
        // Проверяем наличие обязательных полей
        if (req.body.message && (!req.body.message.chat || !req.body.message.chat.id)) {
          detailedLog('Некорректный формат message в webhook запросе');
          res.status(400).json({ error: 'Invalid message format' });
          return;
        }
        
        if (req.body.callback_query && (!req.body.callback_query.message || 
            !req.body.callback_query.message.chat || !req.body.callback_query.id)) {
          detailedLog('Некорректный формат callback_query в webhook запросе');
          res.status(400).json({ error: 'Invalid callback_query format' });
          return;
        }
        
        try {
          // Безопасно обрабатываем обновление
          bot.processUpdate(req.body);
          detailedLog('Webhook обновление успешно обработано');
          res.sendStatus(200);
        } catch (processError) {
          detailedLog('Ошибка при обработке webhook через processUpdate:', processError);
          res.status(500).json({ error: 'Process update error', details: processError.message });
        }
      } else {
        detailedLog('Некорректный webhook запрос, отсутствует message или callback_query');
        res.status(400).json({ error: 'Invalid request format' });
      }
    } catch (error) {
      detailedLog('Ошибка обработки webhook:', error);
      res.status(500).json({ error: 'Internal Server Error', details: error.message });
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

  // Для поддержки Vercel serverless
  app.get('/', (req, res) => {
    detailedLog('Получен GET запрос к корневому пути');
    res.status(200).json({
      status: 'OK',
      message: 'Gosha Bot API is running',
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
  module.exports.default = async (req, res) => {
    try {
      // Для GET запросов отдаем статус
      if (req.method === 'GET') {
        return res.status(200).json({
          status: 'OK', 
          mode: 'webhook',
          timestamp: new Date().toISOString()
        });
      }
      
      // Сначала отправляем ответ 200 OK для Telegram
      res.status(200).send('OK');
      
      // Для POST запросов от Telegram
      if (req.method === 'POST' && req.body) {
        try {
          // Простой лог запроса
          console.log('Webhook запрос:', {
            method: 'POST',
            path: req.path || req.url,
            has_message: !!req.body.message,
            has_callback: !!req.body.callback_query
          });
          
          // Обработка команд напрямую без использования bot.processUpdate
          if (req.body.message && req.body.message.text && req.body.message.chat && req.body.message.chat.id) {
            const text = req.body.message.text;
            const chatId = req.body.message.chat.id;
            
            console.log('Сообщение:', { text, chatId });
            
            // Простые команды
            if (text === '/start' || text === '/help') {
              bot.sendMessage(chatId, '🎵 Привет! Я бот для поиска песен.');
              return;
            }
            
            if (text === '/random') {
              bot.sendMessage(chatId, '🔍 Выполняю команду /random...');
              // Получаем песни
              getSongs().then(songs => {
                if (songs && songs.length > 0) {
                  const validSongs = songs.filter(song => song.title && song.title.length > 2);
                  if (validSongs.length > 0) {
                    const randomSong = validSongs[Math.floor(Math.random() * validSongs.length)];
                    sendSong(chatId, randomSong.title, randomSong.author, randomSong.fullText);
                  } else {
                    bot.sendMessage(chatId, 'Песни не найдены.');
                  }
                } else {
                  bot.sendMessage(chatId, 'Не удалось получить список песен.');
                }
              }).catch(error => {
                console.error('Ошибка /random:', error);
                bot.sendMessage(chatId, 'Произошла ошибка при выполнении команды.');
              });
              return;
            }
            
            // Простой поиск для всех остальных сообщений
            bot.sendMessage(chatId, `🔍 Ищу песни по запросу: "${text}"`);
            getSongs().then(songs => {
              if (songs && songs.length > 0) {
                const results = songs.filter(song => 
                  song.title.toLowerCase().includes(text.toLowerCase()) || 
                  (song.author && song.author.toLowerCase().includes(text.toLowerCase())) ||
                  song.fullText.toLowerCase().includes(text.toLowerCase())
                );
                
                if (results.length > 0) {
                  if (results.length === 1) {
                    sendSong(chatId, results[0].title, results[0].author, results[0].fullText);
                  } else {
                    let message = `Найдено ${results.length} песен:\n`;
                    for (let i = 0; i < Math.min(5, results.length); i++) {
                      message += `\n${i+1}. ${results[i].title}`;
                    }
                    bot.sendMessage(chatId, message);
                  }
                } else {
                  bot.sendMessage(chatId, `По запросу "${text}" ничего не найдено.`);
                }
              } else {
                bot.sendMessage(chatId, 'Не удалось получить список песен.');
              }
            }).catch(error => {
              console.error('Ошибка поиска:', error);
              bot.sendMessage(chatId, 'Произошла ошибка при поиске.');
            });
          }
        } catch (error) {
          console.error('Ошибка обработки webhook:', error);
        }
      }
      
      return;
    } catch (error) {
      console.error('Критическая ошибка в serverless функции:', error);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Internal server error' });
      }
    }
  };
  
  // ===================== ФУНКЦИИ =====================

  /**
   * Получение содержимого документа с кешированием
   */
  async function getDocumentContent() {
    detailedLog('Запрос содержимого документа');
    try {
      const now = Date.now();
      // Увеличиваем время кеширования для более быстрой работы
      if (docCache.content && docCache.lastUpdate && (now - docCache.lastUpdate < docCache.updateInterval)) {
        detailedLog('Возвращаем кешированный документ');
        return docCache.content;
      }

      const documentId = process.env.SONGBOOK_URL.includes('/d/') 
        ? process.env.SONGBOOK_URL.split('/d/')[1].split('/')[0]
        : process.env.SONGBOOK_URL;
        
      detailedLog('Запрос к Google Docs API, documentId:', documentId);
      
      // Устанавливаем таймаут для запроса
      const timeoutPromise = new Promise((_, reject) => {
        const timeoutId = setTimeout(() => {
          clearTimeout(timeoutId);
          reject(new Error('Timeout при получении документа'));
        }, 20000); // Увеличиваем таймаут до 20 секунд
      });
      
      // Выполняем запрос с таймаутом
      const documentPromise = docs.documents.get({ documentId });
      
      // Используем Promise.race с правильной обработкой ошибок
      const result = await Promise.race([
        documentPromise.then(response => ({ success: true, data: response.data })),
        timeoutPromise.then(() => ({ success: false, error: new Error('Timeout') }))
      ]);
      
      // Обрабатываем результат
      if (!result.success) {
        throw result.error;
      }
      
      const document = result.data;
      detailedLog('Документ успешно получен, размер:', 
                  document.body.content ? document.body.content.length : 'unknown');
      
      docCache.content = document;
      docCache.lastUpdate = now;
      // Увеличиваем время кеширования до 30 минут
      docCache.updateInterval = 30 * 60 * 1000;
      return document;
    } catch (error) {
      detailedLog('Ошибка получения документа:', error);
      
      // Если есть кешированная версия, используем её даже если устарела
      if (docCache.content) {
        detailedLog('Используем устаревший кеш из-за ошибки');
        return docCache.content;
      }
      
      // Если кеша нет и произошла ошибка, возвращаем пустой документ
      return { body: { content: [] } };
    }
  }

  /**
   * Получение документа и извлечение песен
   */
  async function getSongs() {
    detailedLog('Извлечение песен из документа');
    try {
      // Запрашиваем документ независимо от окружения
      try {
        const document = await getDocumentContent();
        
        // Если документ пустой, используем резервный кэш
        if (!document.body || !document.body.content || document.body.content.length === 0) {
          detailedLog('Документ пустой, используем резервный кэш');
          return backupSongCache;
        }
        
        const songs = [];
        let currentSong = null;
        let nextLineIsAuthor = false;
        
        // Добавляем таймаут для обработки документа
        const processStart = Date.now();
        const maxProcessTime = 10000; // Увеличиваем время обработки до 10 секунд
        
        detailedLog('Начинаем обработку элементов документа');
        
        for (const element of document.body.content) {
          // Проверяем, не превысили ли мы время обработки
          if (Date.now() - processStart > maxProcessTime) {
            detailedLog('Превышено максимальное время обработки документа, прерываем');
            break;
          }
          
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
              currentSong.fullText = currentSong.fullText + "\n" + text;
              nextLineIsAuthor = false; // Сбрасываем флаг
              detailedLog('Найден автор песни:', currentSong.author);
            }
            else if (currentSong) {
              // Добавляем строку к тексту песни
              currentSong.fullText = currentSong.fullText + "\n" + text;
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
        
        // Если удалось получить песни, используем их
        if (filteredSongs.length > 0) {
          return filteredSongs;
        }
        
        // Если песен нет, используем резервный кэш
        detailedLog('Нет песен в документе, используем резервный кэш');
        return backupSongCache;
      } catch (error) {
        // При любой ошибке используем резервный кэш
        detailedLog('Ошибка получения документа, используем резервный кэш песен:', error);
        return backupSongCache;
      }
    } catch (error) {
      detailedLog('Критическая ошибка получения песен:', error);
      // Гарантированно возвращаем хотя бы базовый набор
      return backupSongCache;
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
   * @param {number} [duration=3000] - Максимальная длительность анимации в мс
   * @returns {Promise<Object>} - Объект сообщения для последующего редактирования/удаления
   */
  async function showAnimatedLoading(chatId, actionText) {
    try {
      const message = await sendMessageWithRetry(chatId, `🔍 ${actionText}...`);
      return {
        message,
        stop: () => {}
      };
    } catch (error) {
      detailedLog('Ошибка отправки начального сообщения:', error);
      throw error;
    }
  }

  /**
   * Показывает приветственную анимацию
   * @param {number} chatId - ID чата
   * @returns {Promise<void>}
   */
  async function showWelcomeAnimation(chatId) {
    const commandsList = 
      'Доступные команды:\n' +
      '/search - поиск по названию или тексту\n' +
      '/list - список всех песен\n' +
      '/random - случайная песня\n' +
      '/circlerules - правила круга\n' +
      '/help - справка';
    
    try {
      await sendMessageWithRetry(chatId, '🎵 Привет! Я бот для поиска песен.\n\n' + commandsList);
    } catch (error) {
      detailedLog('Ошибка отправки приветствия:', error);
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
      // Отправляем простое сообщение о начале поиска
      const loadingMessage = await sendMessageWithRetry(chatId, '🔍 Ищу песню...');
      
      try {
        detailedLog('Получаем список песен для поиска');
        const songs = await getSongs();
        detailedLog('Фильтруем песни по запросу:', query);
        const results = filterSongs(songs, query);
        detailedLog('Найдено результатов:', results.length);
        
        if (results.length === 0) {
          detailedLog('Ничего не найдено по запросу');
          await bot.editMessageText('Ничего не найдено. Попробуйте изменить запрос.', {
            chat_id: chatId,
            message_id: loadingMessage.message_id
          });
          return;
        }
        
        if (results.length === 1) {
          detailedLog('Найдена одна песня, отправляем');
          const song = results[0];
          
          try {
            await bot.deleteMessage(chatId, loadingMessage.message_id);
          } catch (error) {
            detailedLog('Ошибка удаления сообщения:', error);
            // Продолжаем даже в случае ошибки
          }
          
          await sendSong(chatId, song.title, song.author, song.fullText);
          
          userStates.set(userId, { lastSongTitle: song.title });
          return;
        }
        
        // Несколько результатов - показываем список с ограниченным числом
        const maxResults = Math.min(results.length, 5); // Ограничиваем до 5 для скорости
        const songsToShow = results.slice(0, maxResults);
        
        detailedLog('Найдено несколько песен, отображаем список', { 
          total: results.length, 
          showing: maxResults 
        });
        
        await bot.editMessageText(
          `Найдено ${results.length} песен${maxResults < results.length ? ' (показаны первые ' + maxResults + ')' : ''}. Выберите:`, 
          {
            chat_id: chatId,
            message_id: loadingMessage.message_id,
            reply_markup: {
              inline_keyboard: songsToShow.map((song, index) => [{
                text: `${song.title}${song.author ? ' - ' + song.author.substring(0, 15) : ''}`, // Уменьшаем длину
                callback_data: `song_${index}`
              }])
            }
          }
        );
        
        userSongCache.set(userId, songsToShow);
      } catch (error) {
        detailedLog('Ошибка в процессе поиска:', error);
        // В случае ошибки редактируем сообщение о загрузке
        try {
          await bot.editMessageText('Произошла ошибка при поиске. Попробуйте позже или уточните запрос.', {
            chat_id: chatId,
            message_id: loadingMessage.message_id
          });
        } catch (editError) {
          detailedLog('Не удалось изменить сообщение о загрузке:', editError);
        }
      }
    } catch (error) {
      detailedLog('Критическая ошибка поиска:', error);
      try {
        await sendMessageWithRetry(chatId, 'Произошла ошибка. Попробуйте позже или другой запрос.');
      } catch (sendError) {
        detailedLog('Не удалось отправить сообщение об ошибке:', sendError);
      }
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
      await sendMessageWithRetry(chatId, `<a href="${songbookUrl}">Открыть аккордник</a>`, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (error) {
      console.error('Ошибка отправки песни:', error.message);
      await sendMessageWithRetry(chatId, 'Произошла ошибка при отправке песни.');
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
        await sendMessageWithRetry(chatId, text, { parse_mode: 'HTML' });
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
            await sendMessageWithRetry(chatId, currentPart, { parse_mode: 'HTML' });
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
        await sendMessageWithRetry(chatId, currentPart, { parse_mode: 'HTML' });
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
      // Простое сообщение о загрузке
      const loadingMessage = await sendMessageWithRetry(chatId, '🔍 Загружаю список песен...');
      
      try {
        // Получаем песни с простой обработкой ошибок
        const songs = await getSongs();
        
        // Удаляем сообщение о загрузке
        try {
          await bot.deleteMessage(chatId, loadingMessage.message_id);
        } catch (error) {
          detailedLog('Ошибка удаления сообщения:', error.message);
          // Продолжаем выполнение
        }
        
        // Если песни не получены, отправляем сообщение об ошибке
        if (!songs || songs.length === 0) {
          await sendMessageWithRetry(chatId, 'Не удалось получить список песен. Попробуйте позже.');
          return;
        }
        
        // Фильтруем песни более эффективно
        const filteredSongs = songs
          .filter(song => song.title && song.title.trim().length > 2)
          .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
        
        // Проверка списка после фильтрации
        if (filteredSongs.length === 0) {
          await sendMessageWithRetry(chatId, 'Список песен пуст.');
          return;
        }
        
        // Формируем сообщение
        let message = `Список песен в аккорднике (${filteredSongs.length}):`;
        
        // Максимальное количество песен в одном сообщении
        const maxSongsPerMessage = 100;
        let songCounter = 0;
        
        for (let i = 0; i < filteredSongs.length; i++) {
          const songNumber = i + 1;
          const song = filteredSongs[i];
          
          // Добавляем в сообщение
          message += '\n' + `${songNumber}. ${song.title}`;
          songCounter++;
          
          // Если достигли лимита или это последняя песня, отправляем сообщение
          if (songCounter >= maxSongsPerMessage || i === filteredSongs.length - 1) {
            try {
              await sendMessageWithRetry(chatId, message, { parse_mode: 'HTML' });
              // Сбрасываем для следующей части
              message = 'Продолжение списка песен:';
              songCounter = 0;
            } catch (sendError) {
              detailedLog('Ошибка отправки части списка песен:', sendError);
              // Продолжаем со следующей частью
            }
          }
        }
        
        // Статистика
        updateStats(userId, '/list');
      } catch (processingError) {
        detailedLog('Ошибка обработки списка песен:', processingError);
        
        try {
          await bot.editMessageText('Произошла ошибка при загрузке списка. Попробуйте позже.', {
            chat_id: chatId,
            message_id: loadingMessage.message_id
          });
        } catch (editError) {
          // Если не удалось изменить, пробуем отправить новое сообщение
          await sendMessageWithRetry(chatId, 'Произошла ошибка при загрузке списка. Попробуйте позже.');
        }
      }
    } catch (error) {
      detailedLog('Критическая ошибка получения списка песен:', error);
      try {
        await sendMessageWithRetry(chatId, 'Произошла ошибка. Попробуйте позже.');
      } catch (sendError) {
        detailedLog('Не удалось отправить сообщение об ошибке:', sendError);
      }
    }
  }

  /**
   * Обработка команды /random - получение случайной песни
   */
  async function handleRandomCommand(msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    try {
      // Простое сообщение о загрузке
      const loadingMessage = await sendMessageWithRetry(chatId, '🔍 Выбираю случайную песню...');
      
      try {
        // Получаем песни
        const songs = await getSongs();
        
        // Удаляем сообщение о загрузке
        try {
          await bot.deleteMessage(chatId, loadingMessage.message_id);
        } catch (error) {
          detailedLog('Ошибка удаления сообщения:', error.message);
          // Продолжаем выполнение
        }
        
        // Проверяем, что песни получены
        if (!songs || songs.length === 0) {
          await sendMessageWithRetry(chatId, 'Не удалось получить список песен. Попробуйте позже.');
          return;
        }
        
        // Фильтруем и выбираем случайную
        const validSongs = songs.filter(song => song.title && song.title.trim().length > 2);
        
        if (validSongs.length === 0) {
          await sendMessageWithRetry(chatId, 'Песни не найдены.');
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
      } catch (processingError) {
        detailedLog('Ошибка получения случайной песни:', processingError);
        
        try {
          await bot.editMessageText('Произошла ошибка при выборе песни. Попробуйте позже.', {
            chat_id: chatId,
            message_id: loadingMessage.message_id
          });
        } catch (editError) {
          // Если не удалось изменить, пробуем отправить новое сообщение
          await sendMessageWithRetry(chatId, 'Произошла ошибка при выборе песни. Попробуйте позже.');
        }
      }
    } catch (error) {
      detailedLog('Критическая ошибка получения случайной песни:', error);
      try {
        await sendMessageWithRetry(chatId, 'Произошла ошибка. Попробуйте позже.');
      } catch (sendError) {
        detailedLog('Не удалось отправить сообщение об ошибке:', sendError);
      }
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
      // Сообщение о загрузке
      const loadingMessage = await sendMessageWithRetry(chatId, '🔍 Загружаю правила круга...');
      
      try {
        // Получаем документ напрямую
        const document = await getDocumentContent();
        
        let rules = '';
        let foundRules = false;
        let isFirstLine = true;
        
        // Обрабатываем только первые 20 элементов для скорости
        for (let i = 0; i < Math.min(20, document.body.content.length); i++) {
          const element = document.body.content[i];
          
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
        
        // Удаляем сообщение о загрузке
        try {
          await bot.deleteMessage(chatId, loadingMessage.message_id);
        } catch (error) {
          detailedLog('Ошибка удаления сообщения:', error.message);
          // Продолжаем даже если не удалось удалить
        }
        
        if (!foundRules || rules.trim().length === 0) {
          await sendMessageWithRetry(chatId, 'Правила круга не найдены в документе.');
          return;
        }
        
        // Форматируем и отправляем правила
        const formattedRules = '<b>Правила круга</b>\n\n' + rules;
        await sendMessageWithRetry(chatId, formattedRules, { parse_mode: 'HTML' });
        
        // Статистика
        updateStats(userId, '/circlerules');
      } catch (processingError) {
        detailedLog('Ошибка получения правил круга:', processingError);
        
        try {
          await bot.editMessageText('Произошла ошибка при загрузке правил. Попробуйте позже.', {
            chat_id: chatId,
            message_id: loadingMessage.message_id
          });
        } catch (editError) {
          // Если не удалось изменить, пробуем отправить новое сообщение
          await sendMessageWithRetry(chatId, 'Произошла ошибка при загрузке правил. Попробуйте позже.');
        }
      }
    } catch (error) {
      detailedLog('Критическая ошибка получения правил круга:', error);
      try {
        await sendMessageWithRetry(chatId, 'Произошла ошибка. Попробуйте позже.');
      } catch (sendError) {
        detailedLog('Не удалось отправить сообщение об ошибке:', sendError);
      }
    }
  }

  /**
   * Отправка сообщения с повторными попытками при сетевых ошибках
   */
  async function sendMessageWithRetry(chatId, text, options = {}) {
    const maxRetries = 3;
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await bot.sendMessage(chatId, text, options);
        return result;
      } catch (error) {
        lastError = error;
        detailedLog(`Ошибка отправки сообщения (попытка ${attempt + 1}/${maxRetries}):`, error);
        
        // Если не сетевая ошибка, не пытаемся повторять
        if (!error.code || !['EFATAL', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'].includes(error.code)) {
          break;
        }
        
        // Ждем перед следующей попыткой (увеличиваем время ожидания с каждой попыткой)
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    
    // Все попытки исчерпаны, пробрасываем ошибку
    throw lastError;
  }
}
catch (error) {
  detailedLog('КРИТИЧЕСКАЯ ОШИБКА ПРИ ЗАПУСКЕ:', error);
}

