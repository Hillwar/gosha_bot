require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const util = require('util');

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

/**
 * Генерирует детальную информацию о стиле текста
 * @param {Object} textStyle - Стиль текста из Google Docs API
 * @returns {Object} - Структурированные данные о стиле
 */
function analyzeTextStyle(textStyle) {
  if (!textStyle) return {};
  
  const style = {
    bold: textStyle.bold || false,
    italic: textStyle.italic || false,
    underline: textStyle.underline || false,
    strikethrough: textStyle.strikethrough || false,
    smallCaps: textStyle.smallCaps || false,
    backgroundColor: textStyle.backgroundColor ? {
      color: textStyle.backgroundColor.color || null
    } : null,
    foregroundColor: textStyle.foregroundColor ? {
      color: textStyle.foregroundColor.color || null
    } : null,
    fontSize: textStyle.fontSize ? {
      magnitude: textStyle.fontSize.magnitude || null,
      unit: textStyle.fontSize.unit || null
    } : null,
    weightedFontFamily: textStyle.weightedFontFamily ? {
      fontFamily: textStyle.weightedFontFamily.fontFamily || null,
      weight: textStyle.weightedFontFamily.weight || null
    } : null,
    baselineOffset: textStyle.baselineOffset || null,
    link: textStyle.link ? textStyle.link.url || null : null
  };
  
  return style;
}

/**
 * Анализирует стиль параграфа
 * @param {Object} paragraphStyle - Стиль параграфа из Google Docs API
 * @returns {Object} - Структурированные данные о стиле параграфа
 */
function analyzeParagraphStyle(paragraphStyle) {
  if (!paragraphStyle) return {};
  
  const style = {
    namedStyleType: paragraphStyle.namedStyleType || null,
    alignment: paragraphStyle.alignment || null,
    direction: paragraphStyle.direction || null,
    indentFirstLine: paragraphStyle.indentFirstLine ? {
      magnitude: paragraphStyle.indentFirstLine.magnitude || null,
      unit: paragraphStyle.indentFirstLine.unit || null
    } : null,
    indentStart: paragraphStyle.indentStart ? {
      magnitude: paragraphStyle.indentStart.magnitude || null,
      unit: paragraphStyle.indentStart.unit || null
    } : null,
    indentEnd: paragraphStyle.indentEnd ? {
      magnitude: paragraphStyle.indentEnd.magnitude || null,
      unit: paragraphStyle.indentEnd.unit || null
    } : null,
    spaceAbove: paragraphStyle.spaceAbove ? {
      magnitude: paragraphStyle.spaceAbove.magnitude || null,
      unit: paragraphStyle.spaceAbove.unit || null
    } : null,
    spaceBelow: paragraphStyle.spaceBelow ? {
      magnitude: paragraphStyle.spaceBelow.magnitude || null,
      unit: paragraphStyle.spaceBelow.unit || null
    } : null,
    keepLinesTogether: paragraphStyle.keepLinesTogether || false,
    keepWithNext: paragraphStyle.keepWithNext || false,
    avoidWidowAndOrphan: paragraphStyle.avoidWidowAndOrphan || false,
    shading: paragraphStyle.shading ? {
      backgroundColor: paragraphStyle.shading.backgroundColor || null
    } : null
  };
  
  return style;
}

/**
 * Определяет тип контента элемента
 * @param {Object} element - Элемент документа из Google Docs API
 * @returns {string} - Тип контента
 */
function determineContentType(element) {
  if (!element) return 'unknown';
  
  if (element.paragraph) {
    if (element.paragraph.paragraphStyle) {
      const styleType = element.paragraph.paragraphStyle.namedStyleType;
      if (styleType === 'TITLE') return 'title';
      if (styleType === 'HEADING_1') return 'heading1';
      if (styleType === 'HEADING_2') return 'heading2';
      if (styleType === 'HEADING_3') return 'heading3';
      if (styleType === 'HEADING_4') return 'heading4';
      if (styleType === 'HEADING_5') return 'heading5';
      if (styleType === 'HEADING_6') return 'heading6';
      if (styleType === 'SUBTITLE') return 'subtitle';
    }
    
    if (element.paragraph.bullet) {
      return 'list-item';
    }
    
    return 'paragraph';
  }
  
  if (element.table) return 'table';
  if (element.tableOfContents) return 'table-of-contents';
  if (element.sectionBreak) return 'section-break';
  if (element.horizontalRule) return 'horizontal-rule';
  if (element.pageBreak) return 'page-break';
  if (element.footnote) return 'footnote';
  
  return 'unknown';
}

/**
 * Преобразует характеристики элемента в строку для отображения
 * @param {Object} elementDetails - Характеристики элемента
 * @returns {string} - Форматированная строка с характеристиками
 */
function formatElementProperties(elementDetails) {
  if (!elementDetails) return '';
  
  let output = '';
  
  // Добавляем тип контента
  if (elementDetails.contentType) {
    output += `ТИП: ${elementDetails.contentType}\n`;
  }
  
  // Добавляем информацию о стиле параграфа, если есть
  if (elementDetails.paragraphStyle && Object.keys(elementDetails.paragraphStyle).length > 0) {
    output += 'СТИЛЬ ПАРАГРАФА:\n';
    for (const [key, value] of Object.entries(elementDetails.paragraphStyle)) {
      if (value !== null && value !== undefined && value !== false) {
        if (typeof value === 'object') {
          output += `  ${key}: ${JSON.stringify(value)}\n`;
        } else {
          output += `  ${key}: ${value}\n`;
        }
      }
    }
  }
  
  // Добавляем информацию о стиле текста, если есть
  if (elementDetails.textStyle && Object.keys(elementDetails.textStyle).length > 0) {
    output += 'СТИЛЬ ТЕКСТА:\n';
    for (const [key, value] of Object.entries(elementDetails.textStyle)) {
      if (value !== null && value !== undefined && value !== false) {
        if (typeof value === 'object') {
          output += `  ${key}: ${JSON.stringify(value)}\n`;
        } else {
          output += `  ${key}: ${value}\n`;
        }
      }
    }
  }
  
  // Добавляем специальные символы и отступы, если они есть
  if (elementDetails.specialChars && elementDetails.specialChars.length > 0) {
    output += 'СПЕЦИАЛЬНЫЕ СИМВОЛЫ:\n';
    for (const char of elementDetails.specialChars) {
      output += `  ${char.position}: ${char.char} (${char.codePoint})\n`;
    }
  }
  
  if (elementDetails.indentLevel && elementDetails.indentLevel > 0) {
    output += `ОТСТУП: ${elementDetails.indentLevel}\n`;
  }
  
  return output;
}

// Детальный анализ документа
async function analyzeDocumentInDetail() {
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
    
    // Детальный анализ документа
    const documentDetails = {
      title: document.data.title,
      documentStyle: document.data.documentStyle || {},
      namedStyles: document.data.namedStyles || {},
      inlineObjects: document.data.inlineObjects || {},
      lists: document.data.lists || {},
      elements: []
    };
    
    // Сохраняем полную структуру документа в отдельный файл
    fs.writeFileSync(
      path.join(__dirname, 'document_full_structure.json'),
      JSON.stringify(document.data, null, 2)
    );
    console.log('✅ Полная структура документа сохранена в document_full_structure.json');
    
    // Анализ содержимого документа
    if (!document.data.body || !document.data.body.content) {
      console.error('❌ Документ не содержит текстового содержимого');
      return;
    }
    
    // Анализируем статистику по типам контента
    const contentTypeCounts = {};
    const styleTypeCounts = {};
    const fontCounts = {};
    const colorCounts = {};
    const specialCharCounts = {};
    let pageCount = 1;
    
    // Подробный анализ форматирования
    let detailedFormattingText = `ДЕТАЛЬНЫЙ АНАЛИЗ ДОКУМЕНТА "${document.data.title}"\n`;
    detailedFormattingText += `=========================================\n\n`;
    
    // Анализ стилей документа
    detailedFormattingText += `СТИЛИ ДОКУМЕНТА:\n`;
    detailedFormattingText += `-------------------------\n`;
    
    if (document.data.namedStyles && document.data.namedStyles.styles) {
      for (const style of document.data.namedStyles.styles) {
        detailedFormattingText += `Стиль: ${style.namedStyleType}\n`;
        if (style.paragraphStyle) {
          detailedFormattingText += `  Параграф: ${JSON.stringify(style.paragraphStyle, null, 2)}\n`;
        }
        if (style.textStyle) {
          detailedFormattingText += `  Текст: ${JSON.stringify(style.textStyle, null, 2)}\n`;
        }
        detailedFormattingText += `\n`;
      }
    } else {
      detailedFormattingText += `Стили не определены\n\n`;
    }
    
    // Анализ элементов
    detailedFormattingText += `\nАНАЛИЗ ЭЛЕМЕНТОВ:\n`;
    detailedFormattingText += `-------------------------\n\n`;
    
    // Проходим по каждому элементу содержимого
    for (let i = 0; i < document.data.body.content.length; i++) {
      const element = document.data.body.content[i];
      const contentType = determineContentType(element);
      contentTypeCounts[contentType] = (contentTypeCounts[contentType] || 0) + 1;
      
      const elementDetails = {
        index: i,
        contentType: contentType,
        pageNumber: pageCount,
        paragraphStyle: {},
        textStyle: {},
        specialChars: [],
        indentLevel: 0,
        text: '',
        rawElement: element
      };
      
      // Определяем разрывы страниц
      if (element.sectionBreak || 
          (element.paragraph && 
           element.paragraph.elements && 
           element.paragraph.elements.some(el => el.pageBreak))) {
        pageCount++;
      }
      
      // Анализ параграфа
      if (element.paragraph) {
        const paragraph = element.paragraph;
        
        // Анализ стиля параграфа
        if (paragraph.paragraphStyle) {
          elementDetails.paragraphStyle = analyzeParagraphStyle(paragraph.paragraphStyle);
          
          // Подсчет типов стилей
          const styleType = paragraph.paragraphStyle.namedStyleType || 'NORMAL_TEXT';
          styleTypeCounts[styleType] = (styleTypeCounts[styleType] || 0) + 1;
        }
        
        // Анализ элементов списка
        if (paragraph.bullet) {
          elementDetails.indentLevel = paragraph.bullet.nestingLevel || 0;
        }
        
        // Анализ текстовых элементов
        if (paragraph.elements) {
          let paragraphText = '';
          
          for (let j = 0; j < paragraph.elements.length; j++) {
            const textElement = paragraph.elements[j];
            
            // Проверка на разрыв страницы
            if (textElement.pageBreak) {
              pageCount++;
            }
            
            // Анализ текстового элемента
            if (textElement.textRun) {
              const text = textElement.textRun.content;
              paragraphText += text;
              
              // Анализ стиля текста
              if (textElement.textRun.textStyle) {
                elementDetails.textStyle = analyzeTextStyle(textElement.textRun.textStyle);
                
                // Подсчет шрифтов
                if (textElement.textRun.textStyle.weightedFontFamily) {
                  const fontFamily = textElement.textRun.textStyle.weightedFontFamily.fontFamily || 'Default';
                  fontCounts[fontFamily] = (fontCounts[fontFamily] || 0) + 1;
                }
                
                // Подсчет цветов
                if (textElement.textRun.textStyle.foregroundColor) {
                  const color = JSON.stringify(textElement.textRun.textStyle.foregroundColor);
                  colorCounts[color] = (colorCounts[color] || 0) + 1;
                }
              }
              
              // Анализ специальных символов
              for (let k = 0; k < text.length; k++) {
                const char = text[k];
                const codePoint = char.codePointAt(0);
                // Находим необычные символы (не буквы, цифры или распространенные знаки)
                if ((codePoint < 32 || codePoint > 126) && codePoint !== 10 && codePoint !== 13) {
                  elementDetails.specialChars.push({
                    position: k,
                    char: char,
                    codePoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
                  });
                  
                  specialCharCounts[codePoint] = (specialCharCounts[codePoint] || 0) + 1;
                }
              }
            }
          }
          
          elementDetails.text = paragraphText;
        }
      }
      // Анализ таблиц
      else if (element.table) {
        elementDetails.rows = element.table.rows?.length || 0;
        elementDetails.columns = element.table.rows?.[0]?.tableCells?.length || 0;
      }
      
      documentDetails.elements.push(elementDetails);
      
      // Добавляем информацию о текущем элементе в форматированный текст
      detailedFormattingText += `ЭЛЕМЕНТ #${i + 1} (страница ${pageCount}):\n`;
      detailedFormattingText += `${formatElementProperties(elementDetails)}\n`;
      
      if (elementDetails.text) {
        // Экранируем текст для лучшей читаемости
        const displayText = elementDetails.text
          .replace(/\n/g, '\\n')  // Заменяем переносы строк
          .replace(/\r/g, '\\r')  // Заменяем возвраты каретки
          .replace(/\t/g, '\\t'); // Заменяем табуляции
          
        detailedFormattingText += `ТЕКСТ: "${displayText}"\n`;
      }
      
      detailedFormattingText += `-------------------------\n\n`;
    }
    
    // Добавляем статистику
    detailedFormattingText += `\nСТАТИСТИКА ДОКУМЕНТА:\n`;
    detailedFormattingText += `-------------------------\n`;
    detailedFormattingText += `Количество страниц: ${pageCount}\n`;
    detailedFormattingText += `Количество элементов: ${document.data.body.content.length}\n\n`;
    
    detailedFormattingText += `Типы контента:\n`;
    for (const [type, count] of Object.entries(contentTypeCounts)) {
      detailedFormattingText += `  ${type}: ${count}\n`;
    }
    
    detailedFormattingText += `\nТипы стилей:\n`;
    for (const [style, count] of Object.entries(styleTypeCounts)) {
      detailedFormattingText += `  ${style}: ${count}\n`;
    }
    
    detailedFormattingText += `\nШрифты:\n`;
    for (const [font, count] of Object.entries(fontCounts)) {
      detailedFormattingText += `  ${font}: ${count}\n`;
    }
    
    detailedFormattingText += `\nСпециальные символы:\n`;
    for (const [codePoint, count] of Object.entries(specialCharCounts)) {
      const char = String.fromCodePoint(parseInt(codePoint));
      const hexCode = `U+${parseInt(codePoint).toString(16).toUpperCase().padStart(4, '0')}`;
      detailedFormattingText += `  ${char} (${hexCode}): ${count}\n`;
    }
    
    // Записываем детальное форматирование в файл
    fs.writeFileSync(path.join(__dirname, 'document_detailed_formatting.txt'), detailedFormattingText);
    console.log('✅ Детальное форматирование сохранено в document_detailed_formatting.txt');
    
    // Записываем документ с детальным анализом в JSON файл
    fs.writeFileSync(
      path.join(__dirname, 'document_detailed_analysis.json'), 
      JSON.stringify(documentDetails, null, 2)
    );
    console.log('✅ Детальный анализ документа сохранен в document_detailed_analysis.json');
    
    return documentDetails;
  } catch (error) {
    console.error('❌ Ошибка при анализе документа:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

// Выполняем анализ документа
analyzeDocumentInDetail()
  .then(() => {
    console.log('✅ Анализ документа завершен успешно');
  })
  .catch(error => {
    console.error('❌ Ошибка при анализе документа:', error);
  }); 