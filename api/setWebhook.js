const axios = require('axios');

// Токен бота и URL вебхука
const BOT_TOKEN = '7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs';
const WEBHOOK_URL = 'https://gosha-bot.vercel.app/api/webhook';

// Функция для установки вебхука
module.exports = async (req, res) => {
  try {
    // Устанавливаем вебхук
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}`);
    
    // Возвращаем ответ
    res.status(200).json({
      success: true,
      result: response.data,
      message: `Webhook set to ${WEBHOOK_URL}`
    });
  } catch (error) {
    // В случае ошибки
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}; 