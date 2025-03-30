const axios = require('axios');

// Токен бота
const BOT_TOKEN = '7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs';
const BOT_NAME = 'gosha_demo_bot';
const WEBHOOK_URL = 'https://gosha-bot.vercel.app/api/webhook';

// Ссылка на документ Google с аккордами
const SONGBOOK_URL = 'https://docs.google.com/document/d/1e7t6SXSQKO9DMIMehiY_8NwHcQQQ1OVv/edit';

// Объект для хранения статистики песен
let songsStats = {};

// Время последнего запроса для каждой песни
let lastSongRequests = {};

// Песни из аккордника (будет заполняться динамически)
const songbook = [
  {
    title: "Атланты",
    author: "Александр Городницкий",
    lyrics: `Am             Dm          E                 Am
1.Когда на сердце тяжесть, и холодно в груди,
Am             Dm        G                 C
К ступеням Эрмитажа ты в сумерках приди.
A7                Dm    G                 C
Где без питья и хлеба, забытые в веках,
Dm             Am   E                 Am
Атланты держат небо на каменных руках.

2.Держать его махину не мёд со стороны,
Напряжены их спины, колени сведены.
Их тяжкая работа важнее всех работ:
Из них ослабнет кто-то, и небо упадёт.

3.Во тьме заплачут вдовы, повыгорят поля,
И встанет гриб лиловый, и кончится Земля.
А небо год от года всё давит тяжелей,
Дрожит оно от гуда ракетных кораблей.

4.Стоят они - ребята, точёные тела,
Поставлены когда-то, а смена не пришла.
Их свет дневной не радует, им ночью не до сна.
Их красоту снарядами уродует война.

5.Стоят они навеки, упершись лбы в беду.
Не боги человеки, привыкшие к труду.
И жить еще надежде до той поры, пока
Атланты небо держат на каменных руках.`,
    group: 1,
    rhythm: "Простой бой (четырёхдольный)",
    notes: "Последние строчки куплета х2"
  },
  {
    title: "Перевал",
    author: "Юрий Визбор",
    lyrics: `      Am                  Dm
Просто нечего нам больше терять,
    G                      C  E
Все потеряно, проиграно в прах.
     Am                    Dm
И осталась в этом мире одна
     H7                  E
В трех вокзалах земля и зола.

             Am        Dm
Перевал, перевал, перевал,
             G         C  E
Перевал, перевал, перевал,
        Am              Dm
Мы затеряны в этой стране,
        H7              E
Наше время на этой войне.

В черный цвет окрасилась трава,
В красный цвет окрасилась река.
А беда, она везде одна,
Словно снег, словно смерть, как стена.

Перевал, перевал, перевал,
Перевал, перевал, перевал,
Мы затеряны в этой стране,
Наше время на этой войне.

Напиши письмецо да отцу,
Напиши, как живешь, как дела.
Что же делать, война есть война,
По-другому ее не назвать.

Перевал, перевал, перевал,
Перевал, перевал, перевал,
Мы затеряны в этой стране,
Наше время на этой войне.

Просто нечего нам больше терять,
Пусть сожженные огнем города.
И осталась в этом мире одна
В трех вокзалах земля и зола.

Перевал, перевал, перевал,
Перевал, перевал, перевал,
Мы затеряны в этой стране,
Наше время на этой войне.`,
    group: 1,
    rhythm: "Перебор",
    notes: "Припев играется на повышенных тонах"
  }
];

// Правила орлятского круга
const circleRules = `ПРАВИЛА ОРЛЯТСКОГО КРУГА

1. Орлятский круг - важная завершающая часть дня/общей встречи. Не опаздывай на него. Мы тебя ждём.
2. Пускай в круг каждого.
3. Если вы не пустили в круг, вам важно подойти после круга и объяснить товарищу почему.
4. Будь опрятным сам и напомни об опрятности другому.
5. Встаём в круг мальчик-девочка (по возможности)
6. Круг должен быть круглым. Это очень просто сделать! Просто обними товарищей сбоку и отходи максимально назад (без разрывания круга. Посмотри по сторонам. Ты должен видеть лицо каждого.
7. Покачиваемся в противоположную от противоположной стороны сторону. Направление и темп задаёт ДКС/ДКЗ/Командир
8. Если песню запел и поёт один человек, то не прерываем. Не бойся и поддержи его, если знаешь часть слов!
8. Ориентируемся по пению на человека с гитарой.
9. Если случилось так, что два человека/две части круга запели одновременно, то оба/обе должны замолчать и уступить время третьей песне.
10. Не пересекай круг без острой необходимости.
Если круг не сомкнут , то его можно пересечь.
11. Уважительно относись к песне и она даст тебе сил.
12. После орлятского круга не поём орлятские песни и стараемся не шуметь.
13. Нельзя перебивать завершающую песню 
14. Не пропускай орлятские круги.

Будь осознанным и помни о здравом смысле. 
С 🧡 песенная служба.`;

// URL картинки для правил орлятского круга (обновлено на rules_img.jpeg)
const circleRulesImageUrl = 'https://gosha-bot.vercel.app/api/img/rules_img.jpeg';

// Вспомогательная функция для отправки сообщений
async function sendMessage(chatId, text, options = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: options.parse_mode || 'HTML',
    ...options
  };
  
  try {
    const response = await axios.post(url, payload);
    return response.data;
  } catch (error) {
    console.error('Error sending message:', error);
    return null;
  }
}

// Отправка фото с подписью
async function sendPhoto(chatId, photoUrl, caption, options = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  const payload = {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption,
    parse_mode: options.parse_mode || 'HTML',
    ...options
  };
  
  try {
    const response = await axios.post(url, payload);
    return response.data;
  } catch (error) {
    console.error('Error sending photo:', error);
    return null;
  }
}

// Поиск песни по названию или автору
function findSong(query) {
  query = query.toLowerCase();
  
  return songbook.filter(song => {
    return song.title.toLowerCase().includes(query) || 
           (song.author && song.author.toLowerCase().includes(query)) ||
           song.lyrics.toLowerCase().includes(query);
  });
}

// Форматирование песни для вывода
function formatSong(song) {
  let formattedSong = `<b>${song.title}</b>`;
  
  if (song.author) {
    formattedSong += `\n<i>Автор: ${song.author}</i>`;
  }
  
  if (song.rhythm) {
    formattedSong += `\n<i>Ритм: ${song.rhythm}</i>`;
  }
  
  if (song.notes) {
    formattedSong += `\n<i>Примечание: ${song.notes}</i>`;
  }
  
  formattedSong += `\n\n<pre>${song.lyrics}</pre>`;
  
  // Добавление ссылки на исходный документ
  formattedSong += `\n\n<a href="${SONGBOOK_URL}">Открыть полный аккордник</a>`;
  
  return formattedSong;
}

// Получение случайной песни, которую давно не пели
function getRandomUnusedSong() {
  // Сортируем песни по времени последнего запроса (сначала те, которые давно не использовались)
  const sortedSongs = [...songbook].sort((a, b) => {
    const timeA = lastSongRequests[a.title] || 0;
    const timeB = lastSongRequests[b.title] || 0;
    return timeA - timeB;
  });
  
  // Берем первую треть списка (самые редко используемые)
  const unusedSongs = sortedSongs.slice(0, Math.max(1, Math.floor(sortedSongs.length / 3)));
  
  // Выбираем случайную песню из этого списка
  const randomIndex = Math.floor(Math.random() * unusedSongs.length);
  const song = unusedSongs[randomIndex];
  
  // Обновляем время последнего запроса для этой песни
  lastSongRequests[song.title] = Date.now();
  
  return song;
}

// Получение статистики запросов песен
function getSongsStatistics() {
  const songEntries = Object.entries(songsStats).sort((a, b) => b[1] - a[1]);
  
  if (songEntries.length === 0) {
    return "Статистика пока не собрана. Используйте команду /chords для поиска песен.";
  }
  
  let statsMessage = "<b>Статистика запросов песен:</b>\n\n";
  
  songEntries.forEach(([title, count], index) => {
    statsMessage += `${index + 1}. ${title}: ${count} ${count === 1 ? 'запрос' : 'запросов'}\n`;
  });
  
  return statsMessage;
}

// Получение списка всех песен
function getSongsList() {
  let listMessage = "<b>Список песен в аккорднике:</b>\n\n";
  
  songbook.forEach((song, index) => {
    listMessage += `${index + 1}. ${song.title}`;
    if (song.author) {
      listMessage += ` - ${song.author}`;
    }
    listMessage += '\n';
  });
  
  return listMessage;
}

// Обработка команд
async function handleCommand(message) {
  const chatId = message.chat.id;
  const text = message.text;
  
  // Извлечение команды и аргументов
  const [command, ...args] = text.split(' ');
  const query = args.join(' ');
  
  switch(command) {
    case '/start':
      await sendMessage(chatId, `Привет! Я Гоша, бот-помощник с аккордами и песнями. 
      
Используй команду /help, чтобы узнать, что я умею.`);
      break;
      
    case '/help':
      await sendMessage(chatId, `<b>Доступные команды:</b>

/chords [запрос] - поиск песни в аккорднике
/list - список всех песен
/circlerules - правила орлятского круга
/status - статистика запросов песен
/random - получить случайную песню, которую давно не пели

Чтобы найти песню, используйте команду /chords и часть названия или автора, например:
/chords атланты
/chords визбор
/chords перевал`);
      break;
      
    case '/chords':
      if (!query) {
        await sendMessage(chatId, "Пожалуйста, укажите название песни или автора после команды /chords");
        return;
      }
      
      const songs = findSong(query);
      
      if (songs.length === 0) {
        await sendMessage(chatId, `По запросу "${query}" ничего не найдено. Попробуйте другой запрос или используйте команду /list для списка всех песен.`);
        return;
      }
      
      if (songs.length === 1) {
        // Обновляем статистику
        songsStats[songs[0].title] = (songsStats[songs[0].title] || 0) + 1;
        lastSongRequests[songs[0].title] = Date.now();
        
        await sendMessage(chatId, formatSong(songs[0]));
      } else if (songs.length <= 5) {
        let songButtons = songs.map(song => [{
          text: song.title + (song.author ? ` (${song.author})` : ''),
          callback_data: `song:${song.title}`
        }]);
        
        await sendMessage(chatId, `Найдено ${songs.length} песен по запросу "${query}". Выберите песню:`, {
          reply_markup: JSON.stringify({
            inline_keyboard: songButtons
          })
        });
      } else {
        await sendMessage(chatId, `Найдено слишком много песен (${songs.length}). Пожалуйста, уточните запрос.`);
      }
      break;
      
    case '/circlerules':
      // Отправляем фото с правилами и текст
      await sendPhoto(chatId, circleRulesImageUrl, circleRules);
      break;
      
    case '/status':
      await sendMessage(chatId, getSongsStatistics());
      break;
      
    case '/list':
      await sendMessage(chatId, getSongsList());
      break;
      
    case '/random':
      const randomSong = getRandomUnusedSong();
      await sendMessage(chatId, `Вот песня, которую давно не пели:\n\n${formatSong(randomSong)}`);
      break;
      
    default:
      // Неизвестная команда
      break;
  }
}

// Обработка callback-запросов (для инлайн-кнопок)
async function handleCallback(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  if (data.startsWith('song:')) {
    const songTitle = data.substring(5);
    const song = songbook.find(s => s.title === songTitle);
    
    if (song) {
      // Обновляем статистику
      songsStats[song.title] = (songsStats[song.title] || 0) + 1;
      lastSongRequests[song.title] = Date.now();
      
      await sendMessage(chatId, formatSong(song));
    } else {
      await sendMessage(chatId, `Песня "${songTitle}" не найдена.`);
    }
  }
  
  // Уведомляем Telegram, что callback обработан
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      callback_query_id: callbackQuery.id
    });
  } catch (error) {
    console.error('Error answering callback query:', error);
  }
}

// Обработка сообщений, не являющихся командами
async function handleNonCommandMessage(message) {
  const chatId = message.chat.id;
  
  // Проверяем тип сообщения
  if (message.photo) {
    // Если прислали фото
    await sendMessage(chatId, "Спасибо за фото! Если хотите найти аккорды к песне, воспользуйтесь командой /chords [название песни]");
  } else if (message.voice) {
    // Если прислали голосовое сообщение
    await sendMessage(chatId, "Вместо голосового лучше спойте песню вживую! Используйте /random, чтобы получить случайную песню");
  } else if (message.video) {
    // Если прислали видео
    await sendMessage(chatId, "Интересное видео! Если вам нужны правила орлятского круга, используйте команду /circlerules");
  } else if (message.audio || message.document) {
    // Если прислали аудио или документ
    await sendMessage(chatId, "Спасибо за файл! Если вам нужна конкретная песня, воспользуйтесь поиском через /chords [название песни]");
  } else if (message.text) {
    // Если прислали обычный текст (не команду)
    
    // Проверяем, может это запрос песни без команды
    const songs = findSong(message.text);
    
    if (songs.length === 1) {
      // Нашли точное совпадение
      songsStats[songs[0].title] = (songsStats[songs[0].title] || 0) + 1;
      lastSongRequests[songs[0].title] = Date.now();
      
      await sendMessage(chatId, formatSong(songs[0]));
    } else if (songs.length > 1 && songs.length <= 5) {
      // Нашли несколько совпадений
      let songButtons = songs.map(song => [{
        text: song.title + (song.author ? ` (${song.author})` : ''),
        callback_data: `song:${song.title}`
      }]);
      
      await sendMessage(chatId, `Нашел ${songs.length} песен по запросу "${message.text}". Выберите песню:`, {
        reply_markup: JSON.stringify({
          inline_keyboard: songButtons
        })
      });
    } else {
      // Отвечаем случайной фразой
      const responses = [
        "Я не совсем понял, что вы имеете в виду. Используйте /help, чтобы увидеть список команд.",
        "Для поиска песни используйте команду /chords и часть названия или автора.",
        "Хотите получить случайную песню? Используйте /random!",
        "Если вам нужны правила орлятского круга, введите /circlerules",
        "Чтобы увидеть список всех песен, введите /list"
      ];
      
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      await sendMessage(chatId, randomResponse);
    }
  }
}

// Главная функция обработки запросов
module.exports = async (req, res) => {
  // Проверка метода запроса
  if (req.method === 'GET') {
    // Для GET-запросов отправляем простую страницу
    res.status(200).send(`Bot ${BOT_NAME} is running!`);
    return;
  }
  
  // Для POST-запросов обрабатываем обновления от Telegram
  if (req.method === 'POST') {
    const update = req.body;
    
    if (update.callback_query) {
      // Обработка callback-запросов (кнопки)
      await handleCallback(update.callback_query);
    } else if (update.message) {
      if (update.message.text && update.message.text.startsWith('/')) {
        // Обработка команд (текст, начинающийся с /)
        await handleCommand(update.message);
      } else {
        // Обработка обычных сообщений
        await handleNonCommandMessage(update.message);
      }
    }
    
    // Отправляем успешный ответ
    res.status(200).send('OK');
    return;
  }
  
  // Для других методов запроса отправляем ошибку
  res.status(405).send('Method Not Allowed');
}; 