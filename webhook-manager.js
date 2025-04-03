/**
 * Telegram Bot Webhook Manager
 * Скрипт для управления webhook'ами Telegram бота
 */
require('dotenv').config();
const fetch = require('node-fetch');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://gosha-bot.vercel.app/api/webhook';

if (!BOT_TOKEN) {
  console.error('Ошибка: Переменная окружения BOT_TOKEN не установлена');
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Функция выполнения запросов к API Telegram
async function makeRequest(method, params = {}) {
  const url = new URL(`${TELEGRAM_API}/${method}`);
  
  // Добавляем параметры в URL
  Object.keys(params).forEach(key => {
    url.searchParams.append(key, params[key]);
  });
  
  try {
    const response = await fetch(url.toString());
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Ошибка при выполнении запроса ${method}:`, error);
    throw error;
  }
}

// Команды
const commands = {
  // Установка webhook
  async setWebhook(url = WEBHOOK_URL) {
    console.log(`Устанавливаем webhook на URL: ${url}`);
    const result = await makeRequest('setWebhook', { url });
    console.log('Результат установки webhook:', result);
    return result;
  },
  
  // Получение информации о webhook
  async getWebhookInfo() {
    console.log('Получаем информацию о webhook...');
    const result = await makeRequest('getWebhookInfo');
    console.log('Информация о webhook:', result);
    return result;
  },
  
  // Удаление webhook
  async deleteWebhook() {
    console.log('Удаляем webhook...');
    const result = await makeRequest('deleteWebhook');
    console.log('Результат удаления webhook:', result);
    return result;
  }
};

// Справка по использованию
function showHelp() {
  console.log(`
Использование: node webhook-manager.js [команда]

Доступные команды:
  set [url]        - Установить webhook (по умолчанию: ${WEBHOOK_URL})
  get              - Получить информацию о текущем webhook
  delete           - Удалить webhook
  help             - Показать эту справку
  
Примеры:
  node webhook-manager.js set
  node webhook-manager.js set https://example.com/webhook
  node webhook-manager.js get
  node webhook-manager.js delete
  `);
}

// Обработка аргументов командной строки
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command || command === 'help') {
    return showHelp();
  }
  
  switch (command) {
    case 'set':
      await commands.setWebhook(args[1]);
      break;
    case 'get':
      await commands.getWebhookInfo();
      break;
    case 'delete':
      await commands.deleteWebhook();
      break;
    default:
      console.error(`Неизвестная команда: ${command}`);
      showHelp();
  }
}

// Запуск скрипта
main().catch(error => {
  console.error('Произошла ошибка:', error);
  process.exit(1);
});
