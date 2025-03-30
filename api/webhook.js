// Vercel serverless function for Telegram Bot
const axios = require('axios');

// Bot configuration
const apiToken = "7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs";
const apiUrl = `https://api.telegram.org/bot${apiToken}`;

// Function to send message to Telegram
const sendMessage = async (chatId, text, keyboard = null) => {
  try {
    const data = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    };

    if (keyboard) {
      data.reply_markup = JSON.stringify(keyboard);
    }

    const response = await axios.post(`${apiUrl}/sendMessage`, data);
    return response.data;
  } catch (error) {
    console.error('Error sending message:', error);
    return { ok: false, error: error.message };
  }
};

// Simple response handler
const handleCommand = async (command, chatId) => {
  switch (command) {
    case '/start':
      return sendMessage(chatId, 'Привет! Я бот Гоша демо. Для получения списка команд, напишите /help');
    case '/help':
      return sendMessage(chatId, `
Список доступных команд:
/start - начать общение с ботом
/help - показать это сообщение
/ping_gosha - проверить, что бот работает
/about - информация о боте
/menu - показать меню с кнопками

Пока что бот работает в тестовом режиме на Vercel. Скоро будут добавлены все функции.`);
    case '/ping_gosha':
      return sendMessage(chatId, 'Гоша демо на связи! 🎸');
    case '/about':
      return sendMessage(chatId, 'Гоша Демо - это тестовая версия бота для Telegram, размещенная на Vercel. Бот создан на основе оригинального кода автора @Hleb66613.');
    case '/menu':
      const keyboard = {
        inline_keyboard: [
          [
            { text: "Песни", callback_data: "songs" },
            { text: "Анекдоты", callback_data: "jokes" }
          ],
          [
            { text: "О боте", callback_data: "about" }
          ]
        ]
      };
      return sendMessage(chatId, 'Выберите опцию:', keyboard);
    default:
      return sendMessage(chatId, 'Неизвестная команда. Используйте /help для списка команд.');
  }
};

// Handler for incoming updates
module.exports = async (req, res) => {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Telegram bot webhook is active' });
  }

  try {
    const update = req.body;
    console.log('Received update:', JSON.stringify(update));
    
    // Process message
    if (update && update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || '';
      
      // Handle commands
      if (text.startsWith('/')) {
        const command = text.split('@')[0]; // Remove bot username from command
        await handleCommand(command, chatId);
      } else {
        // Handle regular messages
        await sendMessage(chatId, 'Привет! Я пока что умею отвечать только на команды. Используйте /help для списка доступных команд.');
      }
    } else if (update && update.callback_query) {
      // Handle callback queries (button clicks)
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;
      
      switch (data) {
        case 'songs':
          await sendMessage(chatId, 'Функция с песнями будет доступна в следующих обновлениях!');
          break;
        case 'jokes':
          await sendMessage(chatId, 'Функция с анекдотами будет доступна в следующих обновлениях!');
          break;
        case 'about':
          await sendMessage(chatId, 'Гоша Демо - это тестовая версия бота для Telegram, размещенная на Vercel. Бот создан на основе оригинального кода автора @Hleb66613.');
          break;
        default:
          await sendMessage(chatId, `Получен запрос: ${data}. Эта функциональность еще не реализована.`);
      }
    }

    // Return success
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error handling update:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}; 