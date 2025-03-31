const telegramService = require('../services/telegram');
const songService = require('../services/songService');
const config = require('../config');
const rules = require('../data/rules');

// Обработчик команд бота
class CommandHandler {
  // Обработка команд
  async handleCommand(message) {
    const chatId = message.chat.id;
    const text = message.text;
    
    console.log(`Handling command: ${text} from chat ${chatId}`);
    
    const [command, ...args] = text.split(' ');
    const query = args.join(' ');
    
    switch(command) {
      case '/start':
        await this.handleStart(chatId);
        break;
        
      case '/help':
        await this.handleHelp(chatId);
        break;
        
      case '/chords':
        await this.handleChords(chatId, query);
        break;
        
      case '/circlerules':
        await this.handleCircleRules(chatId);
        break;
        
      case '/rules_text':
        await this.handleRulesText(chatId);
        break;
        
      case '/status':
        await this.handleStatus(chatId);
        break;
        
      case '/list':
        await this.handleList(chatId);
        break;
        
      case '/random':
        await this.handleRandom(chatId);
        break;
    }
  }

  // Обработчики отдельных команд
  async handleStart(chatId) {
    await telegramService.sendMessage(chatId, `Привет! Я Гоша, бот-помощник с аккордами и песнями. 
    
Используй команду /help, чтобы узнать, что я умею.`);
  }

  async handleHelp(chatId) {
    await telegramService.sendMessage(chatId, `<b>Доступные команды:</b>

/chords [запрос] - поиск песни в аккорднике
/list - список всех песен
/circlerules - правила орлятского круга
/status - статистика запросов песен
/random - получить случайную песню, которую давно не пели

Чтобы найти песню, используйте команду /chords и часть названия или автора, например:
/chords атланты
/chords визбор
/chords перевал`);
  }

  async handleChords(chatId, query) {
    if (!query) {
      await telegramService.sendMessage(chatId, "Пожалуйста, укажите название песни или автора после команды /chords");
      return;
    }
    
    const songs = songService.findSongs(query);
    
    if (songs.length === 0) {
      await telegramService.sendMessage(chatId, `По запросу "${query}" ничего не найдено. Попробуйте другой запрос или используйте команду /list для списка всех песен.`);
      return;
    }
    
    if (songs.length === 1) {
      songService.updateStats(songs[0].title);
      await telegramService.sendMessage(chatId, songService.formatSong(songs[0]));
    } else if (songs.length <= config.MAX_SEARCH_RESULTS) {
      let songButtons = songs.map(song => [{
        text: song.title + (song.author ? ` (${song.author})` : ''),
        callback_data: `song:${song.title}`
      }]);
      
      await telegramService.sendMessage(chatId, `Найдено ${songs.length} песен по запросу "${query}". Выберите песню:`, {
        reply_markup: JSON.stringify({
          inline_keyboard: songButtons
        })
      });
    } else {
      await telegramService.sendMessage(chatId, `Найдено слишком много песен (${songs.length}). Пожалуйста, уточните запрос.`);
    }
  }

  async handleCircleRules(chatId) {
    try {
      await telegramService.sendPhoto(chatId, config.CIRCLE_RULES_IMAGE, rules);
    } catch (error) {
      console.error('Error in /circlerules command:', error);
      await telegramService.sendMessage(chatId, rules);
    }
  }

  async handleRulesText(chatId) {
    await telegramService.sendMessage(chatId, rules);
  }

  async handleStatus(chatId) {
    await telegramService.sendMessage(chatId, songService.getStats());
  }

  async handleList(chatId) {
    await telegramService.sendMessage(chatId, songService.getSongsList());
  }

  async handleRandom(chatId) {
    const randomSong = songService.getRandomSong();
    await telegramService.sendMessage(chatId, `Вот песня, которую давно не пели:\n\n${songService.formatSong(randomSong)}`);
  }

  // Обработка callback-запросов
  async handleCallback(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    if (data.startsWith('song:')) {
      const songTitle = data.substring(5);
      const song = songService.findSongs(songTitle)[0];
      
      if (song) {
        songService.updateStats(song.title);
        await telegramService.sendMessage(chatId, songService.formatSong(song));
      } else {
        await telegramService.sendMessage(chatId, `Песня "${songTitle}" не найдена.`);
      }
    }
    
    await telegramService.answerCallbackQuery(callbackQuery.id);
  }

  // Обработка обычных сообщений
  async handleMessage(message) {
    const chatId = message.chat.id;
    
    if (message.photo) {
      await telegramService.sendMessage(chatId, "Спасибо за фото! Если хотите найти аккорды к песне, воспользуйтесь командой /chords [название песни]");
    } else if (message.voice) {
      await telegramService.sendMessage(chatId, "Вместо голосового лучше спойте песню вживую! Используйте /random, чтобы получить случайную песню");
    } else if (message.video) {
      await telegramService.sendMessage(chatId, "Интересное видео! Если вам нужны правила орлятского круга, используйте команду /circlerules");
    } else if (message.audio || message.document) {
      await telegramService.sendMessage(chatId, "Спасибо за файл! Если вам нужна конкретная песня, воспользуйтесь поиском через /chords [название песни]");
    } else if (message.text) {
      const songs = songService.findSongs(message.text);
      
      if (songs.length === 1) {
        songService.updateStats(songs[0].title);
        await telegramService.sendMessage(chatId, songService.formatSong(songs[0]));
      } else if (songs.length > 1 && songs.length <= config.MAX_SEARCH_RESULTS) {
        let songButtons = songs.map(song => [{
          text: song.title + (song.author ? ` (${song.author})` : ''),
          callback_data: `song:${song.title}`
        }]);
        
        await telegramService.sendMessage(chatId, `Нашел ${songs.length} песен по запросу "${message.text}". Выберите песню:`, {
          reply_markup: JSON.stringify({
            inline_keyboard: songButtons
          })
        });
      } else {
        const responses = [
          "Я не совсем понял, что вы имеете в виду. Используйте /help, чтобы увидеть список команд.",
          "Для поиска песни используйте команду /chords и часть названия или автора.",
          "Хотите получить случайную песню? Используйте /random!",
          "Если вам нужны правила орлятского круга, введите /circlerules",
          "Чтобы увидеть список всех песен, введите /list"
        ];
        
        const randomResponse = responses[Math.floor(Math.random() * responses.length)];
        await telegramService.sendMessage(chatId, randomResponse);
      }
    }
  }
}

module.exports = new CommandHandler(); 