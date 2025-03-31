const axios = require('axios');
const config = require('./config');

// Функция для установки вебхука
module.exports = async (req, res) => {
  try {
    // Устанавливаем вебхук
    const response = await axios.get(`https://api.telegram.org/bot${config.BOT_TOKEN}/setWebhook?url=${config.WEBHOOK_URL}`);
    
    // Возвращаем ответ
    res.status(200).json({
      success: true,
      result: response.data,
      message: `Webhook set to ${config.WEBHOOK_URL}`
    });
  } catch (error) {
    // В случае ошибки
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}; 