/**
 * Обработчик webhook для Telegram бота в Vercel
 */
import TelegramBot from 'node-telegram-bot-api';

// Инициализация бота
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

// Основной обработчик webhook
export default async function handler(req, res) {
  try {
    // Только POST запросы
    if (req.method !== 'POST') {
      return res.status(200).json({
        status: 'OK',
        message: 'Gosha Bot API is running',
        timestamp: new Date().toISOString(),
      });
    }

    // Проверяем, что есть данные от Telegram
    if (!req.body || (!req.body.message && !req.body.callback_query)) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'No Telegram update in request body'
      });
    }

    // Обрабатываем обновление
    await bot.processUpdate(req.body);
    console.log('Webhook update processed successfully');

    // Отправляем ответ Telegram
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing webhook:', error.message);
    return res.status(500).json({
      status: 'ERROR',
      message: 'Internal server error'
    });
  }
} 