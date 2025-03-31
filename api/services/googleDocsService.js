const { google } = require('googleapis');
const config = require('../config');

class GoogleDocsService {
  constructor() {
    this.docs = google.docs('v1');
    this.drive = google.drive('v3');
    this.auth = null;
    this.documentId = this.extractDocumentId(config.SONGBOOK_URL);
  }

  // Извлекаем ID документа из URL
  extractDocumentId(url) {
    const match = url.match(/[-\w]{25,}/);
    return match ? match[0] : null;
  }

  // Инициализация аутентификации
  async initialize() {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
      throw new Error('Google service account credentials not found');
    }

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    this.auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/documents.readonly']
    });
  }

  // Получение содержимого документа
  async getDocument() {
    if (!this.auth) {
      await this.initialize();
    }

    const response = await this.docs.documents.get({
      auth: this.auth,
      documentId: this.documentId
    });

    return response.data;
  }

  // Парсинг документа и извлечение песен
  async parseSongs() {
    const doc = await this.getDocument();
    const songs = [];
    let currentSong = null;

    for (const element of doc.body.content) {
      if (!element.paragraph) continue;

      const text = element.paragraph.elements
        .map(e => e.textRun?.content || '')
        .join('')
        .trim();

      if (!text) continue;

      // Определяем начало новой песни по заголовку
      if (element.paragraph.paragraphStyle?.namedStyleType === 'HEADING_1' ||
          element.paragraph.paragraphStyle?.namedStyleType === 'HEADING_2') {
        if (currentSong) {
          songs.push(currentSong);
        }
        currentSong = {
          title: text,
          author: '',
          lyrics: '',
          rhythm: '',
          notes: ''
        };
      } else if (currentSong) {
        // Определяем тип контента по форматированию или ключевым словам
        if (text.toLowerCase().startsWith('автор:')) {
          currentSong.author = text.replace(/^автор:/i, '').trim();
        } else if (text.toLowerCase().startsWith('ритм:')) {
          currentSong.rhythm = text.replace(/^ритм:/i, '').trim();
        } else if (text.toLowerCase().startsWith('примечание:')) {
          currentSong.notes = text.replace(/^примечание:/i, '').trim();
        } else {
          // Добавляем текст к lyrics, сохраняя форматирование
          currentSong.lyrics += text + '\n';
        }
      }
    }

    // Добавляем последнюю песню
    if (currentSong) {
      songs.push(currentSong);
    }

    return songs;
  }

  // Поиск песен по запросу
  async findSongs(query) {
    if (!query || query.trim() === '') {
      return [];
    }

    query = query.toLowerCase().trim();
    console.log(`Searching for songs with query: "${query}"`);

    const songs = await this.parseSongs();
    
    const results = songs.filter(song => {
      const titleMatch = song.title && song.title.toLowerCase().includes(query);
      const authorMatch = song.author && song.author.toLowerCase().includes(query);
      const lyricsMatch = song.lyrics && song.lyrics.toLowerCase().includes(query);
      return titleMatch || authorMatch || lyricsMatch;
    });

    console.log(`Found ${results.length} songs matching "${query}"`);
    return results;
  }
}

module.exports = new GoogleDocsService(); 