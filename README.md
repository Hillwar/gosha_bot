# Gosha Demo Bot

Telegram бот для Gosha demo (@gosha_demo_bot). Этот бот предоставляет различные функции, включая:

- Анекдоты
- Аккорды и песни для гитары
- Ритмы и бои
- Правила орлятского круга
- Разные интересные ответы

## Автор оригинального кода
@Hleb66613

## Деплой на Vercel

Бот размещен на Vercel по адресу: https://gosha-bot.vercel.app/

Для правильной работы бота, вебхук настраивается следующей командой:

```
curl -X POST "https://api.telegram.org/bot7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs/setWebhook?url=https://gosha-bot.vercel.app/api/webhook"
```

Проверка статуса вебхука:

```
curl "https://api.telegram.org/bot7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs/getWebhookInfo"
```

## Доступные команды бота

- `/start` - Начало работы с ботом
- `/help` - Вывести справку
- `/chords` - Поиск аккордов для песни
- `/anecdote` - Рассказать анекдот
- `/strumming` - Показать доступные бои и ритмы
- `/circlerules` - Показать правила орлятского круга
- `/talk` - Сказать что-нибудь случайное
- `/status` - Показать статистику бота
- `/source` - Информация об исходном коде
- `/ping_gosha` - Проверка работы бота
- `/list` - Показать список песен в аккорднике
- `/cancel` - Отмена текущей операции 