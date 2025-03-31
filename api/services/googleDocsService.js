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
      let currentSong = null;
      let isInMetadata = false;
      
      for (const element of content) {
        if (!element.paragraph) continue;
        
        const text = element.paragraph.elements
          .map(e => e.textRun?.content || '')
          .join('')
          .trim();
          
        if (!text) continue;

        // Check if this is a new song title
        if (text.match(/^[А-Яа-яЁё\s]+$/)) {
          if (currentSong) {
            songs.push(currentSong);
          }
          
          currentSong = {
            title: text,
            author: '',
            rhythm: '',
            notes: '',
            chords: [],
            lyrics: []
          };
          isInMetadata = true;
          continue;
        }

        if (!currentSong) continue;

        // Parse metadata
        if (isInMetadata) {
          if (text.startsWith('Автор:')) {
            currentSong.author = text.replace('Автор:', '').trim();
          } else if (text.startsWith('Ритм:')) {
            currentSong.rhythm = text.replace('Ритм:', '').trim();
          } else if (text.startsWith('Примечание:')) {
            currentSong.notes = text.replace('Примечание:', '').trim();
          } else if (text.match(/^[A-H]m?7?|^[A-H]m?\(?7?\)?/)) {
            isInMetadata = false;
          }
        }

        // Parse chords and lyrics
        if (!isInMetadata) {
          if (text.match(/^[A-H]m?7?|^[A-H]m?\(?7?\)?/)) {
            currentSong.chords.push(text);
          } else {
            currentSong.lyrics.push(text);
          }
        }
      }

      // Don't forget to add the last song
      if (currentSong) {
        songs.push(currentSong);
      }

      return songs;
    } catch (error) {
      console.error('Error parsing songs:', error);
      return [];
    }
  }
}

module.exports = GoogleDocsService; 