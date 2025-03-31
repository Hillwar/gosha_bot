const axios = require('axios');
const commandHandler = require('./handlers/commandHandler');
const config = require('./config');

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
  },
  {
    title: "Паруса",
    author: "Константин Тарасов",
    lyrics: `Am                      E
Всё в жизни перепробовал - и убедился я:
    Dm                       Am
Не шапка красит голову, друзья не красят друга,
   C                 G
И если ты с получки разоришься не дотла -
       Dm             E          Am
Скажи спасибо, братец, что в стране у нас - весна.

А за весною лето, снова высохнет вода,
А за зимою - осень, и весна придёт сама,
И снова вспыхнет солнце, и его лучом согреты
Паруса, паруса, паруса, паруса, паруса!

Вот тебе, вот и мне подарил Бог крылья,
А горизонт опять отодвинулся, и всё опять сначала.
Всё, что оставим мы - подарим мы снова 
Поднявшим паруса, паруса, паруса, паруса, паруса!

Посуди: для того ль небеса распахнуты  
Для тебя и меня, и для Вас - смысл скрытый странною игрою,
У странствий нить, а нам по ней идти, 
И свободы чуть-чуть подарить поднявшим паруса!

Вот тебе, вот и мне подарил Бог крылья,
А горизонт опять отодвинулся, и всё опять сначала.
Всё, что оставим мы - подарим мы снова 
Поднявшим паруса, паруса, паруса, паруса, паруса!`,
    group: 1,
    rhythm: "Простой бой",
    notes: ""
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

// URL картинки для правил орлятского круга
const circleRulesImageUrl = 'https://i.imgur.com/8JQZQZQ.jpg';

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
async function sendPhoto(chatId, photoUrl, caption = '') {
  try {
    console.log('Sending photo with URL:', circleRulesImageUrl);
    const response = await axios({
      method: 'post',
      url: `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
      data: {
        chat_id: chatId,
        photo: circleRulesImageUrl,
        caption: caption,
        parse_mode: 'HTML'
      }
    });
    console.log('Photo sent successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending photo:', error.response?.data || error.message);
    // В случае ошибки отправляем только текст
    await sendMessage(chatId, caption);
  }
}

// Поиск песни по названию или автору
function findSong(query) {
  if (!query || query.trim() === '') {
    return [];
  }
  
  query = query.toLowerCase().trim();
  console.log(`Searching for songs with query: "${query}"`);
  
  const results = songbook.filter(song => {
    const titleMatch = song.title && song.title.toLowerCase().includes(query);
    const authorMatch = song.author && song.author.toLowerCase().includes(query);
    const lyricsMatch = song.lyrics && song.lyrics.toLowerCase().includes(query);
    
    console.log(`Song: ${song.title}, Title match: ${titleMatch}, Author match: ${authorMatch}, Lyrics match: ${lyricsMatch}`);
    
    return titleMatch || authorMatch || lyricsMatch;
  });
  
  console.log(`Found ${results.length} songs matching "${query}"`);
  return results;
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

// Главная функция обработки запросов
module.exports = async (req, res) => {
  // Проверка метода запроса
  if (req.method === 'GET') {
    res.status(200).send(`Bot ${config.BOT_NAME} is running!`);
    return;
  }
  
  // Для POST-запросов обрабатываем обновления от Telegram
  if (req.method === 'POST') {
    console.log('Received update from Telegram:', JSON.stringify(req.body));
    
    const update = req.body;
    
    try {
      if (update.callback_query) {
        // Обработка callback-запросов (кнопки)
        console.log('Processing callback query:', update.callback_query.data);
        await commandHandler.handleCallback(update.callback_query);
      } else if (update.message) {
        if (update.message.text && update.message.text.startsWith('/')) {
          // Обработка команд (текст, начинающийся с /)
          console.log('Processing command:', update.message.text);
          await commandHandler.handleCommand(update.message);
        } else {
          // Обработка обычных сообщений
          console.log('Processing message:', update.message.text || 'non-text message');
          await commandHandler.handleMessage(update.message);
        }
      } else {
        console.log('Unknown update type:', update);
      }
      
      res.status(200).send('OK');
    } catch (error) {
      console.error('Error processing update:', error);
      res.status(200).send('Error processed');
    }
    
    return;
  }
  
  res.status(405).send('Method Not Allowed');
}; 