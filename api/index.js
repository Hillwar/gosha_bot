// Простая страница для информации о боте при переходе на основной URL

module.exports = (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Гоша - Telegram Bot</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }
        h1 {
          color: #0088cc;
          margin-top: 40px;
        }
        a {
          color: #0088cc;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
        .container {
          border: 1px solid #e1e4e8;
          border-radius: 6px;
          padding: 24px;
          margin-top: 20px;
          background-color: #f6f8fa;
        }
        code {
          background-color: #e1e4e8;
          padding: 2px 4px;
          border-radius: 3px;
          font-family: monospace;
        }
        .logo {
          text-align: center;
          margin: 20px 0;
        }
        .logo img {
          width: 100px;
          height: 100px;
          border-radius: 50%;
        }
      </style>
    </head>
    <body>
      <div class="logo">
        <img src="https://i.ibb.co/DLBJfzQ/gosha-logo.png" alt="Гоша Бот">
      </div>
      <h1>Гоша - Telegram бот для аккордов и песен</h1>
      
      <div class="container">
        <h2>✨ Возможности:</h2>
        <ul>
          <li>Поиск песен с аккордами</li>
          <li>Правила орлятского круга</li>
          <li>Статистика запросов песен</li>
          <li>Рандомный выбор песни, которую давно не пели</li>
        </ul>
      </div>
      
      <div class="container">
        <h2>🔍 Как использовать:</h2>
        <p>Откройте бота в Telegram: <a href="https://t.me/gosha_demo_bot" target="_blank">@gosha_demo_bot</a></p>
        <p>Список команд:</p>
        <ul>
          <li><code>/start</code> - начать работу с ботом</li>
          <li><code>/help</code> - список всех команд</li>
          <li><code>/chords [запрос]</code> - поиск песни в аккорднике</li>
          <li><code>/list</code> - список всех песен</li>
          <li><code>/circlerules</code> - правила орлятского круга</li>
          <li><code>/status</code> - статистика запросов песен</li>
          <li><code>/random</code> - получить случайную песню, которую давно не пели</li>
        </ul>
      </div>
      
      <footer style="margin-top: 40px; text-align: center; color: #666;">
        <p>© 2023 Гоша Бот | <a href="https://github.com/username/gosha-bot" target="_blank">GitHub</a></p>
      </footer>
    </body>
    </html>
  `);
}; 