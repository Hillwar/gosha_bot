const config = require('../config');
const googleDocsService = require('./googleDocsService');

// Сервис для работы с песнями
class SongService {
  constructor() {
    this.songsStats = {};
    this.lastSongRequests = {};
    this.cachedSongs = null;
    this.lastCacheUpdate = null;
    this.cacheTimeout = config.CACHE_TIMEOUT;
  }

  // Получение всех песен с кэшированием
  async getAllSongs() {
    const now = Date.now();
    if (!this.cachedSongs || !this.lastCacheUpdate || (now - this.lastCacheUpdate > this.cacheTimeout)) {
      console.log('Updating songs cache from Google Docs');
      this.cachedSongs = await googleDocsService.parseSongs();
      this.lastCacheUpdate = now;
    }
    return this.cachedSongs;
  }

  // Поиск песни по запросу
  async findSongs(query) {
    if (!query || query.trim() === '') {
      return [];
    }

    query = query.toLowerCase().trim();
    console.log(`Searching for songs with query: "${query}"`);

    const songs = await this.getAllSongs();
    const results = songs.filter(song => {
      // Сначала проверяем точное совпадение заголовка
      if (song.title.toLowerCase() === query) {
        return true;
      }

      // Затем проверяем частичное совпадение заголовка
      const titleMatch = song.title && song.title.toLowerCase().includes(query);
      if (titleMatch) {
        return true;
      }

      // Проверяем совпадение автора
      const authorMatch = song.author && song.author.toLowerCase().includes(query);
      if (authorMatch) {
        return true;
      }

      // В последнюю очередь проверяем текст песни
      const lyricsMatch = song.lyrics && song.lyrics.toLowerCase().includes(query);
      return lyricsMatch;
    });

    // Сортируем результаты по релевантности
    results.sort((a, b) => {
      // Точное совпадение заголовка имеет наивысший приоритет
      if (a.title.toLowerCase() === query) return -1;
      if (b.title.toLowerCase() === query) return 1;

      // Частичное совпадение заголовка имеет второй приоритет
      const aTitle = a.title.toLowerCase().includes(query);
      const bTitle = b.title.toLowerCase().includes(query);
      if (aTitle && !bTitle) return -1;
      if (!aTitle && bTitle) return 1;

      // Совпадение автора имеет третий приоритет
      const aAuthor = a.author && a.author.toLowerCase().includes(query);
      const bAuthor = b.author && b.author.toLowerCase().includes(query);
      if (aAuthor && !bAuthor) return -1;
      if (!aAuthor && bAuthor) return 1;

      // По умолчанию сортируем по алфавиту
      return a.title.localeCompare(b.title);
    });

    console.log(`Found ${results.length} songs matching "${query}"`);
    return results;
  }

  // Форматирование песни для вывода
  formatSong(song) {
    let formattedSong = `${song.title}\n`;
    
    if (song.author) {
      formattedSong += `Автор: ${song.author}\n`;
    }
    
    if (song.rhythm) {
      formattedSong += `Ритм: ${song.rhythm}\n`;
    }
    
    if (song.notes) {
      formattedSong += `Примечание: ${song.notes}\n`;
    }
    
    formattedSong += '\n';

    // Добавляем текст с аккордами
    const lines = song.lyrics.split('\n');
    const chordLines = song.chords || [];
    let chordIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Если строка начинается с цифры и точки, это начало нового куплета
      if (/^\d+\./.test(line)) {
        formattedSong += '\n' + line + '\n';
        continue;
      }

      // Если есть аккорды для этой строки
      if (chordIndex < chordLines.length) {
        formattedSong += chordLines[chordIndex] + '\n';
        chordIndex++;
      }

      formattedSong += line + '\n';
    }
    
    formattedSong += '\n<a href="${config.SONGBOOK_URL}">Открыть полный аккордник</a>';
    
    return formattedSong;
  }

  // Получение случайной песни
  async getRandomSong() {
    const songs = await this.getAllSongs();
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
    const songs = await this.getAllSongs();
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