const config = require('../config');
const googleDocsService = require('./googleDocsService');

// Сервис для работы с песнями
class SongService {
  constructor() {
    this.credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    this.googleDocs = new googleDocsService(this.credentials);
    this.songs = [];
    this.lastUpdate = 0;
    this.cacheTimeout = config.CACHE_TIMEOUT;
    this.songsStats = {};
    this.lastSongRequests = {};
    this.cachedSongs = null;
    this.lastCacheUpdate = null;
  }

  // Получение всех песен с кэшированием
  async getSongs() {
    const now = Date.now();
    if (now - this.lastUpdate > this.cacheTimeout || this.songs.length === 0) {
      try {
        this.songs = await this.googleDocs.parseSongs(this.googleDocs.fileId);
        this.lastUpdate = now;
      } catch (error) {
        console.error('Error updating songs:', error);
      }
    }
    return this.songs;
  }

  // Поиск песни по запросу
  async findSongs(query) {
    const songs = await this.getSongs();
    const normalizedQuery = query.toLowerCase().trim();
    
    // Exact title match
    const exactTitleMatches = songs.filter(song => 
      song.title.toLowerCase() === normalizedQuery
    );
    if (exactTitleMatches.length > 0) {
      return exactTitleMatches;
    }

    // Partial title match
    const titleMatches = songs.filter(song => 
      song.title.toLowerCase().includes(normalizedQuery)
    );
    if (titleMatches.length > 0) {
      return titleMatches;
    }

    // Author match
    const authorMatches = songs.filter(song => 
      song.author.toLowerCase().includes(normalizedQuery)
    );
    if (authorMatches.length > 0) {
      return authorMatches;
    }

    // Lyrics match
    return songs.filter(song => 
      song.lyrics.some(line => line.toLowerCase().includes(normalizedQuery))
    );
  }

  // Форматирование песни для вывода
  formatSong(song) {
    let result = `<b>${song.title}</b>\n`;
    if (song.author) {
      result += `Автор: ${song.author}\n`;
    }
    if (song.rhythm) {
      result += `Ритм: ${song.rhythm}\n`;
    }
    if (song.notes) {
      result += `Примечание: ${song.notes}\n`;
    }
    result += '\n';

    // Combine chords and lyrics
    const lines = [];
    for (let i = 0; i < Math.max(song.chords.length, song.lyrics.length); i++) {
      if (song.chords[i]) {
        lines.push(`<code>${song.chords[i]}</code>`);
      }
      if (song.lyrics[i]) {
        lines.push(song.lyrics[i]);
      }
    }
    
    result += lines.join('\n');
    result += `\n\n<a href="${config.SONGBOOK_URL}">Открыть сборник</a>`;
    
    return result;
  }

  // Получение случайной песни
  async getRandomSong() {
    const songs = await this.getSongs();
    const sortedSongs = [...songs].sort((a, b) => {
      const timeA = this.lastSongRequests[a.title] || 0;
      const timeB = this.lastSongRequests[b.title] || 0;
      return timeA - timeB;
    });
    
    const unusedSongs = sortedSongs.slice(0, Math.max(1, Math.floor(sortedSongs.length / 3)));
    const randomIndex = Math.floor(Math.random() * unusedSongs.length);
    const song = unusedSongs[randomIndex];
    
    this.lastSongRequests[song.title] = Date.now();
    return song;
  }

  // Обновление статистики
  updateStats(songTitle) {
    this.songsStats[songTitle] = (this.songsStats[songTitle] || 0) + 1;
    this.lastSongRequests[songTitle] = Date.now();
  }

  // Получение статистики
  getStats() {
    const songEntries = Object.entries(this.songsStats).sort((a, b) => b[1] - a[1]);
    
    if (songEntries.length === 0) {
      return "Статистика пока не собрана. Используйте команду /chords для поиска песен.";
    }
    
    let statsMessage = "<b>Статистика запросов песен:</b>\n\n";
    songEntries.forEach(([title, count], index) => {
      statsMessage += `${index + 1}. ${title}: ${count} ${count === 1 ? 'запрос' : 'запросов'}\n`;
    });
    
    return statsMessage;
  }

  // Получение списка всех песен
  async getSongsList() {
    const songs = await this.getSongs();
    let listMessage = "<b>Список песен в аккорднике:</b>\n\n";
    songs.forEach((song, index) => {
      listMessage += `${index + 1}. ${song.title}`;
      if (song.author) {
        listMessage += ` - ${song.author}`;
      }
      listMessage += '\n';
    });
    return listMessage;
  }
}

module.exports = new SongService(); 