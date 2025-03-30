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

2. Once deployed, set up the Telegram webhook by visiting:
   ```
   https://api.telegram.org/bot7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs/setWebhook?url=https://your-vercel-app.vercel.app/api/webhook
   ```
   (Replace `your-vercel-app.vercel.app` with your actual Vercel deployment URL)

3. Verify the webhook is working by visiting:
   ```
   https://api.telegram.org/bot7746110687:AAElvNykURie6fU1kBiFGZ_c4co75n9qgRs/getWebhookInfo
   ```

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

3. Use a tool like ngrok to expose your local server and set up the webhook temporarily. 