const { google } = require('googleapis');
const config = require('../config');

class GoogleDocsService {
  constructor() {
    this.docs = google.docs('v1');
    this.drive = google.drive('v3');
    this.auth = null;
    this.documentId = this.extractDocumentId(config.SONGBOOK_URL);
    console.log('GoogleDocsService initialized with document ID:', this.documentId);
  }

  // Извлекаем ID документа из URL
  extractDocumentId(url) {
    console.log('Extracting document ID from URL:', url);
    
    // Поддержка разных форматов URL Google Docs
    const patterns = [
      /\/document\/d\/([a-zA-Z0-9-_]+)/, // Стандартный формат
      /\/document\/d\/([a-zA-Z0-9-_]+)\//, // С слешем в конце
      /\/document\/d\/([a-zA-Z0-9-_]+)\/edit/, // С /edit в конце
      /^([a-zA-Z0-9-_]+)$/ // Просто ID
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        const documentId = match[1];
        console.log('Extracted document ID:', documentId);
        return documentId;
      }
    }

    console.error('Could not extract document ID from URL:', url);
    return null;
  }

  // Инициализация аутентификации
  async initialize() {
    try {
      console.log('Initializing Google Docs authentication...');
      
      if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
        throw new Error('Google service account credentials not found in environment variables');
      }

      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      console.log('Service account email:', credentials.client_email);
      
      this.auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/documents.readonly']
      });
      
      console.log('Authentication initialized successfully');
      return true;
    } catch (error) {
      console.error('Error initializing authentication:', error);
      throw error;
    }
  }

  // Получение содержимого документа
  async getDocument() {
    try {
      console.log('Getting document content...');
      
      if (!this.auth) {
        console.log('Auth not initialized, initializing...');
        await this.initialize();
      }

      if (!this.documentId) {
        throw new Error('Document ID is not valid');
      }

      console.log('Requesting document with ID:', this.documentId);
      const response = await this.docs.documents.get({
        auth: this.auth,
        documentId: this.documentId
      });

      console.log('Document retrieved successfully');
      return response.data;
    } catch (error) {
      console.error('Error getting document:', error.message);
      if (error.response) {
        console.error('Response error data:', error.response.data);
        console.error('Response error status:', error.response.status);
      }
      throw error;
    }
  }

  // Парсинг документа и извлечение песен
  async parseSongs() {
    try {
      console.log('Starting to parse songs from document...');
      const doc = await this.getDocument();
      const songs = [];
      let currentSong = null;

      if (!doc.body || !doc.body.content) {
        throw new Error('Document content is empty or invalid');
      }

      console.log('Processing document content...');
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
          console.log('Found new song:', text);
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

      console.log(`Parsed ${songs.length} songs from document`);
      return songs;
    } catch (error) {
      console.error('Error parsing songs:', error);
      throw error;
    }
  }

  // Поиск песен по запросу
  async findSongs(query) {
    try {
      console.log('Finding songs with query:', query);
      
      if (!query || query.trim() === '') {
        console.log('Empty query, returning empty result');
        return [];
      }

      query = query.toLowerCase().trim();
      const songs = await this.parseSongs();
      
      const results = songs.filter(song => {
        const titleMatch = song.title && song.title.toLowerCase().includes(query);
        const authorMatch = song.author && song.author.toLowerCase().includes(query);
        const lyricsMatch = song.lyrics && song.lyrics.toLowerCase().includes(query);
        return titleMatch || authorMatch || lyricsMatch;
      });

      console.log(`Found ${results.length} songs matching "${query}"`);
      return results;
    } catch (error) {
      console.error('Error finding songs:', error);
      throw error;
    }
  }
}

module.exports = new GoogleDocsService(); 