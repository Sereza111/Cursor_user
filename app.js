/**
 * Cursor Mass Register - Панель массовой регистрации аккаунтов Cursor AI
 * Главный файл сервера Express.js
 * 
 * Запуск: node app.js
 * URL: http://localhost:3000
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');

// Импорт модулей
const db = require('./database');
const CursorRegister = require('./cursorRegister');
const ClineRegister = require('./clineRegister');
const { generateFullName } = require('./nameGenerator');
const mailReader = require('./mailReader');

// Инициализация приложения
const app = express();
const PORT = process.env.PORT || 3000;

// Доверяем прокси (Nginx)
app.set('trust proxy', 1);

// База данных инициализируется асинхронно при запуске сервера

// Хранилище активных сессий обработки
const activeSessions = new Map();

// Middleware
app.use(helmet({
    contentSecurityPolicy: false // Для Bootstrap CDN
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// EJS шаблонизатор
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Сессии
app.use(session({
    secret: process.env.SESSION_SECRET || 'cursor-mass-register-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Для localhost
        maxAge: 24 * 60 * 60 * 1000 // 24 часа
    }
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 минута
    max: 60, // 60 запросов в минуту
    message: { error: 'Слишком много запросов, попробуйте позже' }
});
app.use('/api/', limiter);

// ==================== АВТОРИЗАЦИЯ ====================

/**
 * Middleware проверки авторизации
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.isAuthenticated) {
        return next();
    }
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    res.redirect('/login');
}

/**
 * Страница логина
 */
app.get('/login', (req, res) => {
    if (req.session?.isAuthenticated) {
        return res.redirect('/');
    }
    res.render('login', { error: null });
});

/**
 * Обработка логина
 */
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (username === adminUser && password === adminPass) {
        req.session.isAuthenticated = true;
        req.session.username = username;
        res.redirect('/');
    } else {
        res.render('login', { error: 'Неверный логин или пароль' });
    }
});

/**
 * Выход
 */
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ==================== СТРАНИЦЫ ====================

/**
 * Главная страница - панель регистрации
 */
app.get('/', requireAuth, (req, res) => {
    const sessions = db.getAllSessions();
    res.render('index', { 
        user: req.session.username,
        sessions 
    });
});

/**
 * Страница результатов сессии
 */
app.get('/session/:sessionId', requireAuth, (req, res) => {
    const { sessionId } = req.params;
    const sessionData = db.getSession(sessionId);
    
    if (!sessionData) {
        return res.status(404).render('error', { message: 'Сессия не найдена' });
    }
    
    const accounts = db.getSessionAccounts(sessionId);
    const stats = db.getSessionStats(sessionId);
    
    res.render('session', { 
        user: req.session.username,
        session: sessionData,
        accounts,
        stats
    });
});

// ==================== API ====================

/**
 * Парсинг списка аккаунтов
 */
function parseAccountsList(text) {
    const lines = text.split('\n')
        .map(line => line.trim())
        .filter(line => line && line.includes(':'));
    
    const accounts = [];
    
    for (const line of lines) {
        const [email, password] = line.split(':').map(s => s.trim());
        if (email && password && email.includes('@')) {
            accounts.push({ email, password });
        }
    }
    
    return accounts;
}

/**
 * Запуск регистрации аккаунтов
 */
app.post('/api/start', requireAuth, async (req, res) => {
    try {
        const { accounts: accountsText, mode = 'register', proxies = '', service = 'cursor' } = req.body;
        
        if (!accountsText || !accountsText.trim()) {
            return res.status(400).json({ error: 'Список аккаунтов пуст' });
        }
        
        // Парсим аккаунты
        const accounts = parseAccountsList(accountsText);
        
        if (accounts.length === 0) {
            return res.status(400).json({ error: 'Не найдено валидных аккаунтов в формате email:password' });
        }
        
        // Парсим прокси (если есть)
        const proxyList = proxies.split('\n')
            .map(p => p.trim())
            .filter(p => p);
        
        // Создаём сессию
        const sessionId = uuidv4();
        db.createSession(sessionId, accounts.length);
        db.addLog(sessionId, 'info', `Создана сессия [${service.toUpperCase()}]. Всего аккаунтов: ${accounts.length}`);
        
        // Добавляем аккаунты в БД с указанием типа сервиса
        for (const acc of accounts) {
            db.addAccount(sessionId, acc.email, acc.password, service);
        }
        
        // Запускаем обработку в фоне
        startProcessing(sessionId, mode, proxyList, service);
        
        res.json({ 
            success: true, 
            sessionId,
            totalAccounts: accounts.length,
            service
        });
        
    } catch (error) {
        console.error('Ошибка запуска:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Фоновая обработка аккаунтов
 * @param {string} sessionId - ID сессии
 * @param {string} mode - Режим (register/login)
 * @param {Array} proxies - Список прокси
 * @param {string} service - Тип сервиса (cursor/cline)
 */
async function startProcessing(sessionId, mode, proxies, service = 'cursor') {
    const delay = parseInt(process.env.REGISTER_DELAY) || 10000;
    const maxRetries = parseInt(process.env.MAX_RETRIES) || 3;
    
    // Создаём экземпляр регистратора в зависимости от сервиса
    let registrator;
    if (service === 'cline') {
        registrator = new ClineRegister(sessionId, proxies);
        db.addLog(sessionId, 'info', `🤖 Запуск CLINE авторизации через Microsoft`);
    } else {
        registrator = new CursorRegister(sessionId, proxies);
        db.addLog(sessionId, 'info', `🖱️ Запуск Cursor обработки в режиме: ${mode}`);
    }
    
    // Сохраняем в активные сессии
    activeSessions.set(sessionId, { 
        registrator, 
        isRunning: true,
        mode,
        service
    });
    
    try {
        // Получаем все аккаунты для обработки
        let pendingAccounts = db.getPendingAccounts(sessionId, 1000);
        let processed = 0;
        let successCount = 0;
        let failedCount = 0;
        
        for (const account of pendingAccounts) {
            // Проверяем, не остановлена ли сессия
            const sessionState = activeSessions.get(sessionId);
            if (!sessionState || !sessionState.isRunning) {
                db.addLog(sessionId, 'info', 'Сессия остановлена пользователем');
                break;
            }
            
            // Обрабатываем аккаунт с retry
            let retries = 0;
            let success = false;
            
            while (retries < maxRetries && !success) {
                try {
                    let result;
                    
                    if (service === 'cline') {
                        // CLINE - только авторизация через Microsoft
                        result = await registrator.loginWithMicrosoft(account.id, account.email, account.password);
                    } else {
                        // Cursor - регистрация или логин
                        result = await registrator.processAccount(account, mode);
                    }
                    
                    if (result.success) {
                        success = true;
                        successCount++;
                        db.addLog(sessionId, 'info', `✅ ${account.email} - успешно!`);
                    } else if (result.error?.includes('CAPTCHA') || result.error?.includes('rate') || result.error?.includes('2FA')) {
                        // Retry при определённых ошибках
                        retries++;
                        if (retries < maxRetries) {
                            db.addLog(sessionId, 'warning', `⏳ Retry ${retries}/${maxRetries} для ${account.email}`);
                            await new Promise(r => setTimeout(r, delay * 2));
                        }
                    } else {
                        // Другие ошибки - не retry
                        db.addLog(sessionId, 'error', `❌ ${account.email}: ${result.error || 'Неизвестная ошибка'}`);
                        break;
                    }
                } catch (err) {
                    retries++;
                    db.addLog(sessionId, 'error', `❌ Ошибка ${account.email}: ${err.message}`);
                }
            }
            
            if (!success) {
                failedCount++;
            }
            
            processed++;
            
            // Обновляем статистику сессии
            db.updateSession(sessionId, {
                processed,
                success_count: successCount,
                failed_count: failedCount
            });
            
            // Задержка между аккаунтами
            if (processed < pendingAccounts.length) {
                await new Promise(r => setTimeout(r, delay));
            }
        }
        
        // Завершаем сессию
        db.updateSession(sessionId, {
            status: 'completed',
            completed_at: new Date().toISOString()
        });
        db.addLog(sessionId, 'info', `🏁 Сессия завершена. Успешно: ${successCount}, Ошибок: ${failedCount}`);
        
    } catch (error) {
        db.addLog(sessionId, 'error', `💥 Критическая ошибка: ${error.message}`);
        db.updateSession(sessionId, {
            status: 'error',
            completed_at: new Date().toISOString()
        });
    } finally {
        activeSessions.delete(sessionId);
    }
}

/**
 * Остановка сессии
 */
app.post('/api/stop/:sessionId', requireAuth, (req, res) => {
    const { sessionId } = req.params;
    
    const sessionState = activeSessions.get(sessionId);
    if (sessionState) {
        sessionState.isRunning = false;
        db.stopSession(sessionId);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Сессия не найдена или уже завершена' });
    }
});

/**
 * Получение статуса сессии
 */
app.get('/api/status/:sessionId', requireAuth, (req, res) => {
    const { sessionId } = req.params;
    
    const sessionData = db.getSession(sessionId);
    if (!sessionData) {
        return res.status(404).json({ error: 'Сессия не найдена' });
    }
    
    const stats = db.getSessionStats(sessionId);
    const accounts = db.getSessionAccounts(sessionId);
    
    res.json({
        session: sessionData,
        stats,
        accounts
    });
});

/**
 * Получение логов сессии (SSE - Server-Sent Events)
 */
app.get('/api/logs/:sessionId', requireAuth, (req, res) => {
    const { sessionId } = req.params;
    
    // Настраиваем SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Отправляем начальные логи
    const logs = db.getSessionLogs(sessionId, 100);
    res.write(`data: ${JSON.stringify({ type: 'initial', logs })}\n\n`);
    
    // Polling для новых логов
    let lastLogId = logs.length > 0 ? logs[logs.length - 1].id : 0;
    
    const interval = setInterval(() => {
        const newLogs = db.getSessionLogs(sessionId, 100)
            .filter(l => l.id > lastLogId);
        
        if (newLogs.length > 0) {
            lastLogId = newLogs[newLogs.length - 1].id;
            res.write(`data: ${JSON.stringify({ type: 'update', logs: newLogs })}\n\n`);
        }
        
        // Проверяем статус сессии
        const sessionData = db.getSession(sessionId);
        if (sessionData && ['completed', 'stopped', 'error'].includes(sessionData.status)) {
            res.write(`data: ${JSON.stringify({ type: 'complete', status: sessionData.status })}\n\n`);
        }
    }, 1000);
    
    // Закрываем при отключении клиента
    req.on('close', () => {
        clearInterval(interval);
    });
});

/**
 * Получение логов (polling вариант)
 */
app.get('/api/logs-poll/:sessionId', requireAuth, (req, res) => {
    const { sessionId } = req.params;
    const { lastId = 0 } = req.query;
    
    const logs = db.getSessionLogs(sessionId, 100)
        .filter(l => l.id > parseInt(lastId));
    
    res.json({ logs });
});

/**
 * Универсальный экспорт с параметрами
 */
app.get('/api/export/:sessionId', requireAuth, async (req, res) => {
    const { sessionId } = req.params;
    const { format = 'csv', filter = 'all' } = req.query;
    
    let accounts = db.getSuccessAccountsForExport(sessionId);
    
    if (accounts.length === 0) {
        return res.status(404).json({ error: 'Нет успешных аккаунтов для экспорта' });
    }
    
    // Фильтрация по типу сервиса
    if (filter === 'cursor') {
        accounts = accounts.filter(a => a.service_type === 'cursor' || !a.service_type);
    } else if (filter === 'cline') {
        accounts = accounts.filter(a => a.service_type === 'cline');
    }
    
    const timestamp = Date.now();
    
    // Экспорт токенов (только для CLINE)
    if (format === 'tokens') {
        const tokensData = accounts
            .filter(acc => acc.access_token || acc.session_token)
            .map(acc => {
                const token = acc.access_token || acc.session_token;
                return `${acc.email}|${token}`;
            })
            .join('\n');
        
        if (!tokensData) {
            return res.status(404).json({ error: 'Нет аккаунтов с токенами' });
        }
        
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="tokens_${sessionId.substring(0, 8)}_${timestamp}.txt"`);
        return res.send(tokensData);
    }
    
    // TXT формат
    if (format === 'txt') {
        const text = accounts.map(acc => `${acc.email}:${acc.password}`).join('\n');
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="accounts_${sessionId.substring(0, 8)}_${timestamp}.txt"`);
        return res.send(text);
    }
    
    // CSV формат (по умолчанию)
    const exportDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
    }
    
    const filename = `accounts_${sessionId.substring(0, 8)}_${timestamp}.csv`;
    const filepath = path.join(exportDir, filename);
    
    const csvWriter = createObjectCsvWriter({
        path: filepath,
        header: [
            { id: 'email', title: 'Email' },
            { id: 'password', title: 'Password' },
            { id: 'service_type', title: 'Service' },
            { id: 'full_name', title: 'Name' },
            { id: 'trial_status', title: 'Trial Status' },
            { id: 'session_token', title: 'Session Token' },
            { id: 'access_token', title: 'Access Token' },
            { id: 'created_at', title: 'Created At' }
        ]
    });
    
    await csvWriter.writeRecords(accounts);
    
    res.download(filepath, filename, (err) => {
        if (err) console.error('Download error:', err);
        setTimeout(() => {
            try { fs.unlinkSync(filepath); } catch (e) {}
        }, 5000);
    });
});

/**
 * Удаление сессии
 */
app.delete('/api/session/:sessionId', requireAuth, (req, res) => {
    const { sessionId } = req.params;
    
    try {
        // Останавливаем если активна
        const sessionState = activeSessions.get(sessionId);
        if (sessionState) {
            sessionState.isRunning = false;
            activeSessions.delete(sessionId);
        }
        
        // Удаляем из БД
        db.deleteSessionData(sessionId);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Получение списка сессий
 */
app.get('/api/sessions', requireAuth, (req, res) => {
    const sessions = db.getAllSessions();
    res.json({ sessions });
});

// ==================== MAIL API ====================

/**
 * Тест подключения к почте
 */
app.post('/api/mail/test', requireAuth, async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    }
    
    try {
        const connected = await mailReader.testConnection(email, password);
        
        if (connected) {
            res.json({ 
                success: true, 
                message: `✅ Успешное подключение к ${email}`,
                host: mailReader.IMAP_HOST,
                port: mailReader.IMAP_PORT
            });
        } else {
            res.status(401).json({ 
                error: 'Не удалось подключиться. Проверьте логин/пароль.' 
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Получение писем от Cursor
 */
app.post('/api/mail/fetch', requireAuth, async (req, res) => {
    const { email, password, limit = 10 } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    }
    
    try {
        const emails = await mailReader.fetchCursorEmails(email, password, limit);
        
        res.json({ 
            success: true, 
            count: emails.length,
            emails: emails.map(e => ({
                from: e.from,
                subject: e.subject,
                date: e.date,
                code: e.code,
                hasCode: !!e.code
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Получение статуса IMAP конфигурации
 */
app.get('/api/mail/config', requireAuth, (req, res) => {
    const mailEnabled = process.env.MAIL_VERIFICATION_ENABLED === 'true';
    const mailPassword = process.env.MAIL_PASSWORD;
    
    res.json({
        enabled: mailEnabled,
        configured: !!mailPassword,
        host: mailReader.IMAP_HOST,
        port: mailReader.IMAP_PORT,
        waitTimeout: parseInt(process.env.MAIL_WAIT_TIMEOUT) || 120000,
        checkInterval: parseInt(process.env.MAIL_CHECK_INTERVAL) || 5000
    });
});

// ==================== ОШИБКИ ====================

/**
 * 404 - Страница не найдена
 */
app.use((req, res) => {
    res.status(404).render('error', { message: 'Страница не найдена' });
});

/**
 * Обработка ошибок
 */
app.use((err, req, res, next) => {
    console.error('Ошибка сервера:', err);
    res.status(500).render('error', { message: 'Внутренняя ошибка сервера' });
});

// ==================== ЗАПУСК ====================

// Асинхронный запуск с инициализацией БД
async function startServer() {
    try {
        // Инициализируем базу данных
        await db.initDatabase();
        
        // Запускаем сервер
        app.listen(PORT, () => {
            console.log('');
            console.log('╔═══════════════════════════════════════════════════════════╗');
            console.log('║                                                           ║');
            console.log('║      🚀 CURSOR MASS REGISTER PANEL                        ║');
            console.log('║                                                           ║');
            console.log(`║      Сервер запущен: http://localhost:${PORT}               ║`);
            console.log('║                                                           ║');
            console.log('║      Логин: admin / admin123 (измените в .env)           ║');
            console.log('║                                                           ║');
            console.log('╚═══════════════════════════════════════════════════════════╝');
            console.log('');
        });
    } catch (err) {
        console.error('❌ Ошибка запуска сервера:', err);
        process.exit(1);
    }
}

startServer();

// Очистка при завершении
process.on('SIGINT', () => {
    console.log('\n\n👋 Завершение работы...');
    
    // Останавливаем все активные сессии
    for (const [sessionId, session] of activeSessions) {
        session.isRunning = false;
        db.stopSession(sessionId);
    }
    
    process.exit(0);
});

module.exports = app;
