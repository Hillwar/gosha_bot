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
      const songs = [];
      let currentSong = null;
      let currentPage = [];
      let pageStartIndex = 0;

      // Проходим по всем элементам документа
      for (let i = 0; i < content.length; i++) {
        const element = content[i];

        // Если встретили разрыв страницы или это последний элемент
        if (element.pageBreak || i === content.length - 1) {
          // Обрабатываем текущую страницу
          const song = this.parseSongFromPage(content.slice(pageStartIndex, i));
          if (song) {
            songs.push(song);
          }
          pageStartIndex = i + 1;
          continue;
        }
      }

      return songs;
    } catch (error) {
      console.error('Error parsing songs:', error);
      throw error;
    }
  }

  parseSongFromPage(pageContent) {
    let song = {
      title: '',
      author: '',
      rhythm: '',
      notes: '',
      lyrics: '',
      chords: []
    };

    let isInMetadata = true;
    let hasContent = false;

    for (let i = 0; i < pageContent.length; i++) {
      const element = pageContent[i];
      if (!element.paragraph) continue;

      const text = element.paragraph.elements
        .map(e => e.textRun?.content || '')
        .join('')
        .trim();

      if (!text) continue;

      hasContent = true;

      // Первая непустая строка - заголовок
      if (!song.title) {
        song.title = text;
        continue;
      }

      // Обрабатываем метаданные
      if (isInMetadata) {
        if (text.match(/^Автор:/i)) {
          song.author = text.replace(/^Автор:\s*/i, '');
          continue;
        }
        if (text.match(/^Ритм:/i)) {
          song.rhythm = text.replace(/^Ритм:\s*/i, '');
          continue;
        }
        if (text.match(/^Примечание:/i)) {
          song.notes = text.replace(/^Примечание:\s*/i, '');
          continue;
        }
        // Если встретили строку с аккордами или номером куплета, значит метаданные закончились
        if (text.match(/^([A-H]m?7?|[1-9]\.)/)) {
          isInMetadata = false;
        }
      }

      // Проверяем, является ли строка аккордами
      if (text.match(/^[A-H]m?7?/)) {
        song.chords.push(text);
        continue;
      }

      // Добавляем текст песни
      song.lyrics += text + '\n';
    }

    // Возвращаем песню только если на странице был контент
    return hasContent ? song : null;
  }
}

module.exports = new GoogleDocsService(); 