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
  rules: '',
  lastUpdate: null,
  updateInterval: 30 * 60 * 1000 // 30 минут
};

// Хранение состояний пользователей
const userStates = {};

// Константы для состояний
const STATES = {
  DEFAULT: 'default',        // Обычный режим - не обрабатывать сообщения как поиск
  AWAITING_SELECTION: 'awaiting_selection',  // Ожидание выбора песни
  AWAITING_SEARCH_QUERY: 'awaiting_search_query' // Ожидание поискового запроса
};

// Добавляем набор анимированных сообщений о загрузке
const loadingAnimations = [
  "🔍 Ищу... ⏳",
  "🔍 Ищу... ⌛",
  "🔍 Ищу... ⏳",
  "🔍 Ищу... ⌛"
];

// Вспомогательная функция для анимации загрузки
async function animateLoading(ctx, initialMessage, animationTexts, duration = 5000) {
  let currentIndex = 0;
  let loadingMsg;
  
  try {
    // Отправляем начальное сообщение
    loadingMsg = await ctx.reply(initialMessage || animationTexts[0]);
    
    // Запоминаем ID сообщения и ID чата для безопасного доступа
    const messageId = loadingMsg.message_id;
    const chatId = ctx.chat.id;
    
    const intervalId = setInterval(async () => {
      currentIndex = (currentIndex + 1) % animationTexts.length;
      try {
        // Проверяем, что у нас есть все необходимые данные
        if (chatId && messageId) {
          await ctx.telegram.editMessageText(
            chatId, 
            messageId, 
            null, 
            animationTexts[currentIndex]
          );
        }
      } catch (e) {
        // Игнорируем ошибки при обновлении сообщения
        console.log('Ошибка при обновлении сообщения анимации:', e.message);
        clearInterval(intervalId); // Останавливаем интервал при ошибке
      }
    }, 500);
    
    // Возвращаем функцию для остановки анимации и ID сообщения
    return {
      stop: async () => {
        clearInterval(intervalId);
        return loadingMsg ? loadingMsg.message_id : null;
      },
      messageId: loadingMsg ? loadingMsg.message_id : null,
      chatId: ctx.chat.id
    };
  } catch (error) {
    console.error('Ошибка при создании сообщения загрузки:', error);
    // Возвращаем null значения, чтобы избежать ошибок при дальнейшем использовании
    return {
      stop: async () => null,
      messageId: null,
      chatId: ctx.chat.id
    };
  }
}

// Функция для установки состояния пользователя
function setUserState(userId, state, data = {}) {
  userStates[userId] = {
    state,
    timestamp: Date.now(),
    data
  };
}

// Функция для получения состояния пользователя
function getUserState(userId) {
  // Если состояние не установлено или устарело (более 10 минут), возвращаем DEFAULT
  const userState = userStates[userId];
  if (!userState || Date.now() - userState.timestamp > 10 * 60 * 1000) {
    return { state: STATES.DEFAULT, data: {} };
  }
  return userState;
}

// Команда /start
bot.command('start', (ctx) => {
  // Сбрасываем состояние на DEFAULT
  setUserState(ctx.from.id, STATES.DEFAULT);
  ctx.reply('Привет! Я бот для поиска песен в аккорднике. Используй /help для списка команд.');
});

// Команда /help
bot.command('help', (ctx) => {
  // Сбрасываем состояние на DEFAULT
  setUserState(ctx.from.id, STATES.DEFAULT);
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
  // Устанавливаем состояние ожидания поискового запроса
  setUserState(ctx.from.id, STATES.AWAITING_SEARCH_QUERY);
  
  const query = ctx.message.text.replace('/search', '').trim();
  if (query) {
    // Если запрос уже есть в команде, выполняем поиск сразу
    await performSearch(ctx, query);
  } else {
    // Иначе просим ввести запрос
    await ctx.reply('Введите название песни в ответе на это сообщение');
  }
});

// Команда /list
bot.command('list', async (ctx) => {
  // Сбрасываем состояние на DEFAULT
  setUserState(ctx.from.id, STATES.DEFAULT);
  
  const animation = await animateLoading(
    ctx, 
    "🔍 Загружаю список песен... ⏳", 
    ["🔍 Загружаю список песен... ⏳", "🔍 Загружаю список песен... ⌛", "🔍 Собираю песни... ⏳", "🔍 Собираю песни... ⌛"]
  );
  
  try {
    const songs = await getSongs();
    if (!songs || songs.length === 0) {
      if (animation.messageId) {
        try {
          await ctx.telegram.editMessageText(
            animation.chatId, 
            animation.messageId, 
            null, 
            "❌ Не удалось загрузить песни. Попробуйте позже."
          );
        } catch (e) {
          // Если не удалось отредактировать, отправляем новое сообщение
          await ctx.reply("❌ Не удалось загрузить песни. Попробуйте позже.");
        }
      } else {
        await ctx.reply("❌ Не удалось загрузить песни. Попробуйте позже.");
      }
      return;
    }
    
    // Останавливаем анимацию
    await animation.stop();
    
    // Пытаемся удалить сообщение о загрузке
    try {
      if (animation.messageId) {
        await ctx.telegram.deleteMessage(animation.chatId, animation.messageId);
      }
    } catch (e) {
      console.log('Не удалось удалить сообщение загрузки:', e.message);
    }
    
    // Формируем и отправляем список песен
    let message = 'Список песен в аккорднике 📖:\n\n';
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
    
    try {
      if (animation.messageId) {
        await ctx.telegram.editMessageText(
          animation.chatId, 
          animation.messageId, 
          null, 
          "❌ Произошла ошибка. Попробуйте позже."
        );
      } else {
        await ctx.reply("❌ Произошла ошибка. Попробуйте позже.");
      }
    } catch (e) {
      // Если не удалось отредактировать, отправляем новое сообщение
      await ctx.reply("❌ Произошла ошибка. Попробуйте позже.");
    }
  }
});

// Команда /random
bot.command('random', async (ctx) => {
  // Сбрасываем состояние на DEFAULT
  setUserState(ctx.from.id, STATES.DEFAULT);
  
  const animation = await animateLoading(
    ctx, 
    "🎲 Выбираю случайную песню... ⏳", 
    ["🎲 Выбираю случайную песню... ⏳", "🎲 Выбираю случайную песню... ⌛", "🎲 Подбираю что-нибудь интересное... ⏳", "🎲 Подбираю что-нибудь интересное... ⌛"]
  );
  
  try {
    const songs = await getSongs();
    if (!songs || songs.length === 0) {
      if (animation.messageId) {
        try {
          await ctx.telegram.editMessageText(
            animation.chatId, 
            animation.messageId, 
            null, 
            "❌ Не удалось загрузить песни. Попробуйте позже."
          );
        } catch (e) {
          await ctx.reply("❌ Не удалось загрузить песни. Попробуйте позже.");
        }
      } else {
        await ctx.reply("❌ Не удалось загрузить песни. Попробуйте позже.");
      }
      return;
    }
    
    // Останавливаем анимацию
    await animation.stop();
    
    // Пытаемся удалить сообщение о загрузке
    try {
      if (animation.messageId) {
        await ctx.telegram.deleteMessage(animation.chatId, animation.messageId);
      }
    } catch (e) {
      console.log('Не удалось удалить сообщение загрузки:', e.message);
    }
    
    // Выбираем случайную песню
    const randomIndex = Math.floor(Math.random() * songs.length);
    const song = songs[randomIndex];
    
    // Отправляем песню с HTML-форматированием
    await ctx.reply(`🎵 Случайная песня:\n\n${formatSongForDisplay(song)}`, { 
      parse_mode: 'HTML'
    });
    
    // Отправляем ссылку на аккордник
    await ctx.reply(`<a href="${process.env.SONGBOOK_URL}">Открыть аккордник</a>`, { 
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    
  } catch (error) {
    console.error('Ошибка при получении случайной песни:', error);
    try {
      if (animation.messageId) {
        await ctx.telegram.editMessageText(
          animation.chatId, 
          animation.messageId, 
          null, 
          "❌ Произошла ошибка. Попробуйте позже."
        );
      } else {
        await ctx.reply("❌ Произошла ошибка. Попробуйте позже.");
      }
    } catch (e) {
      await ctx.reply("❌ Произошла ошибка. Попробуйте позже.");
    }
  }
});

// Команда /circlerules
bot.command('circlerules', async (ctx) => {
  // Сбрасываем состояние на DEFAULT
  setUserState(ctx.from.id, STATES.DEFAULT);
  
  const animation = await animateLoading(
    ctx, 
    "📜 Загружаю правила орлятского круга... ⏳", 
    ["📜 Загружаю правила орлятского круга... ⏳", "📜 Загружаю правила орлятского круга... ⌛", "📜 Ищу правила... ⏳", "📜 Ищу правила... ⌛"]
  );
  
  try {
    // Получаем правила орлятского круга
    const rules = await getRules();
    
    // Останавливаем анимацию
    await animation.stop();
    
    // Пытаемся удалить сообщение о загрузке
    try {
      if (animation.messageId) {
        await ctx.telegram.deleteMessage(animation.chatId, animation.messageId);
      }
    } catch (e) {
      console.log('Не удалось удалить сообщение загрузки:', e.message);
    }
    
    if (!rules) {
      await ctx.reply('❌ Не удалось найти правила орлятского круга в документе.');
      return;
    }
    
    await ctx.reply('📜 Правила орлятского круга:\n\n' + rules);
    
  } catch (error) {
    console.error('Ошибка при получении правил:', error);
    try {
      if (animation.messageId) {
        await ctx.telegram.editMessageText(
          animation.chatId, 
          animation.messageId, 
          null, 
          "❌ Произошла ошибка. Попробуйте позже."
        );
      } else {
        await ctx.reply("❌ Произошла ошибка. Попробуйте позже.");
      }
    } catch (e) {
      await ctx.reply("❌ Произошла ошибка. Попробуйте позже.");
    }
  }
});

// Обработка callback_query для выбора песни
bot.on('callback_query', async (ctx) => {
  try {
    const callbackData = ctx.callbackQuery.data;
    
    // Проверяем, что callbackData соответствует формату выбора песни
    if (callbackData.startsWith('song_')) {
      // Формат: song_INDEX_QUERY
      const parts = callbackData.split('_');
      const index = parseInt(parts[1]);
      const query = parts.slice(2).join('_');
      
      // Уведомляем Telegram о том, что мы обработали callback_query
      await ctx.answerCbQuery();
      
      // Сбрасываем состояние пользователя (больше не ждем выбора)
      setUserState(ctx.from.id, STATES.DEFAULT);
      
      // Получаем песни из кеша или загружаем заново
      const songs = await getSongs();
      
      // Ищем песни по запросу
      const matchedSongs = songs.filter(song => 
        song.title.toLowerCase().includes(query.toLowerCase()) ||
        (song.author && song.author.toLowerCase().includes(query.toLowerCase())) ||
        song.fullText.toLowerCase().includes(query.toLowerCase())
      );
      
      // Проверяем, что индекс валидный
      if (index >= 0 && index < matchedSongs.length) {
        // Отправляем выбранную песню
        await ctx.reply(`🎵 Выбрана песня:\n\n${formatSongForDisplay(matchedSongs[index])}`, {
          parse_mode: 'HTML'
        });
        
        // Отправляем ссылку на аккордник
        await ctx.reply(`<a href="${process.env.SONGBOOK_URL}">Открыть аккордник</a>`, { 
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });
      } else {
        await ctx.reply('❌ Не удалось найти выбранную песню. Попробуйте выполнить поиск заново.');
      }
    }
  } catch (error) {
    console.error('Ошибка при обработке выбора песни:', error);
    await ctx.reply('❌ Произошла ошибка при выборе песни. Попробуйте снова.');
  }
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return; // Пропускаем команды
  
  const userId = ctx.from.id;
  const userState = getUserState(userId);
  
  // Если пользователь в режиме ожидания выбора, пробуем обработать сообщение как номер песни
  if (userState.state === STATES.AWAITING_SELECTION) {
    const songIndex = parseInt(ctx.message.text) - 1; // Пользователь вводит номер с 1, а не с 0
    
    if (!isNaN(songIndex) && songIndex >= 0 && songIndex < userState.data.matchedSongs.length) {
      // Сбрасываем состояние пользователя
      setUserState(userId, STATES.DEFAULT);
      
      // Отправляем выбранную песню
      await ctx.reply(`🎵 Выбрана песня:\n\n${formatSongForDisplay(userState.data.matchedSongs[songIndex])}`, {
        parse_mode: 'HTML'
      });
      
      // Отправляем ссылку на аккордник
      await ctx.reply(`<a href="${process.env.SONGBOOK_URL}">Открыть аккордник</a>`, { 
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      
      return;
    }
    // Если это не номер песни, не выполняем новый поиск
    // Просто сбрасываем состояние
    setUserState(userId, STATES.DEFAULT);
    await ctx.reply('❌ Неверный номер песни. Поиск отменен. Используйте /search для нового поиска.');
    return;
  }
  
  // Если пользователь в режиме ожидания поискового запроса, выполняем поиск
  if (userState.state === STATES.AWAITING_SEARCH_QUERY) {
    // Выполняем поиск по запросу
    await performSearch(ctx, ctx.message.text);
    return;
  }
  
  // В обычном режиме игнорируем все сообщения, не предлагаем поиск
  // Можно добавить подсказку о команде /search
  await ctx.reply('Используйте /search для поиска песен.');
});

// Функция поиска песни
async function performSearch(ctx, query) {
  const animation = await animateLoading(
    ctx, 
    `🔍 Ищу песню "${query}"... ⏳`, 
    [`🔍 Ищу песню "${query}"... ⏳`, `🔍 Ищу песню "${query}"... ⌛`, `🔍 Ищу совпадения... ⏳`, `🔍 Ищу совпадения... ⌛`]
  );
  
  try {
    const songs = await getSongs();
    if (!songs || songs.length === 0) {
      if (animation.messageId) {
        try {
          await ctx.telegram.editMessageText(
            animation.chatId, 
            animation.messageId, 
            null, 
            "❌ Не удалось загрузить песни. Попробуйте позже."
          );
        } catch (e) {
          await ctx.reply("❌ Не удалось загрузить песни. Попробуйте позже.");
        }
      } else {
        await ctx.reply("❌ Не удалось загрузить песни. Попробуйте позже.");
      }
      return;
    }
    
    // Поиск по названию и автору
    const matchedSongs = songs.filter(song => 
      song.title.toLowerCase().includes(query.toLowerCase()) ||
      (song.author && song.author.toLowerCase().includes(query.toLowerCase())) ||
      song.fullText.toLowerCase().includes(query.toLowerCase())
    );
    
    // Останавливаем анимацию
    await animation.stop();
    
    // Пытаемся удалить сообщение о загрузке
    try {
      if (animation.messageId) {
        await ctx.telegram.deleteMessage(animation.chatId, animation.messageId);
      }
    } catch (e) {
      console.log('Не удалось удалить сообщение загрузки:', e.message);
    }
    
    if (matchedSongs.length === 0) {
      await ctx.reply(`❌ Песня "${query}" не найдена.`);
    } else if (matchedSongs.length === 1) {
      // Если нашли одну песню, отправляем её с HTML-форматированием
      await ctx.reply(`🎵 Найдена песня:\n\n${formatSongForDisplay(matchedSongs[0])}`, {
        parse_mode: 'HTML'
      });
      
      // Отправляем ссылку на аккордник
      await ctx.reply(`<a href="${process.env.SONGBOOK_URL}">Открыть аккордник</a>`, { 
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      
    } else if (matchedSongs.length <= 10) {
      // Если нашли несколько песен, показываем список с кнопками
      let message = `🎵 Найдено ${matchedSongs.length} песен с "${query}":\n\n`;
      
      matchedSongs.forEach((song, index) => {
        message += `${index + 1}. ${song.title}${song.author ? ' - ' + song.author : ''}\n`;
      });
      
      // Создаем инлайн клавиатуру для выбора песни
      const inlineKeyboard = [];
      
      // Группируем кнопки по 5 в ряд
      const buttonsPerRow = 5;
      for (let i = 0; i < matchedSongs.length; i += buttonsPerRow) {
        const row = [];
        for (let j = i; j < Math.min(i + buttonsPerRow, matchedSongs.length); j++) {
          row.push({
            text: (j + 1).toString(),
            callback_data: `song_${j}_${query}`
          });
        }
        inlineKeyboard.push(row);
      }
      
      await ctx.reply(message, {
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      });
      
      // Устанавливаем состояние пользователя - ожидание выбора песни
      setUserState(ctx.from.id, STATES.AWAITING_SELECTION, { matchedSongs, query });
      
    } else {
      // Если нашли слишком много, просим уточнить
      await ctx.reply(`⚠️ Найдено слишком много песен (${matchedSongs.length}). Пожалуйста, уточните запрос.`);
    }
  } catch (error) {
    console.error('Ошибка при поиске песни:', error);
    try {
      if (animation.messageId) {
        await ctx.telegram.editMessageText(
          animation.chatId, 
          animation.messageId, 
          null, 
          "❌ Произошла ошибка при поиске песни. Попробуйте позже."
        );
      } else {
        await ctx.reply("❌ Произошла ошибка при поиске песни. Попробуйте позже.");
      }
    } catch (e) {
      await ctx.reply("❌ Произошла ошибка при поиске песни. Попробуйте позже.");
    }
  }
}

// Форматирование песни для отображения
function formatSongForDisplay(song) {
  // Разделяем текст песни на строки
  const lines = song.fullText.split('\n');
  
  // Строим новый текст с красивым форматированием
  let formattedText = '🎸 ';
  let titleFound = false;
  let authorFound = false;
  
  // Обрабатываем каждую строку песни
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Обрабатываем строку с названием (содержит символ ♭)
    if (!titleFound && line.includes('♭')) {
      // Добавляем название без символа ♭ с красивым оформлением
      formattedText += `${line.replace('♭', '').trim()}\n`;
      titleFound = true;
      continue;
    }
    
    // Обрабатываем строку с автором (следующая после названия)
    if (titleFound && !authorFound) {
      const author = line.trim();
      if (author) {
        formattedText += `👤 ${author}\n`;
      }
      authorFound = true;
      continue;
    }
    
    // Добавляем все остальные строки как текст песни
    if (titleFound && authorFound) {
      // Определяем, является ли строка заголовком (припев, куплет и т.д.)
      const isHeader = 
        line.toLowerCase().includes('припев') || 
        line.toLowerCase().includes('куплет') ||
        line.toLowerCase().includes('chorus') ||
        line.toLowerCase().includes('verse') ||
        line.toLowerCase().includes('бридж') ||
        line.toLowerCase().includes('bridge');
      
      if (isHeader) {
        // Если это заголовок, выделяем его
        formattedText += `🎼 ${line.toUpperCase().trim()} 🎼\n`;
      } else if (line.trim()) {
        // Обрабатываем аккорды в тексте
        const processedLine = highlightChords(line);
        formattedText += processedLine + '\n';
      } else {
        // Пустая строка
        formattedText += '\n';
      }
    }
  }
  
  return formattedText;
}

// Функция для выделения аккордов красным цветом
function highlightChords(text) {
  // Регулярное выражение для поиска аккордов
  // Поиск сочетаний вида A, Am, C#, Dm7, G/B и т.д.
  const chordRegex = /\b([ACDEFGНB][#♯♭b]?(?:m|min|maj|sus|add|aug|dim)?(?:[2-9]|11|13)?(?:\/[ACDEFGНB][#♯♭b]?)?)(?=\s|$|\b)/g;
  
  // Заменяем найденные аккорды на тег, поддерживаемый Telegram
  // В Telegram HTML поддерживаются теги: b, i, u, s, a, code, pre
  return text.replace(chordRegex, '<b><i>$1</i></b>');
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
          currentSong.fullText +=  text;
          nextLineIsAuthor = false;
        }
        else if (currentSong) {
          // Добавляем строку к тексту песни
          currentSong.fullText += text;
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

// Получение правил орлятского круга с кешированием
async function getRules() {
  try {
    // Проверяем кэш
    const now = Date.now();
    if (cache.rules && cache.lastUpdate && (now - cache.lastUpdate < cache.updateInterval)) {
      return cache.rules;
    }
    
    // Если нет в кеше, загружаем из документа
    const document = await getDocumentContent();
    if (!document || !document.body || !document.body.content) {
      console.error('Документ пустой или имеет неправильный формат');
      return null;
    }
    
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
      return null;
    }
    
    // Сохраняем правила в кеш
    cache.rules = rules.trim();
    
    // Обновляем дату последнего обновления кеша, если ещё не установлена
    if (!cache.lastUpdate) {
      cache.lastUpdate = now;
    }
    
    return cache.rules;
  } catch (error) {
    console.error('Ошибка при получении правил:', error);
    return null;
  }
}

// Обработка вебхуков для Vercel
module.exports = async (req, res) => {
  try {
    // Если это GET запрос, отправляем статус
    if (req.method === 'GET') {
      return res.json({ status: 'OK', timestamp: new Date().toISOString() });
    }
    
    // Если это не POST запрос, отклоняем
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    // Обрабатываем обновление от Telegram
    await bot.handleUpdate(req.body);
    
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
