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

// Функция для получения состояния пользователя
function getUserState(userId) {
  // Если состояние не установлено или устарело (более 10 минут), возвращаем DEFAULT
  const userState = userStates[userId];
  console.log(`Получение состояния для пользователя ${userId}:`, userState);
  if (!userState || Date.now() - userState.timestamp > 10 * 60 * 1000) {
    return { state: STATES.DEFAULT, data: {}, timestamp: 0 };
  }
  return userState;
}

// Функция для установки состояния пользователя
function setUserState(userId, state, data = {}) {
  // Если устанавливаем DEFAULT, просто удаляем запись
  if (state === STATES.DEFAULT) {
    console.log(`Удаляем состояние для пользователя ${userId}`);
    delete userStates[userId];
    return;
  }
  
  // Иначе устанавливаем новое состояние
  userStates[userId] = {
    state,
    timestamp: Date.now(),
    data: { ...data }
  };
  console.log(`Установлено состояние для пользователя ${userId}:`, state, data);
}

// Функция для удаления команды и упоминания бота из текста сообщения
function cleanCommandText(text, command) {
  // Удаляем команду (например, /search) и любое упоминание бота (например, @gosha_demo_bot)
  return text.replace(new RegExp(`^/${command}(@\\w+)?`, 'i'), '').trim();
}

// Команда /start
bot.command('start', (ctx) => {
  // Сбрасываем состояние на DEFAULT
  setUserState(ctx.from.id, STATES.DEFAULT);
  
  // Используем cleanCommandText для очистки команды
  const query = cleanCommandText(ctx.message.text, 'start');
  
  ctx.reply('Привет! Я бот для поиска песен в аккорднике. Используй /help для списка команд.');
});

// Команда /help
bot.command('help', (ctx) => {
  // Сбрасываем состояние на DEFAULT
  setUserState(ctx.from.id, STATES.DEFAULT);
  
  // Используем cleanCommandText для очистки команды
  const query = cleanCommandText(ctx.message.text, 'help');
  
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
  console.log('Вызвана команда /search в чате:', ctx.chat.type, 'пользователем:', ctx.from.id);
  
  // Очищаем текст от команды и упоминания бота
  const query = cleanCommandText(ctx.message.text, 'search');
  console.log('Очищенный запрос из команды /search:', query);
  
  if (query) {
    // Если запрос уже есть в команде, выполняем поиск сразу
    await performSearch(ctx, query);
  } else {
    // Устанавливаем состояние ожидания поискового запроса ТОЛЬКО если запрос не указан в команде
    setUserState(ctx.from.id, STATES.AWAITING_SEARCH_QUERY, {
      chatId: ctx.chat.id,
      timestamp: Date.now()
    });
    
    // Иначе просим ввести запрос
    await ctx.reply('Введите название песни или часть её текста в следующем сообщении');
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
  
  // Используем cleanCommandText для очистки команды, хотя тут мы не используем текст сообщения,
  // добавляем для единообразия
  const query = cleanCommandText(ctx.message.text, 'list');
  
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
  
  // Используем cleanCommandText для очистки команды, хотя тут мы не используем текст сообщения,
  // добавляем для единообразия
  const query = cleanCommandText(ctx.message.text, 'random');
  
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
  
  // Используем cleanCommandText для очистки команды, хотя тут мы не используем текст сообщения,
  // добавляем для единообразия
  const query = cleanCommandText(ctx.message.text, 'circlerules');
  
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
      
      // Очищаем состояние пользователя (больше не ждем выбора)
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

// Функция для проверки, является ли сообщение командой
function isCommand(text) {
  return text.startsWith('/');
}

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  console.log('Получено текстовое сообщение в чате:', ctx.chat.type, 'от пользователя:', ctx.from.id, 'с текстом:', ctx.message.text);
  
  // Проверяем, является ли сообщение командой (начинается с '/')
  if (isCommand(ctx.message.text)) {
    console.log('Это сообщение распознано как команда');
    // Это команда, её обработает соответствующий обработчик
    return;
  }
  
  const userId = ctx.from.id;
  const userState = getUserState(userId);
  console.log('Текущее состояние пользователя:', userState);
  
  // Проверим, что состояние не устарело
  const currentTimestamp = Date.now();
  const stateDuration = userState.data.timestamp ? currentTimestamp - userState.data.timestamp : 0;
  console.log(`Время с момента установки состояния: ${stateDuration}мс`);
  
  // Если пользователь в режиме ожидания выбора, пробуем обработать сообщение как номер песни
  if (userState.state === STATES.AWAITING_SELECTION) {
    console.log('Пользователь в режиме ожидания выбора песни');
    
    // Проверяем, что сообщение поступило в тот же чат, где была команда /search
    if (userState.data.chatId && userState.data.chatId !== ctx.chat.id) {
      console.log('Чат сообщения не совпадает с чатом выбора песни');
      return; // Игнорируем сообщения в других чатах
    }
    
    // Пробуем извлечь номер песни из текста
    let songIndex = parseInt(ctx.message.text.trim()) - 1; // Пользователь вводит номер с 1, а не с 0
    
    console.log(`Извлечен номер песни: ${songIndex + 1}, всего песен: ${userState.data.matchedSongs ? userState.data.matchedSongs.length : 0}`);
    
    if (!isNaN(songIndex) && songIndex >= 0 && userState.data.matchedSongs && songIndex < userState.data.matchedSongs.length) {
      // Сбрасываем состояние пользователя перед тем, как отправить ответ
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
    } else {
      // Если это не номер песни или некорректный номер, сбрасываем состояние и сообщаем об ошибке
      console.log('Введен некорректный номер песни, сбрасываем состояние');
      setUserState(userId, STATES.DEFAULT);
      await ctx.reply('❌ Неверный номер песни. Поиск отменен. Используйте /search для нового поиска.');
      return;
    }
  }
  
  // Если пользователь в режиме ожидания поискового запроса, выполняем поиск
  // Это работает как в личных чатах, так и в групповых
  if (userState.state === STATES.AWAITING_SEARCH_QUERY) {
    console.log('Пользователь в режиме ожидания поискового запроса. Выполняем поиск для:', ctx.message.text);
    
    // Проверяем, что сообщение поступило в тот же чат, где была команда /search
    if (userState.data.chatId && userState.data.chatId !== ctx.chat.id) {
      console.log('Чат сообщения не совпадает с чатом команды /search');
      return; // Игнорируем сообщения в других чатах
    }
    
    // ВАЖНО: Сначала удаляем состояние, потом выполняем поиск
    // Это предотвратит повторную обработку этого же сообщения
    setUserState(userId, STATES.DEFAULT);
    
    // Выполняем поиск по запросу
    await performSearch(ctx, ctx.message.text);
    return;
  }
  
  // Дальше обрабатываем только личные чаты
  if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
    console.log('Игнорируем сообщение в групповом чате, так как нет активного ожидания');
    return; // В групповых чатах игнорируем все остальные сообщения
  }
  
  // В личных чатах даем подсказку
  console.log('Отправляем подсказку в личном чате');
  await ctx.reply('Используйте /search для поиска песен.');
});

// Функция поиска песни
async function performSearch(ctx, query) {
  console.log('Запуск функции поиска с запросом:', query);
  
  const animation = await animateLoading(
    ctx, 
    `🔍 Ищу песню "${query}"... ⏳`, 
    [`🔍 Ищу песню "${query}"... ⏳`, `🔍 Ищу песню "${query}"... ⌛`, `🔍 Ищу совпадения... ⏳`, `🔍 Ищу совпадения... ⌛`]
  );
  
  try {
    const songs = await getSongs();
    console.log(`Получено ${songs ? songs.length : 0} песен из базы данных`);
    
    if (!songs || songs.length === 0) {
      console.log('Песни не найдены в базе данных');
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
    
    console.log(`Найдено ${matchedSongs.length} песен по запросу "${query}"`);
    if (matchedSongs.length > 0) {
      // Для отладки выводим названия найденных песен
      matchedSongs.forEach((song, index) => {
        console.log(`Песня ${index + 1}: ${song.title}`);
      });
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
    
    if (matchedSongs.length === 0) {
      console.log(`Песня "${query}" не найдена.`);
      await ctx.reply(`❌ Песня "${query}" не найдена.`);
    } else if (matchedSongs.length === 1) {
      // Если нашли одну песню, отправляем её с HTML-форматированием
      console.log(`Отправляем единственную найденную песню: ${matchedSongs[0].title}`);
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
      console.log(`Отправляем список из ${matchedSongs.length} песен с кнопками выбора`);
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
      console.log(`Устанавливаем состояние ${STATES.AWAITING_SELECTION} для пользователя ${ctx.from.id}`);
      setUserState(ctx.from.id, STATES.AWAITING_SELECTION, { 
        matchedSongs, 
        query,
        chatId: ctx.chat.id, 
        timestamp: Date.now() 
      });
      
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
    console.log('Вызвана функция getSongs');
    
    // Проверяем кэш
    const now = Date.now();
    if (cache.songs.length > 0 && cache.lastUpdate && (now - cache.lastUpdate < cache.updateInterval)) {
      console.log(`Возвращаем кешированные песни (${cache.songs.length} шт.)`);
      
      // Вывод информации о нескольких первых песнях для отладки
      if (cache.songs.length > 0) {
        console.log('Примеры песен из кеша:');
        for (let i = 0; i < Math.min(3, cache.songs.length); i++) {
          console.log(`${i + 1}. ${cache.songs[i].title}`);
        }
        
        // Проверим, есть ли песня "Парус" в кеше
        const parusSong = cache.songs.find(song => 
          song.title.toLowerCase().includes('парус') || 
          song.fullText.toLowerCase().includes('парус')
        );
        
        if (parusSong) {
          console.log('Песня "Парус" найдена в кеше:', parusSong.title);
        } else {
          console.log('Песня "Парус" НЕ найдена в кеше!');
        }
      }
      
      return cache.songs;
    }
    
    console.log('Кеш устарел, загружаем документ заново');
    
    // Получаем содержимое документа
    const document = await getDocumentContent();
    if (!document || !document.body || !document.body.content) {
      console.error('Документ пустой или имеет неправильный формат');
      return [];
    }
    
    const songs = [];
    let currentSong = null;
    let nextLineIsAuthor = false;
    
    console.log(`Начинаем обработку документа, элементов: ${document.body.content.length}`);
    
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
          
          console.log(`Найдена новая песня: ${cleanTitle}`);
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
    
    console.log(`Найдено ${songs.length} песен в документе`);
    
    // Фильтруем песни и обновляем кэш
    const filteredSongs = songs.filter(song => song.title && song.title.trim().length > 2);
    console.log(`После фильтрации осталось ${filteredSongs.length} песен`);
    
    if (filteredSongs.length > 0) {
      // Вывод информации о нескольких первых песнях для отладки
      console.log('Примеры найденных песен:');
      for (let i = 0; i < Math.min(3, filteredSongs.length); i++) {
        console.log(`${i + 1}. ${filteredSongs[i].title}`);
      }
      
      // Проверим, есть ли песня "Парус" в найденных песнях
      const parusSong = filteredSongs.find(song => 
        song.title.toLowerCase().includes('парус') || 
        song.fullText.toLowerCase().includes('парус')
      );
      
      if (parusSong) {
        console.log('Песня "Парус" найдена:', parusSong.title);
      } else {
        console.log('Песня "Парус" НЕ найдена!');
      }
      
      cache.songs = filteredSongs;
      cache.lastUpdate = now;
      return filteredSongs;
    }
    
    console.log('Не найдено подходящих песен после фильтрации');
    return [];
  } catch (error) {
    console.error('Ошибка при получении песен:', error);
    // Если в кэше есть песни, возвращаем их даже если кэш устарел
    if (cache.songs.length > 0) {
      console.log(`Возвращаем кешированные песни после ошибки (${cache.songs.length} шт.)`);
      return cache.songs;
    }
    console.log('Кеш пуст, возвращаем пустой массив');
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
