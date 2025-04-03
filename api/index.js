require('dotenv').config();
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');
const fs = require('fs');

// Настройки Google API
const SCOPES = ['https://www.googleapis.com/auth/documents.readonly'];
const CREDENTIALS_PATH = 'credentials.json';

// Настройка бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Кэш для документа и песен
const cache = {
  songs: [],
  lastUpdate: null,
  updateInterval: 60 * 60 * 1000, // 1 час
};

// Основные функции бота
bot.start((ctx) => {
  ctx.reply('Привет! Я бот для поиска песен в аккорднике. Используй /help для списка команд.');
});

bot.help((ctx) => {
  ctx.reply(
    'Доступные команды:\n' +
    '/start - Приветствие и запуск бота\n' +
    '/help - Показать список доступных команд\n' +
    '/search - Поиск песни в аккорднике (просто напиши название)\n' +
    '/list - Список всех песен\n' +
    '/circlerules - Правила орлятского круга\n' +
    '/random - Случайная песня'
  );
});

// Команда поиска песни - работает как с командой, так и с обычным текстом
bot.command('search', async (ctx) => {
  const query = ctx.message.text.replace('/search', '').trim();
  if (!query) {
    return ctx.reply('Напиши название песни для поиска. Например: /search Группа крови');
  }
  await performSearch(ctx, query);
});

// Команда списка песен
bot.command('list', async (ctx) => {
  const loadingMessage = await ctx.reply('Загружаю список песен...');
  
  try {
    const songs = await getSongs();
    if (!songs || songs.length === 0) {
      return ctx.reply('Не удалось загрузить список песен. Попробуйте позже.');
    }
    
    let message = 'Список песен в аккорднике:\n\n';
    songs.forEach((song, index) => {
      message += `${index + 1}. ${song.title}\n`;
    });
    
    // Если сообщение слишком длинное, разделяем на части
    if (message.length > 4000) {
      const chunks = message.match(/.{1,4000}/gs);
      for (let i = 0; i < chunks.length; i++) {
        await ctx.reply(chunks[i]);
      }
    } else {
      await ctx.reply(message);
    }
  } catch (error) {
    console.error('Ошибка при получении списка песен:', error);
    await ctx.reply('Произошла ошибка при загрузке списка песен. Попробуйте позже.');
  }
});

// Команда случайной песни
bot.command('random', async (ctx) => {
  const loadingMessage = await ctx.reply('Выбираю случайную песню...');
  
  try {
    const songs = await getSongs();
    if (!songs || songs.length === 0) {
      return ctx.reply('Не удалось загрузить песни. Попробуйте позже.');
    }
    
    const randomIndex = Math.floor(Math.random() * songs.length);
    const song = songs[randomIndex];
    
    await ctx.reply(formatSongForDisplay(song));
  } catch (error) {
    console.error('Ошибка при получении случайной песни:', error);
    await ctx.reply('Произошла ошибка при загрузке песни. Попробуйте позже.');
  }
});

// Команда правил орлятского круга
bot.command('circlerules', async (ctx) => {
  const loadingMessage = await ctx.reply('Загружаю правила орлятского круга...');
  
  try {
    const rules = [
      "1. В кругу все равны",
      "2. Дослушай человека, не перебивай его",
      "3. Говори от своего имени, не навязывай своего мнения другим",
      "4. Уважай мнение других",
      "5. Будь искренен",
      "6. Обсуждается всё, что происходит в кругу",
      "7. Постарайся понять точку зрения других",
      "8. Не выноси за пределы круга то, что происходит в нём",
      "9. Проси слово, подняв правую руку",
      "10. Говори коротко, понятно, по существу",
      "11. Критикуя, предлагай",
      "12. Не давай оценок людям"
    ];
    
    await ctx.reply('Правила орлятского круга:\n\n' + rules.join('\n'));
  } catch (error) {
    console.error('Ошибка при получении правил орлятского круга:', error);
    await ctx.reply('Произошла ошибка при загрузке правил. Попробуйте позже.');
  }
});

// Обработка текстового сообщения как поиска
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return; // Пропускаем команды
  await performSearch(ctx, ctx.message.text);
});

// Функция поиска песни
async function performSearch(ctx, query) {
  const loadingMessage = await ctx.reply(`Ищу песню "${query}"...`);
  
  try {
    const songs = await getSongs();
    if (!songs || songs.length === 0) {
      return ctx.reply('Не удалось загрузить песни. Попробуйте позже.');
    }
    
    // Поиск по названию
    const matchedSongs = songs.filter(song => 
      song.title.toLowerCase().includes(query.toLowerCase()) ||
      (song.author && song.author.toLowerCase().includes(query.toLowerCase()))
    );
    
    if (matchedSongs.length === 0) {
      return ctx.reply(`Песня "${query}" не найдена.`);
    } else if (matchedSongs.length === 1) {
      await ctx.reply(formatSongForDisplay(matchedSongs[0]));
    } else if (matchedSongs.length <= 10) {
      // Если нашли несколько песен, показываем список с номерами
      let message = `Найдено ${matchedSongs.length} песен с "${query}":\n\n`;
      matchedSongs.forEach((song, index) => {
        message += `${index + 1}. ${song.title}\n`;
      });
      message += '\nУкажите номер песни или уточните поиск.';
      await ctx.reply(message);
    } else {
      // Если нашли слишком много, просим уточнить
      await ctx.reply(`Найдено слишком много песен (${matchedSongs.length}). Пожалуйста, уточните запрос.`);
    }
  } catch (error) {
    console.error('Ошибка при поиске песни:', error);
    await ctx.reply('Произошла ошибка при поиске песни. Попробуйте позже.');
  }
}

// Форматирование песни для отображения
function formatSongForDisplay(song) {
  return song.fullText;
}

// Получение и обработка песен из Google Docs
async function getSongs() {
  try {
    // Проверяем кэш
    const now = Date.now();
    if (cache.songs.length > 0 && cache.lastUpdate && (now - cache.lastUpdate < cache.updateInterval)) {
      return cache.songs;
    }
    
    // Получаем содержимое документа
    const document = await getDocumentContent();
    if (!document || !document.body || !document.body.content) {
      console.error('Документ пустой или имеет неправильный формат');
      return [];
    }
    
    const songs = [];
    let currentSong = null;
    let nextLineIsAuthor = false;
    
    // Обрабатываем содержимое документа
    for (const element of document.body.content) {
      if (element.paragraph) {
        const text = extractParagraphText(element.paragraph);
        
        if (text.includes('♭')) {
          // Сохраняем предыдущую песню, если была
          if (currentSong) {
            songs.push(currentSong);
          }
          
          // Начинаем новую песню
          const cleanTitle = text.replace('♭', '').trim();
          currentSong = { title: cleanTitle, author: '', fullText: text };
          nextLineIsAuthor = true;
        } 
        else if (currentSong && nextLineIsAuthor) {
          // Эта строка - автор
          currentSong.author = text.trim();
          // Добавляем строку автора
          if (text.trim()) {
            currentSong.fullText += '\n' + text;
          }
          nextLineIsAuthor = false;
        }
        else if (currentSong) {
          // Добавляем строку к тексту песни, только если она не пустая
          if (text.trim()) {
            currentSong.fullText += '\n' + text;
          } else {
            // Добавляем пустую строку, если в тексте нет уже подряд идущих пустых строк
            const lastTwoChars = currentSong.fullText.slice(-2);
            if (lastTwoChars !== '\n\n') {
              currentSong.fullText += '\n';
            }
          }
        }
      }
    }
    
    // Сохраняем последнюю песню
    if (currentSong) {
      songs.push(currentSong);
    }
    
    // Фильтруем песни и обновляем кэш
    const filteredSongs = songs.filter(song => song.title && song.title.trim().length > 2);
    
    if (filteredSongs.length > 0) {
      cache.songs = filteredSongs;
      cache.lastUpdate = now;
      return filteredSongs;
    }
    
    return [];
  } catch (error) {
    console.error('Ошибка при получении песен:', error);
    // Если в кэше есть песни, возвращаем их даже если кэш устарел
    if (cache.songs.length > 0) {
      return cache.songs;
    }
    return [];
  }
}

// Получение содержимого документа
async function getDocumentContent() {
  try {
    // Инициализация Google API
    const auth = await authorize();
    const docs = google.docs({ version: 'v1', auth });
    
    // Получаем ID документа из URL
    const documentId = process.env.SONGBOOK_URL.includes('/d/') 
      ? process.env.SONGBOOK_URL.split('/d/')[1].split('/')[0]
      : process.env.SONGBOOK_URL;
    
    // Запрашиваем документ с таймаутом
    const response = await docs.documents.get({ 
      documentId,
      timeout: 30000 // 30 секунд таймаут
    });
    
    return response.data;
  } catch (error) {
    console.error('Ошибка при получении документа:', error);
    throw error;
  }
}

// Авторизация в Google API
async function authorize() {
  try {
    // Проверяем наличие credentials.json
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      console.error('Не найден файл credentials.json с данными для доступа к Google API');
      throw new Error('Missing credentials file');
    }
    
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    
    // Проверяем наличие токена
    const TOKEN_PATH = 'token.json';
    if (!fs.existsSync(TOKEN_PATH)) {
      console.error('Не найден файл token.json с токеном доступа к Google API');
      throw new Error('Missing token file');
    }
    
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);
    
    return oAuth2Client;
  } catch (error) {
    console.error('Ошибка авторизации в Google API:', error);
    throw error;
  }
}

// Извлечение текста из параграфа документа
function extractParagraphText(paragraph) {
  if (!paragraph.elements) return '';
  
  return paragraph.elements
    .map(element => {
      if (element.textRun && element.textRun.content) {
        return element.textRun.content;
      }
      return '';
    })
    .join('');
}

// Обработка вебхуков для Vercel
module.exports = async (req, res) => {
  try {
    // Если это GET запрос, отправляем статус
    if (req.method === 'GET') {
      return res.json({ 
        status: 'OK', 
        mode: 'webhook', 
        timestamp: new Date().toISOString() 
      });
    }
    
    // Если это не POST запрос, отклоняем
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    // Обрабатываем обновление от Telegram
    const update = req.body;
    
    if (!update) {
      return res.status(400).json({ error: 'No update in request body' });
    }
    
    // Обрабатываем обновление через бота
    await bot.handleUpdate(update);
    
    // Отправляем успешный статус
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Ошибка обработки запроса:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Запуск бота в режиме polling для локальной разработки
if (process.env.NODE_ENV !== 'production') {
  bot.launch()
    .then(() => console.log('Бот запущен в режиме polling'))
    .catch(err => console.error('Ошибка запуска бота:', err));
}
