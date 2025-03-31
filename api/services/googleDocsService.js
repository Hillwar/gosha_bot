const { google } = require('googleapis');
const config = require('../config');

class GoogleDocsService {
  constructor(credentials) {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
      client_email,
      null,
      private_key,
      ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/documents.readonly']
    );

    this.docs = google.docs({ version: 'v1', auth });
    this.drive = google.drive({ version: 'v3', auth });
    this.fileId = this.extractDocumentId(config.SONGBOOK_URL);
  }

  extractDocumentId(url) {
    const match = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  async getDocumentTitle(documentId) {
    try {
      const response = await this.drive.files.get({
        fileId: documentId,
        fields: 'name'
      });
      return response.data.name;
    } catch (error) {
      console.error('Error getting document title:', error);
      return null;
    }
  }

  async parseSongs(documentId) {
    try {
      const document = await this.docs.documents.get({ documentId });
      const content = document.data.body.content;
      
      let songs = [];
      let currentPage = [];

      // Проходим по всем элементам документа
      for (let i = 0; i < content.length; i++) {
        const element = content[i];

        // Если встретили разрыв страницы или это последний элемент
        if ((element.pageBreak || i === content.length - 1) && currentPage.length > 0) {
          // Если это последний элемент и это не разрыв страницы, добавляем его
          if (i === content.length - 1 && element.paragraph) {
            currentPage.push(element);
          }

          // Обрабатываем текущую страницу
          const song = this.parseSongFromPage(currentPage);
          if (song) {
            songs.push(song);
          }

          // Начинаем новую страницу
          currentPage = [];
        } else if (element.paragraph) {
          currentPage.push(element);
        }
      }

      console.log(`Parsed ${songs.length} songs from document`);
      return songs;
    } catch (error) {
      console.error('Error parsing songs:', error);
      return [];
    }
  }

  parseSongFromPage(pageElements) {
    if (!pageElements || pageElements.length === 0) return null;

    // Получаем первую непустую строку как заголовок
    let title = '';
    let contentStartIndex = 0;

    for (let i = 0; i < pageElements.length; i++) {
      const text = this.getElementText(pageElements[i]);
      if (text) {
        title = text;
        contentStartIndex = i + 1;
        break;
      }
    }

    if (!title) return null;

    // Собираем весь остальной контент страницы
    let content = [];
    for (let i = contentStartIndex; i < pageElements.length; i++) {
      const text = this.getElementText(pageElements[i]);
      if (text) {
        content.push(text);
      }
    }

    return {
      title: title.trim(),
      content: content.join('\n')
    };
  }

  getElementText(element) {
    if (!element.paragraph || !element.paragraph.elements) return '';
    return element.paragraph.elements
      .map(e => e.textRun?.content || '')
      .join('')
      .trim();
  }
}

module.exports = GoogleDocsService; 