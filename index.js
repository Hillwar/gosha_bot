// This file is for local testing, Vercel will use the api/webhook.js file
const http = require('http');
const webhookHandler = require('./api/webhook');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/webhook' && req.method === 'POST') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        req.body = JSON.parse(body);
        await webhookHandler(req, res);
      } catch (error) {
        console.error('Error processing request:', error);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  } else {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Gosha Telegram Bot Server');
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 