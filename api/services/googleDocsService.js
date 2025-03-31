const { google } = require('googleapis');
const config = require('../config');

class GoogleDocsService {
  constructor() {
    this.credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

    this.auth = new google.auth.GoogleAuth({
      credentials: this.credentials,
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/documents.readonly'
      ]
    });

    this.drive = google.drive({ version: 'v3', auth: this.auth });
    this.docs = google.docs({ version: 'v1', auth: this.auth });
    this.fileId = this.extractDocumentId(config.SONGBOOK_URL);
  }

  extractDocumentId(url) {
    const patterns = [
      /\/document\/d\/([a-zA-Z0-9-_]+)/,
      /\/document\/d\/([a-zA-Z0-9-_]+)\//,
      /\/document\/d\/([a-zA-Z0-9-_]+)\/edit/,
      /^([a-zA-Z0-9-_]+)$/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    throw new Error('Could not extract document ID from URL');
  }

  async parseSongs() {
    try {
      console.log('Getting document content...');
      const doc = await this.docs.documents.get({
        documentId: this.fileId
      });

      const content = doc.data.body.content;
      let currentSong = null;
      const songs = [];
      let isInSong = false;

      for (let i = 0; i < content.length; i++) {
        const element = content[i];
        if (!element.paragraph) continue;

        const text = element.paragraph.elements
          .map(e => e.textRun?.content || '')
          .join('')
          .trim();

        if (!text) continue;

        // Проверяем, является ли текущий параграф заголовком песни
        const isSongTitle = (
          // Если это первая строка после пустой строки
          (i > 0 && (!content[i-1].paragraph || !content[i-1].paragraph.elements[0]?.textRun?.content?.trim())) &&
          // И следующая строка содержит "Слова" или "музыка" или аккорды
          (i < content.length - 1 && content[i+1].paragraph && 
           (content[i+1].paragraph.elements[0]?.textRun?.content || '').trim().match(/^(Слова|музыка|[A-H]m?7?)/i))
        );

        if (isSongTitle) {
          if (currentSong) {
            songs.push(currentSong);
          }
          currentSong = {
            title: text,
            author: '',
            lyrics: '',
            chords: []
          };
          isInSong = true;
          continue;
        }

        if (!isInSong) continue;

        // Проверяем, является ли строка авторской информацией
        if (text.match(/^(Слова|музыка|муз\.|сл\.)/i)) {
          currentSong.author = text;
          continue;
        }

        // Проверяем, является ли строка аккордами
        if (text.match(/^[A-H]m?7?/)) {
          currentSong.chords.push(text);
          continue;
        }

        // Добавляем текст песни
        currentSong.lyrics += text + '\n';
      }

      // Добавляем последнюю песню
      if (currentSong) {
        songs.push(currentSong);
      }

      return songs;
    } catch (error) {
      console.error('Error parsing songs:', error);
      throw error;
    }
  }
}

module.exports = new GoogleDocsService(); 