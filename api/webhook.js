// Vercel serverless function for Telegram Bot
const axios = require('axios');

// Bot configuration
const apiToken = "6250412206:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs";
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
      return sendMessage(chatId, 'Привет! Я бот Гоша. Для получения списка команд, напишите /help');
    case '/help':
      return sendMessage(chatId, `
Список доступных команд:
/start - начать общение с ботом
/help - показать это сообщение
/ping_gosha - проверить, что бот работает

Пока что бот работает в тестовом режиме на Vercel. Скоро будут добавлены все функции.`);
    case '/ping_gosha':
      return sendMessage(chatId, 'Гоша на связи! 🎸');
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
        await sendMessage(chatId, 'Скоро я смогу обрабатывать обычные сообщения. Пока используйте команды: /help');
      }
    }

    // Return success
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error handling update:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}; 