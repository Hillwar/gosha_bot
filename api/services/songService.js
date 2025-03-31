const config = require('../config');
const GoogleDocsService = require('./googleDocsService');

// Сервис для работы с песнями
class SongService {
  constructor() {
    this.credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    this.googleDocs = new GoogleDocsService(this.credentials);
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
  async findSongsByTitle(query) {
    const songs = await this.getSongs();
    const normalizedQuery = query.toLowerCase().trim();
    
    // Exact title match
    const exactMatches = songs.filter(song => 
      song.title.toLowerCase() === normalizedQuery
    );
    if (exactMatches.length > 0) {
      return exactMatches;
    }

    // Partial title match
    return songs.filter(song => 
      song.title.toLowerCase().includes(normalizedQuery)
    );
  }

  async findSongsByContent(query) {
    const songs = await this.getSongs();
    const normalizedQuery = query.toLowerCase().trim();
    
    return songs.filter(song => 
      song.content.toLowerCase().includes(normalizedQuery)
    );
  }

  // Форматирование песни для вывода
  formatSong(song) {
    let result = `<b>${song.title}</b>\n\n`;
    result += song.content;
    result += `\n\n<a href="${config.SONGBOOK_URL}">Открыть сборник</a>`;
    return result;
  }

  // Получение случайной песни
  async getRandomSong() {
    const songs = await this.getSongs();
    const randomIndex = Math.floor(Math.random() * songs.length);
    return songs[randomIndex];
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
    console.log(`Formatting list of ${songs.length} songs`);
    
    if (songs.length === 0) {
      return "В сборнике пока нет песен. Попробуйте обновить позже.";
    }

    let listMessage = "<b>Список песен в сборнике:</b>\n\n";
    songs.forEach((song, index) => {
      console.log(`Adding song ${index + 1}: ${song.title}`);
      listMessage += `${index + 1}. ${song.title}\n`;
    });

    return listMessage;
  }
}

module.exports = new SongService(); 