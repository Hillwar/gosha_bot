// Local testing with long polling
const axios = require('axios');

// Bot configuration
const apiToken = "7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs";
const apiUrl = `https://api.telegram.org/bot${apiToken}`;
const webhookHandler = require('./api/webhook');

// Simulation of request and response objects
class MockResponse {
  constructor() {
    this.statusCode = 200;
    this.headers = {};
    this.body = '';
  }
  
  status(code) {
    this.statusCode = code;
    return this;
  }
  
  setHeader(name, value) {
    this.headers[name] = value;
    return this;
  }
  
  json(data) {
    this.body = JSON.stringify(data);
    console.log('Response data:', data);
    return this;
  }
  
  send(data) {
    this.body = data;
    return this;
  }
}

// Function to get updates
let offset = 0;
const getUpdates = async () => {
  try {
    const response = await axios.get(`${apiUrl}/getUpdates`, {
      params: {
        offset,
        timeout: 30
      }
    });
    
    const updates = response.data.result;
    
    if (updates.length > 0) {
      offset = updates[updates.length - 1].update_id + 1;
      
      for (const update of updates) {
        console.log('\nProcessing update:', JSON.stringify(update));
        
        // Create mock request and response objects
        const req = {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: update  // Telegram передает обновление в теле запроса
        };
        const res = new MockResponse();
        
        try {
          // Process update with webhook handler
          await webhookHandler(req, res);
        } catch (error) {
          console.error('Error in webhook handler:', error);
        }
      }
    }
  } catch (error) {
    console.error('Error getting updates:', error.message);
  }
  
  // Continue polling
  setTimeout(getUpdates, 1000);
};

// Function to send a test message 
const sendTestMessage = async (chatId, text) => {
  try {
    const response = await axios.post(`${apiUrl}/sendMessage`, {
      chat_id: chatId,
      text: text
    });
    console.log('Test message sent:', response.data);
  } catch (error) {
    console.error('Error sending test message:', error);
  }
};

// Delete webhook to ensure long polling works
const deleteWebhook = async () => {
  try {
    const response = await axios.get(`${apiUrl}/deleteWebhook`);
    console.log('Webhook deleted:', response.data);
    return response.data.ok;
  } catch (error) {
    console.error('Error deleting webhook:', error.message);
    return false;
  }
};

// Start polling
(async () => {
  console.log('Starting bot in long polling mode...');
  
  const webhookDeleted = await deleteWebhook();
  if (webhookDeleted) {
    console.log('Bot is running! Send messages to @gosha_demo_bot');
    getUpdates();
  } else {
    console.error('Could not delete webhook. Please delete it manually.');
  }
})(); 