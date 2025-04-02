# Gosha Bot - Telegram бот для поиска песен

Этот бот позволяет искать песни и аккорды из Google Docs песенника.

## Возможности

- Поиск песен по названию или тексту
- Просмотр списка всех песен
- Получение случайной песни
- Просмотр правил орлятского круга
- Статистика использования

## Установка и запуск

1. Клонируйте репозиторий
2. Установите зависимости:
```
npm install
```
3. Создайте файл `.env` со следующими переменными:
```
BOT_TOKEN=ваш_токен_телеграм_бота
SONGBOOK_URL=url_гугл_документа
GOOGLE_SERVICE_ACCOUNT={"ваши_учетные_данные_сервисного_аккаунта"}
# ИЛИ (рекомендуется для Node.js 18+)
GOOGLE_SERVICE_ACCOUNT_B64=<base64-закодированные_учетные_данные>
WEBHOOK_URL=url_для_вебхука_в_продакшне
```

Примечание: для Node.js 18+ рекомендуется использовать GOOGLE_SERVICE_ACCOUNT_B64 вместо GOOGLE_SERVICE_ACCOUNT, чтобы избежать ошибки `error:1E08010C:DECODER routines::unsupported`. Для конвертации JSON-ключа в base64:

```bash
# На Linux/Mac:
cat service-account.json | base64

# На Windows (PowerShell):
$bytes = [System.Text.Encoding]::UTF8.GetBytes((Get-Content service-account.json -Raw))
[System.Convert]::ToBase64String($bytes)
```

4. Запустите бот:
```
npm start
```

## Локальная разработка

Для локальной разработки:

1. Запустите бот в режиме разработки:
```
npm run dev
```

2. Наблюдение за логами:
```
npm run logs
```

## Управление вебхуками

Для управления вебхуками Telegram бота используйте встроенную утилиту:

```
npm run webhook
```

Эта утилита позволяет:
- Получить информацию о текущем вебхуке
- Установить новый вебхук
- Удалить вебхук

### Ручная настройка вебхука

Также можно настроить вебхук вручную через API Telegram:

1. Установка нового вебхука:
```
curl -F "url=https://ваш.домен/api/webhook" "https://api.telegram.org/bot<ВАШ_ТОКЕН>/setWebhook"
```

2. Проверка текущего вебхука:
```
curl "https://api.telegram.org/bot<ВАШ_ТОКЕН>/getWebhookInfo"
```

3. Удаление вебхука:
```
curl "https://api.telegram.org/bot<ВАШ_ТОКЕН>/deleteWebhook"
```

## Важные замечания по вебхукам

- HTTPS обязателен (кроме локальных тестов или использования ngrok)
- Поддерживаемые порты: 443, 80, 88, 8443
- Для локальной разработки рекомендуется использовать ngrok

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
- `/chords` - Поиск песни в аккорднике по названию или тексту
- `/list` - Список всех песен
- `/circlerules` - Правила орлятского круга
- `/status` - Статистика запросов песен
- `/random` - Получить случайную песню

## Развертывание на Vercel

1. Установите Vercel CLI:
   ```bash
   npm i -g vercel
   ```
2. Войдите в свой аккаунт Vercel:
   ```bash
   vercel login
   ```
3. Разверните приложение:
   ```bash
   vercel
   ```
4. Настройте переменные окружения в панели управления Vercel

## Структура Google Doc

- Каждая песня должна быть на отдельной странице
- Первая строка страницы - название песни
- Далее идет текст песни с аккордами 