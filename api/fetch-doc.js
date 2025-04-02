/**
 * Скрипт для загрузки содержимого Google Docs в локальный файл
 * с сохранением форматирования текста, особенно для аккордов и структуры песен
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Получаем путь к файлу учетных данных
const credentialsPath = path.join(__dirname, '..', 'Gosha IAM Admin.json');

// Функция для получения ID документа из URL
function getDocumentIdFromUrl(url) {
  if (!url) {
    throw new Error('URL документа не указан');
  }
  
  if (url.includes('/d/')) {
    // Формат: https://docs.google.com/document/d/DOCUMENT_ID/edit
    return url.split('/d/')[1].split('/')[0];
  } else if (url.includes('?id=')) {
    // Формат: https://docs.google.com/document/edit?id=DOCUMENT_ID
    return url.split('?id=')[1].split('&')[0];
  } else if (url.match(/^[a-zA-Z0-9_-]{25,}$/)) {
    // Если указан только ID документа
    return url;
  } else {
    throw new Error(`Неверный формат URL документа: ${url}`);
  }
}

/**
 * Анализирует текстовый элемент для определения, является ли он аккордом
 * @param {string} text - Текст для проверки
 * @return {boolean} - true, если текст похож на аккорд
 */
function isChord(text) {
  // Паттерны для распознавания аккордов (основные)
  const chordPatterns = [
    /^[ABCDEFGH][m]?$/,  // Базовые аккорды: A, Am, C, Cm, и т.д.
    /^[ABCDEFGH][m]?(7|9|11|13|maj7|min7|sus2|sus4|dim|aug)?$/,  // С добавлением 7, maj7, и т.д.
    /^[ABCDEFGH][m]?[\/#][ABCDEFGH]$/,  // Аккорды с басом: A/G, C/G, и т.д.
    /^[ABCDEFGH][#b]?[m]?$/  // Аккорды с диезами/бемолями: A#, Bb, F#m, и т.д.
  ];

  // Типичные названия аккордов вручную для проверки
  const commonChords = [
    'A', 'Am', 'A7', 'Amaj7', 'Am7', 'Asus', 'Asus4', 'A/E',
    'B', 'Bm', 'B7', 'Bmaj7', 'Bm7', 'Bsus', 'Bsus4', 'B/F#',
    'C', 'Cm', 'C7', 'Cmaj7', 'Cm7', 'Csus', 'Csus4', 'C/G',
    'D', 'Dm', 'D7', 'Dmaj7', 'Dm7', 'Dsus', 'Dsus4', 'D/A',
    'E', 'Em', 'E7', 'Emaj7', 'Em7', 'Esus', 'Esus4', 'E/B',
    'F', 'Fm', 'F7', 'Fmaj7', 'Fm7', 'Fsus', 'Fsus4', 'F/C',
    'G', 'Gm', 'G7', 'Gmaj7', 'Gm7', 'Gsus', 'Gsus4', 'G/D',
    'A#', 'A#m', 'Bb', 'Bbm', 'C#', 'C#m', 'Db', 'Dbm',
    'D#', 'D#m', 'Eb', 'Ebm', 'F#', 'F#m', 'Gb', 'Gbm',
    'G#', 'G#m', 'Ab', 'Abm'
  ];

  // Проверяем, соответствует ли текст одному из паттернов или является известным аккордом
  const trimmedText = text.trim();
  
  // Прямое совпадение со списком
  if (commonChords.includes(trimmedText)) {
    return true;
  }
  
  // Проверка по регулярным выражениям
  for (const pattern of chordPatterns) {
    if (pattern.test(trimmedText)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Определяет, является ли строка заголовком части песни (припев, куплет и т.д.)
 * @param {string} text - Текст для проверки
 * @return {boolean} - true, если текст является заголовком части песни
 */
function isSongSectionHeader(text) {
  const headerPatterns = [
    /^(Припев|Chorus)[\.:]?$/i,
    /^(Куплет|Verse)\s*\d*[\.:]?$/i,
    /^(Бридж|Bridge)[\.:]?$/i,
    /^(Вступление|Intro)[\.:]?$/i,
    /^(Кода|Coda)[\.:]?$/i,
    /^(Проигрыш|Interlude)[\.:]?$/i,
    /^(Финал|Outro)[\.:]?$/i
  ];
  
  const trimmedText = text.trim();
  
  for (const pattern of headerPatterns) {
    if (pattern.test(trimmedText)) {
      return true;
    }
  }
  
  return false;
}

async function fetchAndSaveDocument() {
  try {
    console.log('Начинаю загрузку документа...');
    
    // Проверяем наличие URL документа
    if (!process.env.SONGBOOK_URL) {
      console.error('SONGBOOK_URL не указан в файле .env');
      return;
    }
    
    // Инициализируем Google API
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/documents.readonly']
    });
    
    const docs = google.docs({ version: 'v1', auth });
    
    // Получаем ID документа из URL
    const url = process.env.SONGBOOK_URL;
    const documentId = getDocumentIdFromUrl(url);
    console.log(`ID документа: ${documentId}`);
    
    // Делаем запрос к Google API
    const document = await docs.documents.get({
      documentId: documentId
    });
    
    if (!document || !document.data) {
      console.error('Google API вернул пустой документ');
      return;
    }
    
    console.log(`Документ получен: "${document.data.title}"`);
    
    // Сохраняем полное содержимое документа в JSON файл для анализа
    const docJsonPath = path.join(__dirname, 'document.json');
    fs.writeFileSync(docJsonPath, JSON.stringify(document.data, null, 2), 'utf8');
    console.log(`Полное содержимое документа сохранено в: ${docJsonPath}`);
    
    // Извлекаем текст документа с форматированием
    let formattedText = '';
    let plainText = '';
    let htmlText = ''; // Добавляем HTML версию текста для лучшего отображения
    
    let currentTitle = '';
    let songCount = 0;
    
    if (document.data.body && document.data.body.content) {
      // Проходим по всем элементам содержимого
      document.data.body.content.forEach(item => {
        if (item && item.paragraph) {
          const paragraphStyle = item.paragraph.paragraphStyle;
          const paragraphElements = item.paragraph.elements;
          
          // Проверяем, является ли параграф заголовком
          if (paragraphStyle && paragraphStyle.namedStyleType === 'TITLE' && paragraphElements && paragraphElements[0]) {
            const titleText = paragraphElements[0].textRun ? paragraphElements[0].textRun.content.trim() : '';
            currentTitle = titleText;
            songCount++;
            
            // Добавляем заголовок с разделителем в обычный текст
            formattedText += `\n\n==========================================\n`;
            formattedText += `ПЕСНЯ ${songCount}: ${titleText}\n`;
            formattedText += `==========================================\n\n`;
            
            // Добавляем заголовок в простой текст
            plainText += `\n\n${titleText}\n\n`;
            
            // Добавляем заголовок с форматированием в HTML
            htmlText += `<div class="song" id="song-${songCount}">\n`;
            htmlText += `<h2 class="song-title">${titleText}</h2>\n`;
          } 
          // Обычный параграф
          else if (paragraphElements) {
            let paragraphText = '';
            let paragraphHtml = '';
            let hasChords = false;
            let isSectionHeader = false;
            
            // Собираем текст из всех элементов параграфа
            for (const element of paragraphElements) {
              if (element.textRun) {
                const text = element.textRun.content;
                const textStyle = element.textRun.textStyle || {};
                
                // Проверяем, является ли текст аккордом (обычно они выделены жирным или имеют другой стиль)
                const isTextChord = isChord(text.trim());
                
                // Проверяем на заголовок части песни (припев, куплет)
                if (isSongSectionHeader(text.trim())) {
                  isSectionHeader = true;
                }
                
                // Добавляем в обычный форматированный текст
                if (isTextChord) {
                  formattedText += `[${text}]`;
                  hasChords = true;
                } else {
                  formattedText += text;
                }
                
                // Добавляем в простой текст
                plainText += text;
                
                // Добавляем в HTML с учетом форматирования
                let styledText = text;
                
                // Применяем стили для HTML
                if (textStyle.bold) {
                  styledText = `<strong>${styledText}</strong>`;
                }
                if (textStyle.italic) {
                  styledText = `<em>${styledText}</em>`;
                }
                if (textStyle.underline) {
                  styledText = `<u>${styledText}</u>`;
                }
                
                // Если это аккорд, добавляем специальный класс
                if (isTextChord || (textStyle.bold && isChord(text.trim()))) {
                  styledText = `<span class="chord">${styledText}</span>`;
                  hasChords = true;
                }
                
                paragraphHtml += styledText;
              }
            }
            
            // Добавляем параграф с информацией о форматировании
            if (paragraphText.trim() || paragraphHtml.trim()) {
              // В обычный текст добавляем с пометкой, если есть аккорды
              if (hasChords) {
                formattedText += ' [СТРОКА С АККОРДАМИ]\n';
              } else {
                formattedText += '\n';
              }
              
              // В plainText просто добавляем перевод строки
              plainText += '\n';
              
              // В HTML добавляем с учетом типа параграфа
              if (isSectionHeader) {
                htmlText += `<h3 class="section-header">${paragraphHtml}</h3>\n`;
              } else if (hasChords) {
                htmlText += `<div class="chord-line">${paragraphHtml}</div>\n`;
              } else {
                htmlText += `<p>${paragraphHtml}</p>\n`;
              }
            }
          }
        }
      });
      
      // Закрываем последний div песни в HTML
      htmlText += `</div>\n`;
    }
    
    // Добавляем базовые стили для HTML
    const htmlDocument = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${document.data.title || 'Songbook'}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: #f9f9f9;
        }
        .song {
            background-color: #fff;
            border-radius: 5px;
            padding: 20px;
            margin-bottom: 30px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .song-title {
            color: #2c3e50;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        .section-header {
            color: #3498db;
            margin-top: 20px;
            margin-bottom: 10px;
            font-size: 18px;
        }
        .chord {
            color: #e74c3c;
            font-weight: bold;
            padding: 0 2px;
        }
        .chord-line {
            margin-bottom: 5px;
            color: #333;
        }
        p {
            margin: 5px 0;
        }
    </style>
</head>
<body>
    <h1>${document.data.title || 'Песенник'}</h1>
    ${htmlText}
</body>
</html>
    `;
    
    // Сохраняем текст документа в разных форматах
    const formattedFilePath = path.join(__dirname, 'document_formatted.txt');
    fs.writeFileSync(formattedFilePath, formattedText, 'utf8');
    console.log(`Форматированный текст сохранен в: ${formattedFilePath}`);
    
    const plainFilePath = path.join(__dirname, 'document_plain.txt');
    fs.writeFileSync(plainFilePath, plainText, 'utf8');
    console.log(`Простой текст сохранен в: ${plainFilePath}`);
    
    const htmlFilePath = path.join(__dirname, 'document.html');
    fs.writeFileSync(htmlFilePath, htmlDocument, 'utf8');
    console.log(`HTML версия сохранена в: ${htmlFilePath}`);
    
    console.log(`Загрузка документа успешно завершена. Найдено песен: ${songCount}`);
  } catch (error) {
    console.error('Ошибка при загрузке документа:', error);
  }
}

// Запускаем функцию загрузки
fetchAndSaveDocument(); 