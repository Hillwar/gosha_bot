// Код адаптирован для Vercel из оригинального бота @Gosha63
const axios = require('axios');

// Конфигурация бота
const authorTelegram = "@Hleb66613";
const botTelegram = "@gosha_demo_bot";
const apiToken = "7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs";
const apiUrl = "https://api.telegram.org/bot" + apiToken;
const botId = "7746110687";

// Имитация функций Google Documents для хранения данных
// В реальном приложении здесь должна быть база данных или другой способ хранения
const anecdotes = [
  { getRow: (i) => ({ getText: () => "Колобок повесился" }) },
  { getRow: (i) => ({ getText: () => "У программиста спрашивают:\n- Как вы занимаетесь сексом?\nОн отвечает:\n- Да как обычно...\n1. Ввод-вывод\n2. Обработка\n3. Ввод-вывод\n4. Обработка\n5. Ввод-вывод\n6. Обработка\n7. Ввод-вывод\n8. Откат последней операции\n9. Ввод-вывод\n10. Завершение программы\n11. Аварийное восстановление" }) },
  { getRow: (i) => ({ getText: () => "Разговаривают два программиста:\n- Что это у тебя за шрам на лбу?\n- Да вчера хотел чай налить в кружку, подвигал курсор мышкой и автоматически нажал кнопку, тут же переключился на чайник и щелкнул кнопкой..." }) }
];

const swears = [
  { getRow: (i) => ({ getText: () => "блядь" }) },
  { getRow: (i) => ({ getText: () => "хуй" }) },
  { getRow: (i) => ({ getText: () => "пизда" }) },
  { getRow: (i) => ({ getText: () => "ебать" }) }
];

const responses = [
  { getRow: (i) => ({ getText: () => "Я тебя не понимаю :)" }) },
  { getRow: (i) => ({ getText: () => "Что ты имеешь в виду?" }) },
  { getRow: (i) => ({ getText: () => "Не могу разобрать, что ты пишешь" }) },
  { getRow: (i) => ({ getText: () => "Напиши /help, чтобы посмотреть список команд" }) }
];

const chords = [
  { 
    getRow: (i) => {
      const rows = [
        "Кино - Пачка сигарет",  // 0 - title
        "6/8",                   // 1 - rhythm
        "Кино",                  // 2 - group
        "В. Цой",                // 3 - authors
        "",                      // 4 - features
        "",                      // 5 - voice
        "",                      // 6 - telegramVideo
        "https://www.youtube.com/watch?v=v0uSOjnRm3U", // 7 - webVideo
        "Я сижу и смотрю в чужое небо из чужого окна\nИ не вижу ни одной знакомой звезды.\nЯ ходил по всем дорогам и туда, и сюда,\nОбернулся - и не смог разглядеть следы.\n\nНо если есть в кармане пачка сигарет,\nЗначит всё не так уж плохо на сегодняшний день.\nИ билет на самолёт с серебристым крылом,\nЧто, взлетая, оставляет земле лишь тень.\n\nИ никто не хотел быть виноватым без вина,\nИ никто не хотел руками жар загребать,\nА без музыки на миру смерть не красна,\nА без музыки не хочется пропадать.\n\nНо если есть в кармане пачка сигарет,\nЗначит всё не так уж плохо на сегодняшний день.\nИ билет на самолёт с серебристым крылом,\nЧто, взлетая, оставляет земле лишь тень."  // 8 - chords
      ];
      return { getText: () => rows[i] };
    }
  },
  { 
    getRow: (i) => {
      const rows = [
        "ДДТ - Что такое осень",  // 0 - title
        "4/4",                     // 1 - rhythm
        "ДДТ",                     // 2 - group
        "Ю. Шевчук",               // 3 - authors
        "",                        // 4 - features
        "",                        // 5 - voice
        "",                        // 6 - telegramVideo
        "https://www.youtube.com/watch?v=5KC-iscJtsI", // 7 - webVideo
        "Что такое осень - это небо,\nПлачущее небо под ногами.\nВ лужах разлетаются птицы с облаками.\nОсень, я давно с тобою не был.\n\nВ лужах разлетаются птицы с облаками.\nОсень, я давно с тобою не был.\nЭто трудно вытравить словами.\nЧто такое осень - это ветер вдруг."  // 8 - chords
      ];
      return { getText: () => rows[i] };
    }
  }
];

const strumming = [
  { 
    getRow: (i) => {
      const rows = [
        "Простой бой",  // 0 - title
        "Самый простой бой, подходит для начинающих",  // 1 - features
        "AgACAgIAAxkBAAIRUGSDVgma-DKvt5QVzVdBR_JyLYXMAAL5yTEbFPIYSKY8WFvYxKYOAQADAgADeQADLwQ",  // 2 - photo
        "AwACAgIAAxkBAAIRVGSDViY4iL2rFDQIrJsQzBFfKMPSAAJaMAACFPIYSGxrznTFE0M6LwQ",  // 3 - voice
        "",  // 4 - telegramVideo
        ""   // 5 - webVideo
      ];
      return { getText: () => rows[i] };
    }
  }
];

const circleRulesPhotoFileId = "AgACAgIAAxkBAAIRT2SDVgm3Y-Z7Vn3dWSyxUN5aMdPxAAL4yTEbFPIYSL1ak6-yr6pZAQADAgADeQADLwQ";

// Класс для представления песни
class Song {
  constructor(table, tableNumber) {
    this.title = "Название: " + table.getRow(0).getText() + "\n";
    this.rhytm = "Ритмика: " + table.getRow(1).getText() + "\n";
    this.group = "Группа: " + table.getRow(2).getText() + "\n";
    this.authors = table.getRow(3).getText();
    this.features = table.getRow(4).getText();
    this.voice = table.getRow(5).getText();
    this.telegramVideo = table.getRow(6).getText();
    this.webVideo = table.getRow(7).getText();
    this.chords = table.getRow(8).getText();
    this.tableNumber = tableNumber;

    this.authors = this.authors == "" ? "Авторы: неизвестны\n" : "Авторы: " + this.authors + "\n";
    this.features = this.features == "" ? "" : "Особенности: " + this.features + "\n";
  }
}

// Класс для представления боя/перебора
class StrummingPattern {
  constructor(table, tableNumber) {
    this.title = "Название: " + table.getRow(0).getText() + "\n";
    this.features = table.getRow(1).getText();
    this.photo = table.getRow(2).getText();
    this.voice = table.getRow(3).getText();
    this.telegramVideo = table.getRow(4).getText();
    this.webVideo = table.getRow(5).getText();
    this.tableNumber = tableNumber;

    this.features = this.features == "" ? "" : "Особенности: " + this.features + "\n";
  }
}

// Команды бота
const commands = {
  "/start": commandStart,
  "/anecdote": commandAnecdote,
  "/help": commandHelp,
  "/chords": commandChords,
  "/source": commandSource,
  "/list": commandList,
  "/cancel": commandCancel,
  "/status": commandStatus,
  "/strumming": commandStrumming,
  "/circlerules": commandCircleRules,
  "/ping_gosha": commandPing,
  "/talk": commandTalk
};

// Утилитарные функции
function findWord(word, str) {
  return str.split(' ').some(function(w) { return w === word; }); //regexp doesn't work on russian characters. Too bad!
}

function normalizeString(str) {
  str = str.toLowerCase();
  str = str.replace(/\.|,|:|;|!|\?|"|/gm, "");
  str = str.replace(/ë|ё/gm, "е"); //these are two different characters!
  return str;
}

// Методы поиска песен
function findChordsByAuthor(author) {
  const foundSongs = [];
  author = normalizeString(author);
  
  for (let i = 0; i < chords.length; i++) {
    let authors = chords[i].getRow(3).getText();
    authors = normalizeString(authors);
    if (authors.includes(author)) {
      const song = new Song(chords[i], i);
      foundSongs.push(song);
    }
  }
  
  if (foundSongs.length > 0) {
    return foundSongs;
  } else {
    return null;
  }
}

function findChordsByTitle(title) {
  const foundSongs = [];
  title = normalizeString(title);
  
  for (let i = 0; i < chords.length; i++) {
    let titles = chords[i].getRow(0).getText();
    titles = normalizeString(titles);
    if (titles.includes(title)) {
      const song = new Song(chords[i], i);
      foundSongs.push(song);
    }
  }
  
  if (foundSongs.length > 0) {
    return foundSongs;
  } else {
    return null;
  }
}

function findChordsByLine(line) {
  const foundSongs = [];
  line = normalizeString(line);
  
  for (let i = 0; i < chords.length; i++) {
    let lines = chords[i].getRow(8).getText();
    lines = normalizeString(lines);
    if (lines.includes(line)) {
      const song = new Song(chords[i], i);
      foundSongs.push(song);
    }
  }
  
  if (foundSongs.length > 0) {
    return foundSongs;
  } else {
    return null;
  }
}

// Рандомные функции
function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function getRandomTable(tables) {
  const random = randomInRange(1, tables.length) - 1;
  return tables[random];
}

// Функции отправки сообщений через Telegram API
async function sendMessage(text, chat_id, keyBoard = null) {
  try {
    const data = {
      chat_id: String(chat_id),
      text: text,
      parse_mode: "HTML"
    };

    if (keyBoard) {
      data.reply_markup = JSON.stringify(keyBoard);
    }

    const response = await axios.post(`${apiUrl}/sendMessage`, data);
    return response.data;
  } catch (error) {
    console.error('Error sending message:', error);
    return { ok: false, error: error.message };
  }
}

async function sendPhoto(file_id, chat_id) {
  try {
    const data = {
      chat_id: String(chat_id),
      photo: String(file_id)
    };

    const response = await axios.post(`${apiUrl}/sendPhoto`, data);
    return response.data;
  } catch (error) {
    console.error('Error sending photo:', error);
    return { ok: false, error: error.message };
  }
}

async function sendVoice(file_id, chat_id) {
  try {
    const data = {
      chat_id: String(chat_id),
      voice: String(file_id)
    };

    const response = await axios.post(`${apiUrl}/sendVoice`, data);
    return response.data;
  } catch (error) {
    console.error('Error sending voice:', error);
    return { ok: false, error: error.message };
  }
}

async function sendVideo(file_id, chat_id) {
  try {
    const data = {
      chat_id: String(chat_id),
      video: String(file_id)
    };

    const response = await axios.post(`${apiUrl}/sendVideo`, data);
    return response.data;
  } catch (error) {
    console.error('Error sending video:', error);
    return { ok: false, error: error.message };
  }
}

// Функции для отправки контента
async function sendSong(song, chat_id) {
  const textMessage = song.title + song.authors + song.rhytm + song.features + song.group;
  await sendMessage(textMessage, chat_id);
  
  if (song.voice !== "") {
    await sendVoice(song.voice, chat_id);
  }
  
  if (song.telegramVideo !== "") {
    await sendVideo(song.telegramVideo, chat_id);
  }
  
  if (song.webVideo !== "") {
    await sendMessage(song.webVideo, chat_id);
  }
  
  await sendMessage(song.chords, chat_id);
}

async function sendStrummingPattern(pattern, chat_id) {
  const textMessage = pattern.title + pattern.features;
  await sendMessage(textMessage, chat_id);
  
  if (pattern.photo !== "") {
    await sendPhoto(pattern.photo, chat_id);
  }
  
  if (pattern.voice !== "") {
    await sendVoice(pattern.voice, chat_id);
  }
  
  if (pattern.telegramVideo !== "") {
    await sendVideo(pattern.telegramVideo, chat_id);
  }
  
  if (pattern.webVideo !== "") {
    await sendMessage(pattern.webVideo, chat_id);
  }
}

async function sendRandomResponse(chat_id) {
  const table = getRandomTable(responses);
  const txt = table.getRow(0).getText();
  await sendMessage(txt, chat_id);
}

// Команды бота
async function commandStart(chat_id) {
  await sendMessage("Ну привет", chat_id);
}

async function commandChords(chat_id) {
  const keyboard = {
    inline_keyboard: [
      [{
        text: "по автору",
        callback_data: "author"
      },
      {
        text: "по названию",
        callback_data: "title"
      }],
      [{
        text: "по тексту",
        callback_data: "line"
      }]
    ],
    resize_keyboard: true,
    remove_keyboard: true
  };
  
  await sendMessage("Как именно мне стоит искать песню?", chat_id, keyboard);
}

async function commandAnecdote(chat_id) {
  const table = getRandomTable(anecdotes);
  const anec = table.getRow(0).getText();
  await sendMessage(anec, chat_id);
}

async function commandHelp(chat_id) {
  await sendMessage("<b>Команды:</b>\n/list - скинуть аккордник со всеми песнями\n/chords - найти аккорды к песне по автору, названию или знакомой вам строчке. Если я найду больше, чем 1 (одну) песню, то предложу вам выбрать нужную\n/strumming - показать, как играется выбранный бой или перебор\n/circlerules - скинуть красивую фотографию с правилами орлятского круга\n/anecdote - рассказать анекдот, который может поднять вам настроение\n/talk - сказать что-нибудь\n/status - получить информацию о том, насколько я умный\n/help - помощь. Команда, которую вы только что использовали\n/ping_gosha - техническая команда, которая выведет id чата и JSON вашего сообщения\n/source - инструкции по получению исходного кода\n\n<b>Хотите добавить свой анекдот/реплику? Нашли ошибку или просто есть что сказать? Пишите </b>" + authorTelegram, chat_id);
}

async function commandCancel(chat_id) {
  const keyboard = {
    remove_keyboard: true
  };
  
  await sendMessage("Отмена операции. Вжух-вжух", chat_id, keyboard);
}

async function commandSource(chat_id) {
  await sendMessage("Пишите " + authorTelegram + "\nЯ написан на Node.js и размещен на Vercel", chat_id);
}

async function commandList(chat_id) {
  await sendMessage("Список песен в аккорднике:\n1. Кино - Пачка сигарет\n2. ДДТ - Что такое осень", chat_id);
}

async function commandStatus(chat_id) {
  const songsNumber = chords.length;
  const anecdotesNumber = anecdotes.length;
  const responsesNumber = responses.length;
  const strummingNumber = strumming.length;
  
  await sendMessage("На данный момент я знаю:\n<b>Песен: </b>" + songsNumber + "\n<b>Анекдотов: </b>" + anecdotesNumber + "\n<b>Реплик: </b>" + responsesNumber + "\n<b>Боёв/переборов: </b>" + strummingNumber, chat_id);
}

async function commandStrumming(chat_id) {
  const keyboard = {
    inline_keyboard: [],
    resize_keyboard: true
  };
  
  for (let i = 0; i < strumming.length; i++) {
    let row = [{
      text: strumming[i].getRow(0).getText().replace(/(\r\n|\n|\r)/gm, ""),
      callback_data: "requestStrumming_" + String(i)
    }];
    
    keyboard.inline_keyboard.push(row);
  }
  
  await sendMessage("Какой именно бой/перебор вас интересует?", chat_id, keyboard);
}

async function commandCircleRules(chat_id) {
  await sendPhoto(circleRulesPhotoFileId, chat_id);
}

async function commandPing(chat_id, update) {
  await sendMessage("Pong!\n" + chat_id, chat_id);
  await sendMessage(JSON.stringify(update), chat_id);
}

async function commandTalk(chat_id) {
  await sendRandomResponse(chat_id);
}

// Обработчик вебхука для Vercel
module.exports = async (req, res) => {
  // Обработка проверки webhook статуса
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'Webhook is working' });
  }

  // Обработка только POST запросов
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    const update = req.body;
    console.log('Received update:', JSON.stringify(update));

    // Обработка callback_query (нажатие на inline кнопки)
    if (update.callback_query) {
      const callback = update.callback_query;
      const chat_id = callback.message.chat.id;
      const data = callback.data;
      
      const forceReply = chat_id == callback.from.id ? { force_reply: true } : {};
      
      if (data === "author") {
        await sendMessage("Введите фамилию/отчество автора в ответе на это сообщение", chat_id, forceReply);
      } else if (data === "title") {
        await sendMessage("Введите название песни в ответе на это сообщение", chat_id, forceReply);
      } else if (data === "line") {
        await sendMessage("Введите пару слов из песни в ответе на это сообщение", chat_id, forceReply);
      } else if (data.includes("requestSong_")) {
        const tableNumber = parseInt(data.replace("requestSong_", ""));
        await sendSong(new Song(chords[tableNumber], tableNumber), chat_id);
      } else if (data.includes("requestStrumming_")) {
        const tableNumber = parseInt(data.replace("requestStrumming_", ""));
        await sendStrummingPattern(new StrummingPattern(strumming[tableNumber], tableNumber), chat_id);
      }
    } 
    // Обработка обычных сообщений
    else if (update.message && !update.message.reply_to_message) {
      const chat_id = update.message.chat.id;
      const text = update.message.text;
      
      // Обработка медиа файлов
      if (update.message.text === undefined && chat_id === update.message.from.id) {
        if (update.message.photo) {
          const fileId = update.message.photo[update.message.photo.length - 1].file_id;
          await sendMessage("Я оцениваю это фото в: " + String(fileId), chat_id);
        } else if (update.message.voice) {
          const fileId = update.message.voice.file_id;
          await sendMessage("Я оцениваю это голосовое сообщение в: " + String(fileId), chat_id);
        } else if (update.message.video) {
          const fileId = update.message.video.file_id;
          await sendMessage("Я оцениваю это видео в: " + String(fileId), chat_id);
        }
      } 
      // Обработка команд
      else if (text && text.charAt(0) === "/") {
        const commandText = text.replace(botTelegram, "").split(' ')[0];
        
        if (commandText in commands) {
          await commands[commandText](chat_id, update);
        }
      } 
      // Обработка обычных сообщений
      else if (text && chat_id === update.message.from.id) {
        let swearFound = false;
        
        // Проверка на ругательства
        for (let i = 0; i < swears.length; i++) {
          const swear = swears[i].getRow(0).getText();
          const loweredText = text.toLowerCase();
          
          if (findWord(swear, loweredText)) {
            swearFound = true;
            break;
          }
        }
        
        if (!swearFound) {
          await sendRandomResponse(chat_id);
        } else {
          await sendMessage("Хэй, поаккуратнее со словами :(", chat_id);
        }
      }
    } 
    // Обработка ответов на сообщения бота
    else if (update.message && update.message.reply_to_message) {
      const chat_id = update.message.chat.id;
      const repliedMessage = update.message.reply_to_message;
      
      if ((repliedMessage.from.id == botId) && (repliedMessage.text.indexOf("Введите") === 0)) {
        let result = null;
        
        if (repliedMessage.text === "Введите фамилию/отчество автора в ответе на это сообщение") {
          await sendMessage("Ищу по автору...", chat_id);
          result = findChordsByAuthor(update.message.text);
        } else if (repliedMessage.text === "Введите название песни в ответе на это сообщение") {
          await sendMessage("Ищу по названию...", chat_id);
          result = findChordsByTitle(update.message.text);
        } else if (repliedMessage.text === "Введите пару слов из песни в ответе на это сообщение") {
          await sendMessage("Ищу по строчке...", chat_id);
          result = findChordsByLine(update.message.text);
        }
        
        if (result !== null) {
          if (result.length > 1) {
            const keyboard = {
              inline_keyboard: [],
              resize_keyboard: true
            };
            
            for (let i = 0; i < result.length; i++) {
              let row = [{
                text: result[i].title.replace(/(\r\n|\n|\r|Название: )/gm, ""),
                callback_data: "requestSong_" + String(result[i].tableNumber)
              }];
              
              keyboard.inline_keyboard.push(row);
            }
            
            await sendMessage("Я нашёл несколько песен. Какая конкретно вам нужна?", chat_id, keyboard);
          } else {
            await sendSong(result[0], chat_id);
          }
        } else {
          await sendMessage("Ничего не найдено :(\n<b>Не отчаивайтесь!</b> Чем короче ваше сообщение, тем больше вероятность успешного поиска. Попробуйте написать одно слово или его часть. Регистр, пунктуация, различия между «е» и «ё» не учитываются", chat_id);
        }
      } else if (chat_id === update.message.from.id) {
        await sendRandomResponse(chat_id);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error handling webhook:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}; 