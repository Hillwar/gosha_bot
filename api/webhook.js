const commandHandler = require('./handlers/commandHandler');
const config = require('./config');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).send(`Bot ${config.BOT_NAME} is running!`);
    return;
  }
  
  if (req.method === 'POST') {
    console.log('Received update from Telegram:', JSON.stringify(req.body));
    
    const update = req.body;
    
    try {
      if (update.callback_query) {
        await commandHandler.handleCallback(update.callback_query);
      } else if (update.message) {
        if (update.message.text && update.message.text.startsWith('/')) {
          await commandHandler.handleCommand(update.message);
        } else {
          await commandHandler.handleMessage(update.message);
        }
      }
      
      res.status(200).send('OK');
    } catch (error) {
      console.error('Error processing update:', error);
      res.status(200).send('Error processed');
    }
    
    return;
  }
  
  res.status(405).send('Method Not Allowed');
}; 