require('dotenv').config();
const fetch = require('node-fetch');
const readline = require('readline');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Telegram bot token from .env file
const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('Ошибка: BOT_TOKEN не найден в файле .env');
  process.exit(1);
}

// Base URL for Telegram API
const apiUrl = `https://api.telegram.org/bot${token}`;

// Function to get current webhook info
async function getWebhookInfo() {
  try {
    const response = await fetch(`${apiUrl}/getWebhookInfo`);
    const data = await response.json();
    
    if (data.ok) {
      console.log('\nТекущая информация о вебхуке:');
      console.log('URL:', data.result.url || 'Не установлен');
      console.log('Есть ожидающие обновления:', data.result.pending_update_count);
      console.log('Последняя ошибка:', data.result.last_error_message || 'Нет ошибок');
      console.log('Максимальное количество соединений:', data.result.max_connections);
      return data.result;
    } else {
      console.error('Ошибка при получении информации о вебхуке:', data.description);
      return null;
    }
  } catch (error) {
    console.error('Ошибка при запросе к API Telegram:', error.message);
    return null;
  }
}

// Function to set webhook
async function setWebhook(url) {
  try {
    const response = await fetch(`${apiUrl}/setWebhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url })
    });
    
    const data = await response.json();
    
    if (data.ok) {
      console.log(`\nВебхук успешно установлен на: ${url}`);
      return true;
    } else {
      console.error('Ошибка при установке вебхука:', data.description);
      return false;
    }
  } catch (error) {
    console.error('Ошибка при запросе к API Telegram:', error.message);
    return false;
  }
}

// Function to delete webhook
async function deleteWebhook() {
  try {
    const response = await fetch(`${apiUrl}/deleteWebhook`);
    const data = await response.json();
    
    if (data.ok) {
      console.log('\nВебхук успешно удален');
      return true;
    } else {
      console.error('Ошибка при удалении вебхука:', data.description);
      return false;
    }
  } catch (error) {
    console.error('Ошибка при запросе к API Telegram:', error.message);
    return false;
  }
}

// Main menu function
async function showMenu() {
  console.log('\n==== Управление вебхуком Telegram бота ====');
  console.log('1. Получить информацию о текущем вебхуке');
  console.log('2. Установить новый вебхук');
  console.log('3. Удалить вебхук');
  console.log('4. Выход');
  
  rl.question('\nВыберите действие (1-4): ', async (answer) => {
    switch (answer) {
      case '1':
        await getWebhookInfo();
        showMenu();
        break;
      case '2':
        rl.question('Введите URL для нового вебхука: ', async (url) => {
          if (!url.startsWith('https://') && !url.includes('ngrok')) {
            console.log('Предупреждение: URL должен использовать HTTPS (кроме ngrok)');
          }
          await setWebhook(url);
          showMenu();
        });
        break;
      case '3':
        await deleteWebhook();
        showMenu();
        break;
      case '4':
        console.log('Выход из программы');
        rl.close();
        break;
      default:
        console.log('Неверный выбор, пожалуйста, выберите снова');
        showMenu();
    }
  });
}

// Start the program
console.log('Telegram Webhook Manager');
console.log(`Используется бот с токеном: ${token.substring(0, 5)}...${token.substring(token.length - 5)}`);

showMenu(); 