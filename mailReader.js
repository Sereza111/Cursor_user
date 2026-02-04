/**
 * Модуль чтения почты через IMAP для получения кодов подтверждения Cursor
 */
const Imap = require('imap');
const { simpleParser } = require('mailparser');

// Настройки IMAP из переменных окружения
const IMAP_HOST = process.env.IMAP_HOST || 'imap.beget.com';
const IMAP_PORT = parseInt(process.env.IMAP_PORT) || 993;
const IMAP_TLS = process.env.IMAP_TLS !== 'false';
const MAIL_PASSWORD = process.env.MAIL_PASSWORD || '';

// Таймаут ожидания письма (мс)
const WAIT_TIMEOUT = parseInt(process.env.MAIL_WAIT_TIMEOUT) || 120000; // 2 минуты
// Интервал проверки почты (мс)
const CHECK_INTERVAL = parseInt(process.env.MAIL_CHECK_INTERVAL) || 5000; // 5 секунд

/**
 * Извлечь код подтверждения из текста письма
 * @param {string} text - Текст письма
 * @returns {string|null} - 6-значный код или null
 */
function extractVerificationCode(text) {
    if (!text) return null;
    
    // Ищем 6-значный код
    // Cursor обычно отправляет код в формате: "Your verification code is: 123456"
    // или просто 6 цифр подряд
    
    const patterns = [
        /verification\s*code[:\s]*(\d{6})/i,
        /code[:\s]*(\d{6})/i,
        /код[:\s]*(\d{6})/i,
        /(\d{6})/  // просто 6 цифр
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    
    return null;
}

/**
 * Получить последние письма от Cursor
 * @param {string} email - Email адрес
 * @param {string} password - Пароль от почты
 * @param {number} limit - Максимум писем для проверки
 * @param {function} logger - Функция логирования
 * @param {boolean} noFilter - Не фильтровать письма (для отладки)
 * @returns {Promise<Array>} - Массив писем
 */
function fetchCursorEmails(email, password, limit = 10, logger = null, noFilter = false) {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: email,
            password: password,
            host: IMAP_HOST,
            port: IMAP_PORT,
            tls: IMAP_TLS,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 10000,
            connTimeout: 10000
        });

        const messages = [];
        const allMessages = []; // Все письма без фильтра для отладки
        let resolved = false;

        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                try { imap.end(); } catch(e) {}
            }
        };

        imap.once('ready', () => {
            imap.openBox('INBOX', true, (err, box) => {
                if (err) {
                    cleanup();
                    return reject(err);
                }

                const totalMessages = box.messages.total;
                if (logger) logger(`[MAIL] 📥 Всего писем в INBOX: ${totalMessages}`);
                
                if (totalMessages === 0) {
                    cleanup();
                    return resolve([]);
                }

                // Получаем последние N писем
                const start = Math.max(1, totalMessages - limit + 1);
                const range = `${start}:${totalMessages}`;

                const fetch = imap.seq.fetch(range, {
                    bodies: '',
                    struct: true
                });

                let pending = 0;
                let fetchEnded = false;

                fetch.on('message', (msg, seqno) => {
                    pending++;
                    let rawEmail = Buffer.alloc(0);

                    msg.on('body', (stream) => {
                        const chunks = [];
                        stream.on('data', (chunk) => {
                            chunks.push(chunk);
                        });
                        stream.on('end', () => {
                            rawEmail = Buffer.concat(chunks);
                        });
                    });

                    msg.once('end', async () => {
                        try {
                            const parsed = await simpleParser(rawEmail);
                            
                            const fromAddress = parsed.from?.text?.toLowerCase() || '';
                            const subject = parsed.subject?.toLowerCase() || '';
                            
                            const textContent = parsed.text || '';
                            const htmlContent = parsed.html || '';
                            
                            // Убираем HTML теги для поиска кода
                            const plainText = htmlContent
                                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                                .replace(/<[^>]+>/g, ' ')
                                .replace(/&nbsp;/g, ' ')
                                .replace(/\s+/g, ' ');
                            
                            const code = extractVerificationCode(textContent) || 
                                        extractVerificationCode(plainText);
                            
                            const mailObj = {
                                seqno: seqno,
                                subject: parsed.subject || '(Без темы)',
                                from: parsed.from?.text || 'Неизвестно',
                                date: parsed.date || new Date(0),
                                text: textContent,
                                code: code
                            };
                            
                            // Сохраняем все письма для отладки
                            allMessages.push(mailObj);
                            
                            // Фильтруем письма от Cursor (более мягкий фильтр)
                            const isCursorEmail = 
                                fromAddress.includes('cursor') || 
                                fromAddress.includes('no-reply') ||
                                fromAddress.includes('noreply') ||
                                subject.includes('cursor') ||
                                subject.includes('verification') ||
                                subject.includes('verify') ||
                                subject.includes('code') ||
                                subject.includes('confirm') ||
                                subject.includes('подтвер');
                            
                            if (noFilter || isCursorEmail) {
                                messages.push(mailObj);
                            }
                        } catch (parseErr) {
                            console.error('[MAIL] Parse error:', parseErr.message);
                        }

                        pending--;
                        if (pending === 0 && fetchEnded) {
                            cleanup();
                            // Логируем все письма при первой проверке
                            if (logger && allMessages.length > 0) {
                                logger(`[MAIL] 📋 Последние письма в ящике:`);
                                allMessages.slice(0, 5).forEach((m, i) => {
                                    logger(`[MAIL]   ${i + 1}. От: ${m.from.substring(0, 40)}, Тема: ${(m.subject || '').substring(0, 30)}`);
                                });
                            }
                            // Сортируем по дате (новые первыми)
                            messages.sort((a, b) => b.date - a.date);
                            resolve(messages);
                        }
                    });
                });

                fetch.once('error', (err) => {
                    cleanup();
                    reject(err);
                });

                fetch.once('end', () => {
                    fetchEnded = true;
                    if (pending === 0) {
                        cleanup();
                        messages.sort((a, b) => b.date - a.date);
                        resolve(messages);
                    }
                });
            });
        });

        imap.once('error', (err) => {
            cleanup();
            reject(err);
        });

        imap.once('end', () => {
            if (!resolved) {
                resolved = true;
            }
        });

        imap.connect();
    });
}

/**
 * Ожидать письмо с кодом подтверждения от Cursor
 * @param {string} email - Email адрес для проверки
 * @param {string} password - Пароль от почты (если не указан, используется MAIL_PASSWORD из .env)
 * @param {Date} afterDate - Искать письма после этой даты
 * @param {function} logger - Функция логирования
 * @returns {Promise<string|null>} - Код подтверждения или null
 */
async function waitForVerificationCode(email, password = null, afterDate = null, logger = console.log) {
    const mailPassword = password || MAIL_PASSWORD;
    
    if (!mailPassword) {
        logger('[MAIL] ❌ Не указан пароль от почты (MAIL_PASSWORD в .env)');
        return null;
    }
    
    const startTime = Date.now();
    const searchAfter = afterDate || new Date(startTime - 60000); // За последнюю минуту
    
    logger(`[MAIL] 📧 Ожидаем письмо с кодом для ${email}...`);
    logger(`[MAIL] 🔑 Пароль: ${mailPassword.substring(0, 3)}***${mailPassword.substring(mailPassword.length - 2)}`);
    logger(`[MAIL] 🔗 IMAP: ${IMAP_HOST}:${IMAP_PORT}`);
    logger(`[MAIL] ⏱️ Таймаут: ${WAIT_TIMEOUT / 1000} сек, интервал проверки: ${CHECK_INTERVAL / 1000} сек`);
    logger(`[MAIL] 📅 Ищем письма после: ${searchAfter.toISOString()}`);
    
    let firstCheck = true;
    
    while (Date.now() - startTime < WAIT_TIMEOUT) {
        try {
            // Передаём logger только при первой проверке для вывода всех писем
            const emails = await fetchCursorEmails(email, mailPassword, 20, firstCheck ? logger : null);
            
            // При первой проверке выводим отфильтрованные письма
            if (firstCheck) {
                logger(`[MAIL] 📬 Найдено писем от Cursor/noreply: ${emails.length}`);
                if (emails.length > 0) {
                    emails.slice(0, 5).forEach((mail, i) => {
                        logger(`[MAIL]   ${i + 1}. От: ${mail.from}, Дата: ${mail.date.toISOString()}, Код: ${mail.code || 'нет'}`);
                    });
                }
                firstCheck = false;
            }
            
            // Ищем письмо с кодом, пришедшее после начала регистрации
            for (const mail of emails) {
                if (mail.code && mail.date > searchAfter) {
                    logger(`[MAIL] ✅ Найден код подтверждения: ${mail.code}`);
                    logger(`[MAIL] 📬 От: ${mail.from}`);
                    logger(`[MAIL] 📋 Тема: ${mail.subject}`);
                    return mail.code;
                }
            }
            
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            logger(`[MAIL] ⏳ Код не найден, прошло ${elapsed} сек...`);
            
        } catch (error) {
            logger(`[MAIL] ⚠️ Ошибка проверки почты: ${error.message}`);
            // Более подробная ошибка
            if (error.source === 'authentication') {
                logger(`[MAIL] ❌ Ошибка авторизации IMAP! Проверьте логин/пароль`);
            }
        }
        
        // Ждём перед следующей проверкой
        await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
    }
    
    logger(`[MAIL] ❌ Таймаут - письмо с кодом не получено за ${WAIT_TIMEOUT / 1000} сек`);
    return null;
}

/**
 * Проверить подключение к почте
 * @param {string} email - Email адрес
 * @param {string} password - Пароль
 * @returns {Promise<boolean>}
 */
async function testConnection(email, password) {
    return new Promise((resolve) => {
        const imap = new Imap({
            user: email,
            password: password,
            host: IMAP_HOST,
            port: IMAP_PORT,
            tls: IMAP_TLS,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 10000,
            connTimeout: 10000
        });

        imap.once('ready', () => {
            imap.end();
            resolve(true);
        });

        imap.once('error', () => {
            resolve(false);
        });

        imap.connect();
    });
}

module.exports = {
    fetchCursorEmails,
    waitForVerificationCode,
    extractVerificationCode,
    testConnection,
    IMAP_HOST,
    IMAP_PORT
};
