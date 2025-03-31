// Конфигурация бота
module.exports = {
  // Основные настройки бота
  BOT_TOKEN: process.env.BOT_TOKEN || '7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs',
  BOT_NAME: process.env.BOT_NAME || 'gosha_demo_bot',
  WEBHOOK_URL: process.env.WEBHOOK_URL || 'https://gosha-bot.vercel.app/api/webhook',
  
  // Ссылки и ресурсы
  SONGBOOK_URL: process.env.SONGBOOK_URL || 'https://docs.google.com/document/d/1e7t6SXSQKO9DMIMehiY_8NwHcQQQ1OVv/edit',
  CIRCLE_RULES_IMAGE: process.env.CIRCLE_RULES_IMAGE || 'https://i.imgur.com/8JQZQZQ.jpg',
  
  // Настройки сообщений
  MAX_SEARCH_RESULTS: 5,
  DEFAULT_PARSE_MODE: 'HTML',

  // Настройки кэширования
  CACHE_TIMEOUT: 5 * 60 * 1000, // 5 минут
}; 