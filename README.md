# Gosha Telegram Bot

Telegram bot for Gosha demo (@gosha_demo_bot). This bot provides various features including:

- Anecdotes
- Guitar chords and songs
- Strumming patterns
- Circle rules
- Various command responses

## Original Author
@Hleb66613

## Vercel Deployment

This bot can be hosted on Vercel by following these steps:

1. Deploy the code to Vercel:
   - Connect your GitHub repository to Vercel
   - Configure the project and deploy

2. Once deployed, there are two ways to set up the Telegram webhook:

   **Method 1 (Recommended)**: Visit your Vercel deployment URL with the set-webhook endpoint:
   ```
   https://your-vercel-app.vercel.app/api/webhook/set-webhook?url=https://your-vercel-app.vercel.app/api/webhook
   ```
   (Replace `your-vercel-app.vercel.app` with your actual Vercel deployment URL)

   **Method 2**: Using the Telegram API directly:
   ```
   https://api.telegram.org/bot7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs/setWebhook?url=https://your-vercel-app.vercel.app/api/webhook
   ```

3. Verify the webhook is working by visiting:
   ```
   https://your-vercel-app.vercel.app/api/webhook/webhook-info
   ```
   
   Or directly via Telegram API:
   ```
   https://api.telegram.org/bot7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs/getWebhookInfo
   ```

4. Check if the server is running by visiting:
   ```
   https://your-vercel-app.vercel.app/api/webhook/ping
   ```

## Troubleshooting

If the bot doesn't respond:

1. Check the webhook info to make sure it's properly set up
2. Vercel may have put your project to sleep; visit the ping endpoint to wake it up
3. Check Vercel logs for any errors
4. If using a free Vercel plan, be aware of the limitations on serverless function execution

## Local Development

To run the bot locally:

1. Install dependencies:
   ```
   npm install
   ```

2. Start the local server:
   ```
   npm start
   ```

3. For local testing with long polling, use:
   ```
   node local.js
   ``` 