require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

/**
 * Извлекает ID документа из URL Google Docs
 * @param {string} url - URL документа Google Docs
 * @returns {string} - ID документа
 */
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

// Преобразование документа Google Docs в текст с сохранением форматирования
async function exportDocumentToText() {
  try {
    console.log('Инициализация Google API...');
    // Используем файл учетных данных напрямую
    const credentialsPath = path.join(__dirname, '..', 'Gosha IAM Admin.json');
    
    if (!fs.existsSync(credentialsPath)) {
      console.error('❌ Файл учетных данных Google API не найден:', credentialsPath);
      return;
    }
    
    console.log('✅ Найден файл учетных данных Google API');
    
    // Инициализация Google API
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/documents.readonly']
    });
    
    const docs = google.docs({ version: 'v1', auth });
    
    // Получаем URL документа из .env
    if (!process.env.SONGBOOK_URL) {
      console.error('❌ SONGBOOK_URL не указан в файле .env');
      return;
    }
    
    const url = process.env.SONGBOOK_URL;
    const documentId = getDocumentIdFromUrl(url);
    
    console.log(`Получение документа с ID: ${documentId}`);
    
    // Получаем содержимое документа
    const document = await docs.documents.get({
      documentId: documentId
    });
    
    if (!document || !document.data) {
      console.error('❌ Не удалось получить документ');
      return;
    }
    
    console.log(`✅ Документ успешно получен: "${document.data.title}"`);
    
    // Преобразование документа в текст с сохранением форматирования
    let formattedText = '';
    let plainText = '';
    
    // Проверка на наличие содержимого
    if (!document.data.body || !document.data.body.content) {
      console.error('❌ Документ не содержит текстового содержимого');
      return;
    }
    
    // Формируем заголовок в text файле
    formattedText += `ДОКУМЕНТ: ${document.data.title}\n`;
    formattedText += `==================================\n\n`;
    
    for (const element of document.data.body.content) {
      // Если это параграф
      if (element.paragraph) {
        const paragraph = element.paragraph;
        let paragraphText = '';
        let isList = false;
        let indentLevel = 0;
        
        // Форматируем в зависимости от типа параграфа
        if (paragraph.paragraphStyle) {
          // Заголовки
          if (paragraph.paragraphStyle.namedStyleType === 'TITLE') {
            // Формат для заголовков
            paragraphText += '\n';
          } else if (paragraph.paragraphStyle.namedStyleType === 'HEADING_1') {
            // Формат для подзаголовков уровня 1
            paragraphText += '\n';
          } else if (paragraph.paragraphStyle.namedStyleType === 'HEADING_2') {
            // Формат для подзаголовков уровня 2
            paragraphText += '\n';
          }
          
          // Отступы
          if (paragraph.paragraphStyle.indentFirstLine) {
            // Добавляем отступ для первой строки
            paragraphText += '    ';
          }
        }
        
        // Проверяем, является ли параграф элементом списка
        if (paragraph.bullet) {
          isList = true;
          // Получаем уровень вложенности списка
          indentLevel = paragraph.bullet.nestingLevel || 0;
          
          // Добавляем соответствующий отступ и маркер списка
          for (let i = 0; i < indentLevel; i++) {
            paragraphText += '  ';
          }
          
          // Определяем тип списка (нумерованный или маркированный)
          if (paragraph.bullet.listId) {
            // Для простоты используем дефис для всех элементов списка
            paragraphText += '- ';
          }
        }
        
        // Собираем текст параграфа
        if (paragraph.elements) {
          for (const element of paragraph.elements) {
            // Если это текстовый элемент
            if (element.textRun && element.textRun.content) {
              let text = element.textRun.content;
              
              // Форматирование текста (жирный, курсив и т.д.)
              if (element.textRun.textStyle) {
                const style = element.textRun.textStyle;
                
                // Добавляем соответствующие маркеры для форматирования
                if (style.bold) {
                  // Жирный
                  paragraphText += text;
                } else if (style.italic) {
                  // Курсив
                  paragraphText += text;
                } else if (style.underline) {
                  // Подчеркнутый
                  paragraphText += text;
                } else {
                  // Обычный текст
                  paragraphText += text;
                }
              } else {
                // Если нет стилей, просто добавляем текст
                paragraphText += text;
              }
            }
          }
        }
        
        // Добавляем текст параграфа в общий текст
        formattedText += paragraphText;
        
        // Также сохраняем простой текст
        plainText += paragraphText;
      }
      
      // Если это таблица, задать необходимые отступы и форматирование
      else if (element.table) {
        formattedText += '\n';
        // Можно добавить обработку таблиц, если это необходимо
      }
      
      // Если это горизонтальная линия
      else if (element.horizontalRule) {
        formattedText += '\n------------------------------\n';
      }
    }
    
    // Записываем форматированный текст в файл
    fs.writeFileSync(path.join(__dirname, 'document_formatted.txt'), formattedText);
    console.log('✅ Форматированный текст сохранен в document_formatted.txt');
    
    // Записываем простой текст в файл
    fs.writeFileSync(path.join(__dirname, 'document_plain.txt'), plainText);
    console.log('✅ Простой текст сохранен в document_plain.txt');
    
    return { formattedText, plainText };
  } catch (error) {
    console.error('❌ Ошибка при экспорте документа:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

// Выполняем экспорт документа
exportDocumentToText()
  .then(() => {
    console.log('✅ Экспорт документа завершен успешно');
  })
  .catch(error => {
    console.error('❌ Ошибка при экспорте документа:', error);
  }); 