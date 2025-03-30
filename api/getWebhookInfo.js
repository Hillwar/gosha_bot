const axios = require('axios');

// Токен бота
const BOT_TOKEN = '7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs';

// Функция для получения информации о вебхуке
module.exports = async (req, res) => {
  try {
    // Запрашиваем информацию о вебхуке
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    
    // Возвращаем ответ
    res.status(200).json({
      success: true,
      result: response.data
    });
  } catch (error) {
    // В случае ошибки
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}; 