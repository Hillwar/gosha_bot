const axios = require('axios');
const config = require('../config');

// Сервис для работы с Telegram API
class TelegramService {
  constructor() {
    this.baseUrl = `https://api.telegram.org/bot${config.BOT_TOKEN}`;
  }

  // Отправка текстового сообщения
  async sendMessage(chatId, text, options = {}) {
    try {
      const response = await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: chatId,
        text: text,
        parse_mode: options.parse_mode || config.DEFAULT_PARSE_MODE,
        ...options
      });
      return response.data;
    } catch (error) {
      console.error('Error sending message:', error.response?.data || error.message);
      throw error;
    }
  }

  // Отправка фото с подписью
  async sendPhoto(chatId, photoUrl, caption = '', options = {}) {
    try {
      console.log('Sending photo with URL:', photoUrl);
      const response = await axios.post(`${this.baseUrl}/sendPhoto`, {
        chat_id: chatId,
        photo: photoUrl,
        caption: caption,
        parse_mode: options.parse_mode || config.DEFAULT_PARSE_MODE,
        ...options
      });
      console.log('Photo sent successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error sending photo:', error.response?.data || error.message);
      throw error;
    }
  }

  // Ответ на callback query
  async answerCallbackQuery(callbackQueryId) {
    try {
      await axios.post(`${this.baseUrl}/answerCallbackQuery`, {
        callback_query_id: callbackQueryId
      });
    } catch (error) {
      console.error('Error answering callback query:', error);
      throw error;
    }
  }
}

module.exports = new TelegramService(); 