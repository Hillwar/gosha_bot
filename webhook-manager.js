/**
 * Скрипт для управления webhook Telegram бота
 */
require('dotenv').config();
const fetch = require('node-fetch');

// Получаем токен бота из переменных окружения
const BOT_TOKEN = process.env.BOT_TOKEN;

// Базовый URL для API Telegram
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Получаем аргументы командной строки
const args = process.argv.slice(2);
const command = args[0] || 'status';
const webhookUrl = args[1];

// Функция для получения информации о текущем webhook
async function getWebhookInfo() {
  try {
    const response = await fetch(`${TELEGRAM_API}/getWebhookInfo`);
    const data = await response.json();
    
    if (data.ok) {
      console.log('Информация о вебхуке:');
      console.log(JSON.stringify(data.result, null, 2));
      
      if (data.result.url) {
        console.log('\nСтатус: Webhook установлен');
        console.log(`URL: ${data.result.url}`);
      } else {
        console.log('\nСтатус: Webhook не установлен');
      }
    } else {
      console.error('Ошибка при получении информации о вебхуке:', data.description);
    }
  } catch (error) {
    console.error('Ошибка при запросе к Telegram API:', error);
  }
}

// Функция для установки webhook
async function setWebhook(url) {
  if (!url) {
    console.error('Ошибка: URL не указан');
    console.log('Использование: node webhook-manager.js set https://ваш-домен.com/api/webhook');
    return;
  }
  
  try {
    const response = await fetch(`${TELEGRAM_API}/setWebhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        allowed_updates: ['message', 'callback_query']
      }),
    });
    
    const data = await response.json();
    
    if (data.ok) {
      console.log(`Webhook успешно установлен на ${url}`);
    } else {
      console.error('Ошибка при установке webhook:', data.description);
    }
  } catch (error) {
    console.error('Ошибка при запросе к Telegram API:', error);
  }
}

// Функция для удаления webhook
async function deleteWebhook() {
  try {
    const response = await fetch(`${TELEGRAM_API}/deleteWebhook`);
    const data = await response.json();
    
    if (data.ok) {
      console.log('Webhook успешно удален');
    } else {
      console.error('Ошибка при удалении webhook:', data.description);
    }
  } catch (error) {
    console.error('Ошибка при запросе к Telegram API:', error);
  }
}

// Отправка тестового сообщения для проверки работы бота
async function testBot() {
  // Здесь можно указать ID чата для отправки тестового сообщения
  console.log('Для проверки работы бота отправьте сообщение боту в Telegram.');
  console.log('Затем проверьте логи на сервере.');
}

// Запуск нужной функции в зависимости от команды
switch (command) {
  case 'set':
    setWebhook(webhookUrl);
    break;
  case 'delete':
    deleteWebhook();
    break;
  case 'test':
    testBot();
    break;
  case 'status':
  default:
    getWebhookInfo();
    break;
}
