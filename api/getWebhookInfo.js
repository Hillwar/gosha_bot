const axios = require('axios');
const config = require('./config');

// Функция для получения информации о вебхуке
module.exports = async (req, res) => {
  try {
    // Запрашиваем информацию о вебхуке
    const response = await axios.get(`https://api.telegram.org/bot${config.BOT_TOKEN}/getWebhookInfo`);
    
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