const telegramService = require('../services/telegram');
const songService = require('../services/songService');
const config = require('../config');
const rules = require('../data/rules');

// Обработчик команд бота
class CommandHandler {
  constructor() {
    this.commands = {
      '/start': this.handleStart.bind(this),
      '/help': this.handleHelp.bind(this),
      '/chords': this.handleChords.bind(this),
      '/circlerules': this.handleCircleRules.bind(this),
      '/rules_text': this.handleRulesText.bind(this),
      '/status': this.handleStatus.bind(this),
      '/list': this.handleList.bind(this),
      '/random': this.handleRandom.bind(this)
    };
  }

  // Обработка команд
  async handleCommand(message) {
    const chatId = message.chat.id;
    const [command, ...args] = message.text.split(' ');
    const query = args.join(' ');

    const handler = this.commands[command];
    if (handler) {
      await handler(chatId, query);
    } else {
      await this.handleUnknownCommand(chatId);
    }
  }

  // Обработчики отдельных команд
  async handleStart(chatId) {
    await telegramService.sendMessage(chatId, 
      'Привет! Я помогу найти песни в сборнике. Используй /help для списка команд.'
    );
  }

  async handleHelp(chatId) {
    await telegramService.sendMessage(chatId, 
      `<b>Доступные команды:</b>

/chords - поиск песни (по названию или тексту)
/list - список всех песен
/random - случайная песня

Примеры использования:
/chords - начать поиск песни
/chords атланты - искать "атланты" в названиях и тексте`,
      { parse_mode: 'HTML' }
    );
  }

  async handleChords(chatId, query) {
    if (!query) {
      // Если нет запроса, предлагаем выбрать тип поиска
      await telegramService.sendMessage(chatId, 
        'Как будем искать песню?',
        {
          reply_markup: JSON.stringify({
            inline_keyboard: [
              [{ text: 'По названию', callback_data: 'search_type:title' }],
              [{ text: 'По тексту', callback_data: 'search_type:content' }]
            ]
          })
        }
      );
      return;
    }

    // Если есть запрос, ищем и в названиях, и в тексте
    try {
      const titleMatches = await songService.findSongsByTitle(query);
      const contentMatches = await songService.findSongsByContent(query);

      // Убираем дубликаты
      const allMatches = [...new Set([...titleMatches, ...contentMatches])];

      if (allMatches.length === 0) {
        await telegramService.sendMessage(
          chatId,
          `Песня "${query}" не найдена. Попробуйте изменить запрос или посмотреть /list всех песен.`
        );
        return;
      }

      if (allMatches.length === 1) {
        const formattedSong = songService.formatSong(allMatches[0]);
        await this.sendLongMessage(chatId, formattedSong);
      } else {
        let message = `Найдено ${allMatches.length} песен:\n\n`;
        allMatches.forEach((song, index) => {
          message += `${index + 1}. ${song.title}\n`;
        });
        message += '\nВыберите песню:';

        const keyboard = allMatches.map((song, index) => [{
          text: `${index + 1}. ${song.title}`,
          callback_data: `song:${index}`
        }]);

        await telegramService.sendMessage(chatId, message, {
          reply_markup: JSON.stringify({ inline_keyboard: keyboard })
        });
      }
    } catch (error) {
      console.error('Error handling chords command:', error);
      await telegramService.sendMessage(
        chatId,
        'Произошла ошибка при поиске песни. Пожалуйста, попробуйте позже.'
      );
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
    try {
      const list = await songService.getSongsList();
      await telegramService.sendMessage(chatId, list, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('Error getting songs list:', error);
      await telegramService.sendMessage(
        chatId,
        'Произошла ошибка при получении списка песен. Пожалуйста, попробуйте позже.'
      );
    }
  }

  async handleRandom(chatId) {
    try {
      const song = await songService.getRandomSong();
      const formattedSong = songService.formatSong(song);
      await this.sendLongMessage(chatId, formattedSong);
    } catch (error) {
      console.error('Error getting random song:', error);
      await telegramService.sendMessage(
        chatId,
        'Произошла ошибка при выборе случайной песни. Пожалуйста, попробуйте позже.'
      );
    }
  }

  // Обработка callback-запросов
  async handleCallback(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    try {
      if (data.startsWith('search_type:')) {
        const searchType = data.split(':')[1];
        await telegramService.sendMessage(
          chatId,
          `Введите ${searchType === 'title' ? 'название' : 'слова из текста'} песни:`
        );
      } else if (data.startsWith('song:')) {
        const index = parseInt(data.split(':')[1]);
        // Получаем сохраненные результаты поиска из сообщения
        const messageText = callbackQuery.message.text;
        const songs = await songService.getSongs();
        const songTitles = messageText.split('\n').slice(1, -2); // Пропускаем первую и последние две строки
        
        // Находим выбранную песню по заголовку
        const selectedTitle = songTitles[index]?.replace(/^\d+\.\s+/, '');
        const selectedSong = songs.find(song => song.title === selectedTitle);

        console.log('Selected song index:', index);
        console.log('Song titles:', songTitles);
        console.log('Selected title:', selectedTitle);
        console.log('Found song:', selectedSong?.title);

        if (selectedSong) {
          const formattedSong = songService.formatSong(selectedSong);
          await this.sendLongMessage(chatId, formattedSong);
        } else {
          await telegramService.sendMessage(
            chatId,
            'Извините, не удалось найти выбранную песню. Попробуйте повторить поиск.'
          );
        }
      }

      await telegramService.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
      console.error('Error handling callback:', error);
      await telegramService.sendMessage(
        chatId,
        'Произошла ошибка при обработке запроса. Пожалуйста, попробуйте позже.'
      );
    }
  }

  // Обработка обычных сообщений
  async handleMessage(message) {
    const chatId = message.chat.id;
    
    try {
      if (message.photo) {
        await telegramService.sendMessage(chatId, "Спасибо за фото! Если хотите найти аккорды к песне, воспользуйтесь командой /chords [название песни]");
      } else if (message.voice) {
        await telegramService.sendMessage(chatId, "Вместо голосового лучше спойте песню вживую! Используйте /random, чтобы получить случайную песню");
      } else if (message.video) {
        await telegramService.sendMessage(chatId, "Интересное видео! Если вам нужны правила орлятского круга, используйте команду /circlerules");
      } else if (message.audio || message.document) {
        await telegramService.sendMessage(chatId, "Спасибо за файл! Если вам нужна конкретная песня, воспользуйтесь поиском через /chords [название песни]");
      } else if (message.text) {
        // Ищем и в названиях, и в тексте
        const titleMatches = await songService.findSongsByTitle(message.text);
        const contentMatches = await songService.findSongsByContent(message.text);
        
        // Убираем дубликаты
        const allMatches = [...new Set([...titleMatches, ...contentMatches])];
        
        if (allMatches.length === 0) {
          await telegramService.sendMessage(
            chatId,
            'Ничего не найдено. Используйте /chords для поиска песни или /list для просмотра всех песен.'
          );
        } else if (allMatches.length === 1) {
          const formattedSong = songService.formatSong(allMatches[0]);
          await this.sendLongMessage(chatId, formattedSong);
        } else {
          let keyboard = allMatches.slice(0, config.MAX_SEARCH_RESULTS).map((song, index) => [{
            text: song.title,
            callback_data: `song:${index}`
          }]);
          
          await telegramService.sendMessage(
            chatId, 
            `Найдено ${allMatches.length} песен. Выберите песню:`,
            {
              reply_markup: JSON.stringify({
                inline_keyboard: keyboard
              })
            }
          );
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      await telegramService.sendMessage(chatId, "Произошла ошибка при обработке сообщения. Пожалуйста, попробуйте позже.");
    }
  }

  async handleUnknownCommand(chatId) {
    await telegramService.sendMessage(
      chatId,
      'Неизвестная команда. Используйте /help для списка команд.'
    );
  }

  async sendLongMessage(chatId, text) {
    const maxLength = 4000; // Оставляем запас для форматирования
    
    if (text.length <= maxLength) {
      await telegramService.sendMessage(chatId, text, { parse_mode: 'HTML' });
      return;
    }

    const parts = [];
    let currentPart = '';
    const lines = text.split('\n');

    for (const line of lines) {
      if (currentPart.length + line.length + 1 > maxLength) {
        parts.push(currentPart);
        currentPart = line;
      } else {
        currentPart += (currentPart ? '\n' : '') + line;
      }
    }

    if (currentPart) {
      parts.push(currentPart);
    }

    // Отправляем каждую часть
    for (let i = 0; i < parts.length; i++) {
      const isLastPart = i === parts.length - 1;
      let part = parts[i];
      
      if (isLastPart) {
        part += `\n\n<a href="${config.SONGBOOK_URL}">Открыть сборник</a>`;
      }
      
      await telegramService.sendMessage(chatId, part, { parse_mode: 'HTML' });
    }
  }
}

module.exports = new CommandHandler(); 