//Код написан для бота в телеграмме @Gosha63, автор кода @Hleb66613
var authorTelegram = "@Hleb66613";
var botTelegram = "@Gosha63_bot";
var apiToken = "6250412206:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs";
var appUrl = "https://script.google.com/macros/s/AKfycbzicvUuhs7cTa5b4yuRHUk-79vVQEOgCwW5-NuMnNH-8itMilBqe4dwfvFWK2QGze9I/exec";
var apiUrl = "https://api.telegram.org/bot" + apiToken;
var botId = "6250412206";

//Google documents files
var anecdotesId = "1wVDqRY52l6Xl5kNLep6Mczuaj1H2lzAHiCkEJJ6JVaE";
var swearsId = "1PkW-_MfxaMdGEXIqvnxQYXjEcoh4s8kqL6utz5YqgiU"; //Реакция на выражения. Да, он так умеет
var responsesId = "1zVAdnZiIQ7OpOG8VxGNtDqkXXl6WtFZXstLM-cDKnLc"; //Список реплик, которые бот кидает в случае, если пользователь написал обычное сообщение. "Как дела?", например
var chordsId = "1f5xANb0obtRD2Ta0Dx0r36CteK60_UNb7hJ1nQe-AVw"; //Аккордник с таблицами для Гоши
var strummingId = "1rdT0aAM3K99Hnhw02uhXDiESA8ZD_fHrVk0gq86wa50";
var chordsListUrl = "https://docs.google.com/document/d/1e7t6SXSQKO9DMIMehiY_8NwHcQQQ1OVv"; //Обычный аккордник для людей

var circleRulesPhotoFileId = "AgACAgIAAxkBAAIRT2SDVgm3Y-Z7Vn3dWSyxUN5aMdPxAAL4yTEbFPIYSL1ak6-yr6pZAQADAgADeQADLwQ"

//Класс создан исключительно для удобства вывода песни пользователю. Если коду нужны авторы, то код использует table.getRow(3).getText(); Если будете менять значения строк в таблицах, то не забудьте откорректировать соответствующим образом методы поиска песен (methods for finding chords in chords list)
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

var commands = {
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
  "/ping_gosha" : commandPing,
  "/talk" : commandTalk
};

//generic methods
function getUpdates() {
  var res = UrlFetchApp.fetch(apiUrl + "/getUpdates").getContentText();
  var res = JSON.parse(res);
  Logger.log(res);
}

function getMe() {
  var url = apiUrl + "/getMe";
  var response = UrlFetchApp.fetch(url);
  Logger.log(response.getContentText());
}

//webhook handlers
function setWebhook() {
  var url = apiUrl + "/setWebhook?url=" + appUrl;
  var res = UrlFetchApp.fetch(url);
  Logger.log(res);
}

function deleteWebhook() {
  var res = UrlFetchApp.fetch(apiUrl + "/deleteWebhook");
  Logger.log(res);
}

function doPost(e) {
  var contents = JSON.parse(e.postData.contents);

  if (contents.callback_query) {
    var callback = contents.callback_query;
    var id_callback = callback.message.chat.id;
    var data = callback.data;
    var forceReply = id_callback == callback.from.id ? { force_reply: true } : {};
    if (data == "author") {
      sendMessage("Введите фамилию/отчество автора в ответе на это сообщение", id_callback, forceReply);
    } else if (data == "title") {
      sendMessage("Введите название песни в ответе на это сообщение", id_callback, forceReply);
    } else if (data == "line") {
      sendMessage("Введите пару слов из песни в ответе на это сообщение", id_callback, forceReply);
    } else if (data.includes("requestSong_")) {
      var tableNumber = data.replace("requestSong_", "");
      var table = DocumentApp.openById(chordsId).getBody().getTables()[Number(tableNumber)];
      sendSong(new Song(table), id_callback);
    } else if (data.includes("requestStrumming_")) {
      var tableNumber = data.replace("requestStrumming_", "");
      var table = DocumentApp.openById(strummingId).getBody().getTables()[Number(tableNumber)];
      sendStrummingPattern(new StrummingPattern(table), id_callback);
    }
  } else if (!contents.message.reply_to_message) {
    var id = contents.message.chat.id;
    var text = contents.message.text;
    
    if (!contents.message.text && id == contents.message.from.id) {
      if (contents.message.photo) {
        var file_id = contents.message.photo[contents.message.photo.length - 1].file_id;
        sendMessage("Я оцениваю это фото в: " + String(file_id), id);
      } else if (contents.message.voice) {
        var file_id = contents.message.voice.file_id;
        sendMessage("Я оцениваю это голосовое сообщение в: " + String(file_id), id);
      } else if (contents.message.video) {
        var file_id = contents.message.video.file_id;
        sendMessage("Я оцениваю это видео в: " + String(file_id), id);
      }
    } else if (text.charAt(0) == "/") {
      text = text.replace(botTelegram, "");
      if (text in commands) {
        commands[text](id, e);
      }
    } else if (id == contents.message.from.id) {
      var swearTables = DocumentApp.openById(swearsId).getBody().getTables()
      let swearFound = false
      for ([k, v] of Object.entries(swearTables)) {
        var swear = v.getRow(0).getText();
        var loweredText = text.toLowerCase();
        if (findWord(swear, loweredText)) {
          swearFound = true;
          break;
        }
      }
      if (!swearFound) {
        sendRandomResponse(id);
      } else {
        sendMessage("Хэй, поаккуратнее со словами :(", id);
      }
    }
  } else {
    var id = contents.message.chat.id;
    var repliedMessage = contents.message.reply_to_message;
    if ((repliedMessage.from.id == botId) && (repliedMessage.text.indexOf("Введите") == 0)) {
      if (repliedMessage.text == "Введите фамилию/отчество автора в ответе на это сообщение") {
        sendMessage("Ищу по автору...", id);
        var result = findChordsByAuthor(contents.message.text, id);
      } else if (repliedMessage.text == "Введите название песни в ответе на это сообщение") {
        sendMessage("Ищу по названию...", id);
        var result = findChordsByTitle(contents.message.text, id);
      } else if (repliedMessage.text == "Введите пару слов из песни в ответе на это сообщение") {
        sendMessage("Ищу по строчке...", id);
        var result = findChordsByLine(contents.message.text, id);
      }
      if (result != null) {
        if (result.length > 1) {
          var keyboard = {
            inline_keyboard: [],
            resize_keyboard: true
          }
          for ([k, v] of Object.entries(result)) {
            let row = [{
              text: v.title.replace(/(\r\n|\n|\r|Название: )/gm, ""),
              callback_data: "requestSong_" + String(v.tableNumber)
            }];
            keyboard.inline_keyboard.push(row);
          }
          sendMessage("Я нашёл несколько песен. Какая конкретно вам нужна?", id, keyboard);
        } else {
          sendSong(result[0], id);
        }
      } else {
        sendMessage("Ничего не найдено :(\n<b>Не отчаивайтесь!</b> Чем короче ваше сообщение, тем больше вероятность успешного поиска. Попробуйте написать одно слово или его часть. Регистр, пунктуация, различия между «е» и «ё» не учитываются", id);
      }
    } else if (id == contents.message.from.id) {
      sendRandomResponse(id);
    }
  }
}

function doGet(e) {
  return ContentService.createTextOutput("Screw off");
}

function findWord(word, str) {
  return str.split(' ').some(function(w){return w === word}) //regexp doesn't work on russian characters. Too bad!
}


function normalizeString(str) {
  str = str.toLowerCase();
  str = str.replace(/\.|,|:|;|!|\?|"|/gm, "");
  str = str.replace(/ë|ё/gm, "е"); //these are two different characters!
  return str;
}

//methods for finding chords in chords list
function findChordsByAuthor(author) {
  var foundSongs = []
  author = normalizeString(author);
  var tables = DocumentApp.openById(chordsId).getBody().getTables();
  for ([k, v] of Object.entries(tables)) {
    let authors = v.getRow(3).getText();
    authors = normalizeString(authors);
    if (authors.includes(author)) {
      var index = tables.findIndex(function (sng) {
        return sng.getRow(8).getText() == v.getRow(8).getText();
      })
      song = new Song(v, index);
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
  var foundSongs = [];
  title = normalizeString(title);
  var tables = DocumentApp.openById(chordsId).getBody().getTables();
  for ([k, v] of Object.entries(tables)) {
    let titles = v.getRow(0).getText();
    titles = normalizeString(titles);
    if (titles.includes(title)) {
      var index = tables.findIndex(function (sng) {
        return sng.getRow(8).getText() == v.getRow(8).getText();
      })
      song = new Song(v, index);
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
  var foundSongs = []
  line = normalizeString(line);
  var tables = DocumentApp.openById(chordsId).getBody().getTables();
  for ([k, v] of Object.entries(tables)) {
    let lines = v.getRow(8).getText();
    lines = normalizeString(lines);
    if (lines.includes(line)) {
      var index = tables.findIndex(function (sng) {
        return sng.getRow(8).getText() == v.getRow(8).getText();
      })
      song = new Song(v, index);
      foundSongs.push(song);
    }
  }
  if (foundSongs.length > 0) {
    return foundSongs;
  } else {
    return null;
  }
}

//send methods

//Метод посылает пользователю аккорды и принимает на вход класс Song
/**
 * @param {Song} song Object class Song
 * @param {chat_id} chat_id What chat_id to send to
 */
function sendSong(song, chat_id) {
  var textMessage = song.title + song.authors + song.rhytm + song.features + song.group;
  sendMessage(textMessage, chat_id);
  if (song.voice != "") {
    sendVoice(song.voice, chat_id);
  }
  if (song.telegramVideo != "") {
    sendVideo(song.telegramVideo, chat_id);
  }
  if (song.webVideo != "") {
    sendMessage(song.webVideo, chat_id);
  }
  sendMessage(song.chords, chat_id);
}

/**
 * @param {StrummingPattern} pattern Object class StrummingPatters
 * @param {chat_id} chat_id What chat_id to send to
 */
function sendStrummingPattern(pattern, chat_id) {
  var textMessage = pattern.title + pattern.features;
  sendMessage(textMessage, chat_id);
  if (pattern.photo != "") {
    sendPhoto(pattern.photo, chat_id);
  }
  if (pattern.voice != "") {
    sendVoice(pattern.voice, chat_id);
  }
  if (pattern.telegramVideo != "") {
    sendVideo(pattern.telegramVideo, chat_id);
  }
  if (pattern.webVideo != "") {
    sendMessage(pattern.webVideo, chat_id);
  }
}

function sendRandomResponse(chat_id) {
  var table = getRandomTableInGoogleDocument(responsesId);
  var txt = table.getRow(0).getText();
  sendMessage(txt, chat_id);
}

function sendMessage(text, chat_id, keyBoard) {

  keyBoard = keyBoard || 0;

  if (keyBoard) {
    var data = {
      method: "post",
      payload: {
        method: "sendMessage",
        chat_id: String(chat_id),
        text: text,
        parse_mode: "HTML",
        reply_markup: JSON.stringify(keyBoard)
      }
    }
  } else {
    var data = {
      method: "post",
      payload: {
        method: "sendMessage",
        chat_id: String(chat_id),
        text: text,
        parse_mode: "HTML"
      }
    }
  }

  UrlFetchApp.fetch(apiUrl + '/', data);
}

function sendPhoto(file_id, chat_id) {
  var data = {
    method: "post",
    payload: {
      method: "sendPhoto",
      chat_id: String(chat_id),
      photo: String(file_id)
    }
  }

  UrlFetchApp.fetch(apiUrl + "/", data);
}

function sendVoice(file_id, chat_id) {
  var data = {
    method: "post",
    payload: {
      method: "sendVoice",
      chat_id: String(chat_id),
      voice: String(file_id)
    }
  }

  UrlFetchApp.fetch(apiUrl + "/", data);
}

function sendVideo(file_id, chat_id) {
  var data = {
    method: "post",
    payload: {
      method: "sendVideo",
      chat_id: String(chat_id),
      video: String(file_id)
    }
  }

  UrlFetchApp.fetch(apiUrl + "/", data);
}

//random
function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function getRandomTableInGoogleDocument(googleDocumentId) {
  var tables = DocumentApp.openById(googleDocumentId).getBody().getTables();
  var random = randomInRange(1, tables.length) - 1;
  var randomTable = tables[random];
  return randomTable;
}

//user commands
function commandStart(receiver) {
  sendMessage("Ну привет", receiver);
}

function commandChords(receiver) {
  var keyboard = {
    inline_keyboard: [
      [{
        text: "по автору",
        callback_data: "author"
      },
      {
        text: "по названию",
        callback_data: "title"
      }
      ],
      [{
        text: "по тексту",
        callback_data: "line" //изначально тут было "по строчке"
      }]
    ],
    resize_keyboard: true,
    remove_keyboard: true
  }
  sendMessage("Как именно мне стоит искать песню?", receiver, keyboard);
}

function commandAnecdote(receiver) {
  var table = getRandomTableInGoogleDocument(anecdotesId);
  var anec = table.getRow(0).getText();
  sendMessage(anec, receiver);
}

function commandHelp(receiver) {
  sendMessage("<b>Команды:</b>\n/list - скинуть аккордник со всеми песнями\n/chords - найти аккорды к песне по автору, названию или знакомой вам строчке. Если я найду больше, чем 1 (одну) песню, то предложу вам выбрать нужную\n/strumming - показать, как играется выбранный бой или перебор\n/circlerules - скинуть красивую фотографию с правилами орлятского круга\n/anecdote - рассказать анекдот, который может поднять вам настроение\n/talk - сказать что-нибудь\n/status - получить информацию о том, насколько я умный\n/help - помощь. Команда, которую вы только что использовали\n/ping_gosha - техническая команда, которая выведет id чата и JSON вашего сообщения\n/source - инструкции по получению исходного кода\n\n<b>Хотите добавить свой анекдот/реплику? Нашли ошибку или просто есть что сказать? Пишите </b>" + authorTelegram, receiver);
}

function commandCancel(receiver) {
  var keyboard = {
    remove_keyboard: true
  }
  sendMessage("Отмена операции. Вжух-вжух", receiver, keyboard);
}

function commandSource(receiver) {
  sendMessage("Пишите " + authorTelegram + "\nЯ написан на Google Script (aka javascript)", receiver);
}

function commandList(receiver) {
  sendMessage(chordsListUrl, receiver);
}

function commandStatus(receiver) {
  var songsNumber = String(DocumentApp.openById(chordsId).getBody().getTables().length);
  var anecdotesNumber = String(DocumentApp.openById(anecdotesId).getBody().getTables().length);
  var responsesNumber = String(DocumentApp.openById(responsesId).getBody().getTables().length);
  var strummingNumber = String(DocumentApp.openById(strummingId).getBody().getTables().length);
  sendMessage("На данный момент я знаю:\n<b>Песен: </b>" + songsNumber + "\n<b>Анекдотов: </b>" + anecdotesNumber + "\n<b>Реплик: </b>" + responsesNumber + "\n<b>Боёв/переборов: </b>" + strummingNumber, receiver);
}

function commandStrumming(receiver) {
  var tables = DocumentApp.openById(strummingId).getBody().getTables();
  var keyboard = {
    inline_keyboard: [],
    resize_keyboard: true
  }
  var i = 0
  for ([k, v] of Object.entries(tables)) {
    let row = [{
      text: v.getRow(0).getText().replace(/(\r\n|\n|\r)/gm, ""),
      callback_data: "requestStrumming_" + String(i)
    }];
    keyboard.inline_keyboard.push(row);
    i = i + 1;
  }
  sendMessage("Какой именно бой/перебор вас интересует?", receiver, keyboard);
}

function commandCircleRules(receiver) {
  sendPhoto(circleRulesPhotoFileId, receiver);
}

function commandPing(receiver, e) {
  sendMessage("Pong!\n" + receiver, receiver);
  sendMessage(e.postData.contents, receiver);
}

function commandTalk(receiver) {
  sendRandomResponse(receiver);
}