/**
 * Модуль базы данных SQLite (sql.js)
 * Управление аккаунтами и сессиями регистрации
 * Использует sql.js - чистый JavaScript SQLite (не требует компиляции)
 */

const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// Путь к базе данных
const DB_PATH = path.join(__dirname, 'db.sqlite');

// Глобальная переменная для БД
let db = null;
let SQL = null;

/**
 * Инициализация SQL.js и базы данных
 */
async function initDatabase() {
    // Инициализируем SQL.js
    SQL = await initSqlJs();
    
    // Пробуем загрузить существующую БД
    try {
        if (fs.existsSync(DB_PATH)) {
            const fileBuffer = fs.readFileSync(DB_PATH);
            db = new SQL.Database(fileBuffer);
            console.log('✅ База данных загружена из файла');
        } else {
            db = new SQL.Database();
            console.log('✅ Создана новая база данных');
        }
    } catch (err) {
        console.log('⚠️ Ошибка загрузки БД, создаём новую:', err.message);
        db = new SQL.Database();
    }

    // Создаём таблицы
    db.run(`
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            service_type TEXT DEFAULT 'cursor',
            email TEXT NOT NULL,
            password TEXT NOT NULL,
            password_hash TEXT,
            first_name TEXT,
            last_name TEXT,
            full_name TEXT,
            status TEXT DEFAULT 'pending',
            trial_status TEXT DEFAULT 'unknown',
            trial_days INTEGER DEFAULT 0,
            error_message TEXT,
            proxy_used TEXT,
            session_token TEXT,
            access_token TEXT,
            refresh_token TEXT,
            cookies_json TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            processing_time INTEGER DEFAULT 0
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            status TEXT DEFAULT 'running',
            total_accounts INTEGER DEFAULT 0,
            processed INTEGER DEFAULT 0,
            success_count INTEGER DEFAULT 0,
            failed_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            completed_at TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            level TEXT DEFAULT 'info',
            message TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Создаём индексы
    db.run(`CREATE INDEX IF NOT EXISTS idx_accounts_session ON accounts(session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_logs_session ON logs(session_id)`);

    // Миграции - добавляем недостающие колонки
    await runMigrations();

    // Сохраняем БД
    saveDatabase();
    
    console.log('✅ База данных инициализирована');
    return db;
}

/**
 * Миграции - добавление новых колонок к существующим таблицам
 */
async function runMigrations() {
    console.log('🔄 Проверка миграций БД...');
    
    // Получаем информацию о структуре таблицы accounts
    const tableInfo = db.exec("PRAGMA table_info(accounts)");
    const columns = tableInfo[0]?.values?.map(row => row[1]) || [];
    
    // Миграция: добавление service_type
    if (!columns.includes('service_type')) {
        console.log('📦 Миграция: добавление колонки service_type');
        try {
            db.run("ALTER TABLE accounts ADD COLUMN service_type TEXT DEFAULT 'cursor'");
            console.log('✅ Колонка service_type добавлена');
        } catch (err) {
            console.log('⚠️ service_type: ' + err.message);
        }
    }
    
    // Миграция: добавление access_token
    if (!columns.includes('access_token')) {
        console.log('📦 Миграция: добавление колонки access_token');
        try {
            db.run("ALTER TABLE accounts ADD COLUMN access_token TEXT");
            console.log('✅ Колонка access_token добавлена');
        } catch (err) {
            console.log('⚠️ access_token: ' + err.message);
        }
    }
    
    // Миграция: добавление refresh_token
    if (!columns.includes('refresh_token')) {
        console.log('📦 Миграция: добавление колонки refresh_token');
        try {
            db.run("ALTER TABLE accounts ADD COLUMN refresh_token TEXT");
            console.log('✅ Колонка refresh_token добавлена');
        } catch (err) {
            console.log('⚠️ refresh_token: ' + err.message);
        }
    }
    
    // Миграция: добавление cookies_json
    if (!columns.includes('cookies_json')) {
        console.log('📦 Миграция: добавление колонки cookies_json');
        try {
            db.run("ALTER TABLE accounts ADD COLUMN cookies_json TEXT");
            console.log('✅ Колонка cookies_json добавлена');
        } catch (err) {
            console.log('⚠️ cookies_json: ' + err.message);
        }
    }
    
    // Миграция: добавление session_token
    if (!columns.includes('session_token')) {
        console.log('📦 Миграция: добавление колонки session_token');
        try {
            db.run("ALTER TABLE accounts ADD COLUMN session_token TEXT");
            console.log('✅ Колонка session_token добавлена');
        } catch (err) {
            console.log('⚠️ session_token: ' + err.message);
        }
    }
    
    // Миграция: добавление cline_token (токен CLINE API)
    if (!columns.includes('cline_token')) {
        console.log('📦 Миграция: добавление колонки cline_token');
        try {
            db.run("ALTER TABLE accounts ADD COLUMN cline_token TEXT");
            console.log('✅ Колонка cline_token добавлена');
        } catch (err) {
            console.log('⚠️ cline_token: ' + err.message);
        }
    }
    
    // Миграция: добавление cline_balance (баланс CLINE)
    if (!columns.includes('cline_balance')) {
        console.log('📦 Миграция: добавление колонки cline_balance');
        try {
            db.run("ALTER TABLE accounts ADD COLUMN cline_balance REAL DEFAULT 0");
            console.log('✅ Колонка cline_balance добавлена');
        } catch (err) {
            console.log('⚠️ cline_balance: ' + err.message);
        }
    }
    
    // Миграция: добавление used (флаг использования токена)
    if (!columns.includes('used')) {
        console.log('📦 Миграция: добавление колонки used');
        try {
            db.run("ALTER TABLE accounts ADD COLUMN used INTEGER DEFAULT 0");
            console.log('✅ Колонка used добавлена');
        } catch (err) {
            console.log('⚠️ used: ' + err.message);
        }
    }
    
    // Миграция: добавление used_at (дата использования)
    if (!columns.includes('used_at')) {
        console.log('📦 Миграция: добавление колонки used_at');
        try {
            db.run("ALTER TABLE accounts ADD COLUMN used_at TEXT");
            console.log('✅ Колонка used_at добавлена');
        } catch (err) {
            console.log('⚠️ used_at: ' + err.message);
        }
    }
    
    console.log('✅ Миграции выполнены');
}

/**
 * Сохранение базы данных в файл
 */
function saveDatabase() {
    if (!db) return;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    } catch (err) {
        console.error('Ошибка сохранения БД:', err.message);
    }
}

/**
 * Выполнение SELECT запроса
 */
function query(sql, params = []) {
    if (!db) return [];
    try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    } catch (err) {
        console.error('Query error:', err.message);
        return [];
    }
}

/**
 * Выполнение INSERT/UPDATE запроса
 */
function run(sql, params = []) {
    if (!db) return null;
    try {
        db.run(sql, params);
        saveDatabase();
        return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] || 0 };
    } catch (err) {
        console.error('Run error:', err.message);
        return null;
    }
}

/**
 * Получение одной записи
 */
function get(sql, params = []) {
    const results = query(sql, params);
    return results[0] || null;
}

/**
 * Создание новой сессии регистрации
 */
function createSession(sessionId, totalAccounts) {
    run(
        `INSERT INTO sessions (id, total_accounts, status) VALUES (?, ?, 'running')`,
        [sessionId, totalAccounts]
    );
    return sessionId;
}

/**
 * Обновление статуса сессии
 */
function updateSession(sessionId, data) {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(data)) {
        fields.push(`${key} = ?`);
        values.push(value);
    }
    
    values.push(sessionId);
    
    run(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`, values);
}

/**
 * Получение информации о сессии
 */
function getSession(sessionId) {
    return get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
}

/**
 * Добавление аккаунта в очередь
 */
function addAccount(sessionId, email, password, serviceType = 'cursor') {
    const passwordHash = bcrypt.hashSync(password, 10);
    const result = run(
        `INSERT INTO accounts (session_id, service_type, email, password, password_hash, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
        [sessionId, serviceType, email, password, passwordHash]
    );
    return result?.lastInsertRowid || 0;
}

/**
 * Обновление информации об аккаунте
 */
function updateAccount(accountId, data) {
    const fields = [`updated_at = datetime('now')`];
    const values = [];
    
    for (const [key, value] of Object.entries(data)) {
        fields.push(`${key} = ?`);
        values.push(value);
    }
    
    values.push(accountId);
    
    run(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`, values);
}

/**
 * Получение аккаунта по ID
 */
function getAccount(accountId) {
    return get('SELECT * FROM accounts WHERE id = ?', [accountId]);
}

/**
 * Получение всех аккаунтов сессии
 */
function getSessionAccounts(sessionId) {
    return query('SELECT * FROM accounts WHERE session_id = ? ORDER BY id ASC', [sessionId]);
}

/**
 * Получение pending аккаунтов для обработки
 */
function getPendingAccounts(sessionId, limit = 10) {
    return query(
        `SELECT * FROM accounts WHERE session_id = ? AND status = 'pending' ORDER BY id ASC LIMIT ?`,
        [sessionId, limit]
    );
}

/**
 * Получение статистики сессии
 */
function getSessionStats(sessionId) {
    const result = get(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
            SUM(CASE WHEN trial_status = 'active' THEN 1 ELSE 0 END) as with_trial
        FROM accounts
        WHERE session_id = ?
    `, [sessionId]);
    
    return result || { total: 0, success: 0, failed: 0, pending: 0, processing: 0, with_trial: 0 };
}

/**
 * Добавление лога
 */
function addLog(sessionId, level, message) {
    run(
        `INSERT INTO logs (session_id, level, message) VALUES (?, ?, ?)`,
        [sessionId, level, message]
    );
}

/**
 * Получение логов сессии
 */
function getSessionLogs(sessionId, limit = 100) {
    const logs = query(
        `SELECT * FROM logs WHERE session_id = ? ORDER BY id DESC LIMIT ?`,
        [sessionId, limit]
    );
    return logs.reverse();
}

/**
 * Получение успешных аккаунтов с trial для экспорта
 */
function getSuccessAccountsForExport(sessionId) {
    return query(`
        SELECT email, password, first_name, last_name, full_name, 
               service_type, trial_status, trial_days, 
               session_token, access_token, refresh_token, cookies_json,
               created_at
        FROM accounts 
        WHERE session_id = ? AND status = 'success'
        ORDER BY id ASC
    `, [sessionId]);
}

/**
 * Получение всех успешных аккаунтов для экспорта (все типы)
 */
function getAllSuccessAccounts(sessionId) {
    return query(`
        SELECT * FROM accounts 
        WHERE session_id = ? AND status = 'success'
        ORDER BY id ASC
    `, [sessionId]);
}

/**
 * Получение всех сессий
 */
function getAllSessions() {
    return query(`
        SELECT s.*, 
               (SELECT COUNT(*) FROM accounts WHERE session_id = s.id AND status = 'success') as success_count,
               (SELECT COUNT(*) FROM accounts WHERE session_id = s.id AND status = 'failed') as failed_count
        FROM sessions s
        ORDER BY created_at DESC
        LIMIT 50
    `);
}

/**
 * Удаление старых данных (старше 7 дней)
 */
function cleanupOldData() {
    run(`DELETE FROM accounts WHERE created_at < datetime('now', '-7 days')`);
    run(`DELETE FROM sessions WHERE created_at < datetime('now', '-7 days')`);
    run(`DELETE FROM logs WHERE created_at < datetime('now', '-7 days')`);
    saveDatabase();
}

/**
 * Остановка сессии
 */
function stopSession(sessionId) {
    run(
        `UPDATE sessions SET status = 'stopped', completed_at = datetime('now') WHERE id = ?`,
        [sessionId]
    );
    run(
        `UPDATE accounts SET status = 'cancelled' WHERE session_id = ? AND status IN ('pending', 'processing')`,
        [sessionId]
    );
}

/**
 * Удаление данных сессии
 */
function deleteSessionData(sessionId) {
    run(`DELETE FROM accounts WHERE session_id = ?`, [sessionId]);
    run(`DELETE FROM logs WHERE session_id = ?`, [sessionId]);
    run(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
    saveDatabase();
}

/**
 * Получение объекта БД для прямых запросов
 */
function getDb() {
    return db;
}

// Экспорт функций
module.exports = {
    initDatabase,
    saveDatabase,
    getDb,
    createSession,
    updateSession,
    getSession,
    addAccount,
    updateAccount,
    getAccount,
    getSessionAccounts,
    getPendingAccounts,
    getSessionStats,
    addLog,
    getSessionLogs,
    getSuccessAccountsForExport,
    getAllSessions,
    cleanupOldData,
    stopSession,
    deleteSessionData,
    query,
    run,
    get
};
