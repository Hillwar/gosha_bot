/**
 * Gosha Bot - Telegram бот для песен с аккордами
 */
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');

// Инициализация бота Telegram
const bot = new Telegraf(process.env.BOT_TOKEN);

// Кэш документа и песен для оптимизации
const cache = {
  songs: [],
  lastUpdate: null,
  updateInterval: 30 * 60 * 1000 // 30 минут
};

// Команда /start
bot.command('start', (ctx) => {
  ctx.reply('Привет! Я бот для поиска песен в аккорднике. Используй /help для списка команд.');
});

// Команда /help
bot.command('help', (ctx) => {
  ctx.reply(
    'Доступные команды:\n' +
    '/start - Приветствие и запуск бота\n' +
    '/help - Показать список доступных команд\n' +
    '/search - Поиск песни в аккорднике\n' +
    '/list - Список всех песен\n' +
    '/circlerules - Правила орлятского круга\n' +
    '/random - Случайная песня'
  );
});

// Команда /search
bot.command('search', async (ctx) => {
  const query = ctx.message.text.replace('/search', '').trim();
  if (!query) {
    return ctx.reply('Напиши название песни для поиска. Например: /search Перемен');
  }
  await performSearch(ctx, query);
});

// Команда /list
bot.command('list', async (ctx) => {
  const loadingMsg = await ctx.reply('Загружаю список песен...');
  
  try {
    const songs = await getSongs();
    if (!songs || songs.length === 0) {
      return ctx.reply('Не удалось загрузить песни. Попробуйте позже.');
    }
    
    // Формируем и отправляем список песен
    let message = 'Список песен в аккорднике:\n\n';
    songs.forEach((song, index) => {
      message += `${index + 1}. ${song.title}\n`;
    });
    
    // Разбиваем сообщение, если оно слишком длинное
    if (message.length > 4000) {
      const chunks = message.match(/.{1,4000}/gs);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(message);
    }
    
  } catch (error) {
    console.error('Ошибка при получении списка песен:', error);
    await ctx.reply('Произошла ошибка. Попробуйте позже.');
  } finally {
    // Удаляем сообщение о загрузке, если возможно
    try {
      await ctx.deleteMessage(loadingMsg.message_id);
    } catch (e) {
      // Игнорируем ошибку, если не можем удалить сообщение
    }
  }
});

// Команда /random
bot.command('random', async (ctx) => {
  const loadingMsg = await ctx.reply('Выбираю случайную песню...');
  
  try {
    const songs = await getSongs();
    if (!songs || songs.length === 0) {
      return ctx.reply('Не удалось загрузить песни. Попробуйте позже.');
    }
    
    // Выбираем случайную песню
    const randomIndex = Math.floor(Math.random() * songs.length);
    const song = songs[randomIndex];
    
    // Отправляем песню
    await ctx.reply(formatSongForDisplay(song));
    
    // Отправляем ссылку на аккордник
    await ctx.reply(`<a href="${process.env.SONGBOOK_URL}">Открыть аккордник</a>`, { 
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    
  } catch (error) {
    console.error('Ошибка при получении случайной песни:', error);
    await ctx.reply('Произошла ошибка. Попробуйте позже.');
  } finally {
    try {
      await ctx.deleteMessage(loadingMsg.message_id);
    } catch (e) {}
  }
});

// Команда /circlerules
bot.command('circlerules', async (ctx) => {
  const loadingMsg = await ctx.reply('Загружаю правила орлятского круга...');
  
  try {
    // Получаем документ
    const document = await getDocumentContent();
    let rules = '';
    let foundSongStart = false;
    
    // Ищем текст до первого символа ♭
    for (const element of document.body.content) {
      if (element.paragraph) {
        const text = extractParagraphText(element.paragraph);
        
        if (text.includes('♭')) {
          // Достигли первой песни
          foundSongStart = true;
          break;
        }
        
        // Добавляем текст к правилам
        if (text.trim()) {
          rules += text.trim() + '\n';
        }
      }
    }
    
    if (!foundSongStart || rules.trim().length === 0) {
      return ctx.reply('Не удалось найти правила орлятского круга в документе.');
    }
    
    await ctx.reply('Правила орлятского круга:\n\n' + rules.trim());
    
  } catch (error) {
    console.error('Ошибка при получении правил:', error);
    await ctx.reply('Произошла ошибка. Попробуйте позже.');
  } finally {
    try {
      await ctx.deleteMessage(loadingMsg.message_id);
    } catch (e) {}
  }
});

// Обработка текстовых сообщений (поиск без команды)
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return; // Пропускаем команды
  await performSearch(ctx, ctx.message.text);
});

// Функция поиска песни
async function performSearch(ctx, query) {
  const loadingMsg = await ctx.reply(`Ищу песню "${query}"...`);
  
  try {
    const songs = await getSongs();
    if (!songs || songs.length === 0) {
      return ctx.reply('Не удалось загрузить песни. Попробуйте позже.');
    }
    
    // Поиск по названию и автору
    const matchedSongs = songs.filter(song => 
      song.title.toLowerCase().includes(query.toLowerCase()) ||
      (song.author && song.author.toLowerCase().includes(query.toLowerCase())) ||
      song.fullText.toLowerCase().includes(query.toLowerCase())
    );
    
    if (matchedSongs.length === 0) {
      return ctx.reply(`Песня "${query}" не найдена.`);
    } else if (matchedSongs.length === 1) {
      // Если нашли одну песню, отправляем её
      await ctx.reply(formatSongForDisplay(matchedSongs[0]));
      
      // Отправляем ссылку на аккордник
      await ctx.reply(`<a href="${process.env.SONGBOOK_URL}">Открыть аккордник</a>`, { 
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      
    } else if (matchedSongs.length <= 10) {
      // Если нашли несколько песен, показываем список
      let message = `Найдено ${matchedSongs.length} песен с "${query}":\n\n`;
      matchedSongs.forEach((song, index) => {
        message += `${index + 1}. ${song.title}${song.author ? ' - ' + song.author : ''}\n`;
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
  } finally {
    try {
      await ctx.deleteMessage(loadingMsg.message_id);
    } catch (e) {}
  }
}

// Форматирование песни для отображения
function formatSongForDisplay(song) {
  let formattedText = `${song.title}\n`;
  if (song.author) {
    formattedText += `${song.author}\n\n`;
  } else {
    formattedText += '\n';
  }
  
  // Добавляем текст песни
  const lines = song.fullText.split('\n');
  let skipLines = 2; // Пропускаем заголовок и автора
  
  for (let i = skipLines; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) {
      formattedText += line + '\n';
    }
  }
  
  return formattedText;
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
          currentSong.fullText += '\n' + text;
          nextLineIsAuthor = false;
        }
        else if (currentSong) {
          // Добавляем строку к тексту песни
          currentSong.fullText += '\n' + text;
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
    // Получаем ID документа из URL
    const documentId = process.env.SONGBOOK_URL.includes('/d/') 
      ? process.env.SONGBOOK_URL.split('/d/')[1].split('/')[0]
      : process.env.SONGBOOK_URL;
    
    // Извлекаем данные сервисного аккаунта из переменной окружения
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    
    // Инициализация Google API с использованием сервисного аккаунта
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/documents.readonly']
    });

    const docs = google.docs({ version: 'v1', auth });
    
    // Запрашиваем документ (удаляем параметр timeout, он не поддерживается API)
    const response = await docs.documents.get({ documentId });
    
    return response.data;
  } catch (error) {
    console.error('Ошибка при получении документа:', error);
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

// Запуск бота в режиме polling
console.log('Запуск бота в режиме polling...');
bot.launch()
  .then(() => console.log('Бот успешно запущен!'))
  .catch(err => console.error('Ошибка запуска бота:', err));

// Обработка остановки приложения
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
