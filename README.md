# Gosha Bot

Telegram бот для поиска аккордов и песен, а также правил орлятского круга.

## Функциональность

- Поиск песен по названию или автору
- Отображение аккордов и текстов песен
- Правила орлятского круга с изображением
- Случайный выбор песни
- Статистика запросов песен
- Полный список всех песен

## Команды

- `/start` - Начало работы с ботом
- `/help` - Список доступных команд
- `/chords [запрос]` - Поиск песни в аккорднике
- `/list` - Список всех песен
- `/circlerules` - Правила орлятского круга
- `/status` - Статистика запросов песен
- `/random` - Получить случайную песню

## Технологии

- Node.js
- Vercel Serverless Functions
- Telegram Bot API
- Axios

## Структура проекта

```
.
├── api/
│   ├── webhook.js           # Основной обработчик запросов
│   ├── config.js           # Конфигурация бота
│   ├── data/
│   │   ├── songs.js       # База песен
│   │   └── rules.js       # Правила орлятского круга
│   ├── services/
│   │   ├── telegram.js    # Сервис для работы с Telegram API
│   │   └── songService.js # Сервис для работы с песнями
│   └── handlers/
│       └── commandHandler.js # Обработчик команд
├── public/
│   └── img/
│       └── rules_img.jpeg # Изображение правил
├── package.json
└── vercel.json
```

## Установка и запуск

1. Клонируйте репозиторий:
\`\`\`bash
git clone https://github.com/Hillwar/gosha_bot.git
\`\`\`

2. Установите зависимости:
\`\`\`bash
npm install
\`\`\`

3. Создайте файл с переменными окружения:
\`\`\`bash
BOT_TOKEN=your_bot_token
\`\`\`

4. Запустите локальный сервер:
\`\`\`bash
npm start
\`\`\`

## Деплой

Проект настроен для деплоя на Vercel:

\`\`\`bash
npm run deploy
\`\`\`

## Лицензия

ISC 