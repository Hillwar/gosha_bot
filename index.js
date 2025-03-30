// This file is for local testing, Vercel will use the api/webhook.js file
const http = require('http');
const url = require('url');
const webhookHandler = require('./api/webhook');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  try {
    // Parse URL and query parameters
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    
    // Add query parameters to request
    req.query = parsedUrl.query;
    
    // Parse body for POST requests
    if (req.method === 'POST') {
      let body = '';
      
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          if (body) {
            req.body = JSON.parse(body);
          } else {
            req.body = {};
          }
          // Process with the webhook handler
          await processRequest(req, res, path);
        } catch (error) {
          console.error('Error processing request:', error);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    } else {
      // Handle GET requests immediately
      await processRequest(req, res, path);
    }
  } catch (error) {
    console.error('Server error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

async function processRequest(req, res, path) {
  // Create response methods to match Vercel's
  res.status = function(code) {
    this.statusCode = code;
    return this;
  };
  
  res.json = function(data) {
    this.setHeader('Content-Type', 'application/json');
    this.end(JSON.stringify(data));
    return this;
  };
  
  res.send = function(data) {
    this.end(data);
    return this;
  };
  
  // Set URL for route handling
  req.url = path;
  
  // Process routes based on path
  if (path.startsWith('/api/webhook')) {
    await webhookHandler(req, res);
  } else {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Gosha Telegram Bot Server - Available endpoints: /api/webhook/ping, /api/webhook/set-webhook, /api/webhook/webhook-info');
  }
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Available endpoints:`);
  console.log(`- http://localhost:${PORT}/api/webhook`);
  console.log(`- http://localhost:${PORT}/api/webhook/ping`);
  console.log(`- http://localhost:${PORT}/api/webhook/set-webhook?url=YOUR_URL`);
  console.log(`- http://localhost:${PORT}/api/webhook/webhook-info`);
}); 