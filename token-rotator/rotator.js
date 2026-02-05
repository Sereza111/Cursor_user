/**
 * CLINE Token Rotator
 * Автоматическая ротация токенов CLINE при низком балансе
 */

require('dotenv').config();
const keytar = require('keytar');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

// Конфигурация
const CONFIG = {
    // Сервис и аккаунт для keytar (VS Code SecretStorage)
    SERVICE_NAME: 'saoudrizwan.claude-dev',
    ACCOUNT_NAME: 'clineApiKey',
    
    // API CLINE
    CLINE_API_URL: 'https://api.cline.bot/api/user',
    
    // Панель регистрации
    PANEL_URL: process.env.PANEL_URL || 'http://109.172.37.69:3000',
    PANEL_USERNAME: process.env.PANEL_USERNAME || 'admin',
    PANEL_PASSWORD: process.env.PANEL_PASSWORD || 'admin123',
    
    // Порог баланса для ротации
    MIN_BALANCE: parseFloat(process.env.MIN_BALANCE || '0.1'),
    
    // База данных панели
    DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'db.sqlite')
};

/**
 * Получить текущий токен CLINE из VS Code SecretStorage
 */
async function getCurrentToken() {
    try {
        const token = await keytar.getPassword(CONFIG.SERVICE_NAME, CONFIG.ACCOUNT_NAME);
        return token;
    } catch (error) {
        console.error('❌ Ошибка получения токена из keytar:', error.message);
        return null;
    }
}

/**
 * Установить новый токен CLINE в VS Code SecretStorage
 */
async function setToken(token) {
    try {
        await keytar.setPassword(CONFIG.SERVICE_NAME, CONFIG.ACCOUNT_NAME, token);
        console.log('✅ Токен успешно установлен в VS Code');
        return true;
    } catch (error) {
        console.error('❌ Ошибка установки токена:', error.message);
        return false;
    }
}

/**
 * Проверить баланс токена через API CLINE
 */
async function checkBalance(token) {
    try {
        const response = await fetch(CONFIG.CLINE_API_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                console.log('⚠️ Токен невалидный или истёк');
                return { valid: false, balance: 0 };
            }
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        const balance = data.credits || data.balance || 0;
        
        console.log(`💰 Текущий баланс: ${balance} кредитов`);
        return { valid: true, balance, data };
        
    } catch (error) {
        console.error('❌ Ошибка проверки баланса:', error.message);
        return { valid: false, balance: 0 };
    }
}

/**
 * Получить новый токен из базы данных панели (sql.js)
 */
async function getNewTokenFromDB() {
    try {
        if (!fs.existsSync(CONFIG.DB_PATH)) {
            console.error('❌ База данных не найдена:', CONFIG.DB_PATH);
            return null;
        }
        
        const initSqlJs = require('sql.js');
        const SQL = await initSqlJs();
        const fileBuffer = fs.readFileSync(CONFIG.DB_PATH);
        const db = new SQL.Database(fileBuffer);
        
        // Ищем аккаунт с токеном CLINE и балансом > 0
        const stmt = db.prepare(`
            SELECT * FROM accounts 
            WHERE cline_token IS NOT NULL 
            AND cline_token != ''
            AND (cline_balance IS NULL OR cline_balance > 0)
            AND (used IS NULL OR used = 0)
            ORDER BY created_at DESC
            LIMIT 1
        `);
        
        let account = null;
        if (stmt.step()) {
            account = stmt.getAsObject();
        }
        stmt.free();
        db.close();
        
        if (account && account.cline_token) {
            console.log(`📧 Найден аккаунт: ${account.email}`);
            return {
                id: account.id,
                email: account.email,
                token: account.cline_token,
                balance: account.cline_balance
            };
        }
        
        console.log('⚠️ Нет доступных аккаунтов с токенами в базе');
        return null;
        
    } catch (error) {
        console.error('❌ Ошибка чтения базы данных:', error.message);
        return null;
    }
}

/**
 * Пометить аккаунт как использованный (sql.js)
 */
async function markAccountAsUsed(accountId) {
    try {
        const initSqlJs = require('sql.js');
        const SQL = await initSqlJs();
        const fileBuffer = fs.readFileSync(CONFIG.DB_PATH);
        const db = new SQL.Database(fileBuffer);
        
        db.run('UPDATE accounts SET used = 1, used_at = ? WHERE id = ?', 
            [new Date().toISOString(), accountId]);
        
        // Сохраняем изменения в файл
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(CONFIG.DB_PATH, buffer);
        
        db.close();
        console.log('✅ Аккаунт помечен как использованный');
        return true;
    } catch (error) {
        console.error('❌ Ошибка обновления базы:', error.message);
        return false;
    }
}

/**
 * Запросить новый аккаунт через API панели
 */
async function requestNewAccount() {
    try {
        console.log('🔄 Запрашиваем новый аккаунт через панель...');
        
        // Логин в панель
        const loginResponse = await fetch(`${CONFIG.PANEL_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: CONFIG.PANEL_USERNAME,
                password: CONFIG.PANEL_PASSWORD
            })
        });
        
        if (!loginResponse.ok) {
            throw new Error('Ошибка авторизации в панели');
        }
        
        const cookies = loginResponse.headers.get('set-cookie');
        
        // Запустить регистрацию CLINE
        const registerResponse = await fetch(`${CONFIG.PANEL_URL}/api/register-cline`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookies
            },
            body: JSON.stringify({ count: 1 })
        });
        
        if (!registerResponse.ok) {
            throw new Error('Ошибка запуска регистрации');
        }
        
        console.log('✅ Регистрация запущена, ожидайте новый токен в базе');
        return true;
        
    } catch (error) {
        console.error('❌ Ошибка запроса через панель:', error.message);
        return false;
    }
}

/**
 * Основная функция ротации
 */
async function rotateToken() {
    console.log('\n🔄 === CLINE Token Rotator ===\n');
    
    // 1. Получить текущий токен
    const currentToken = await getCurrentToken();
    
    if (!currentToken) {
        console.log('⚠️ Текущий токен не найден');
    } else {
        console.log('🔑 Текущий токен найден');
        
        // 2. Проверить баланс
        const { valid, balance } = await checkBalance(currentToken);
        
        if (valid && balance > CONFIG.MIN_BALANCE) {
            console.log(`\n✅ Баланс достаточный (${balance} > ${CONFIG.MIN_BALANCE})`);
            console.log('   Ротация не требуется\n');
            return { rotated: false, balance };
        }
        
        console.log(`\n⚠️ Баланс низкий или токен невалидный`);
    }
    
    // 3. Получить новый токен из базы
    console.log('\n🔍 Ищем новый токен в базе данных...');
    const newAccount = await getNewTokenFromDB();
    
    if (!newAccount) {
        console.log('⚠️ Нет доступных токенов, запрашиваем регистрацию...');
        await requestNewAccount();
        return { rotated: false, error: 'no_tokens' };
    }
    
    // 4. Проверить баланс нового токена
    console.log('\n🔍 Проверяем баланс нового токена...');
    const newBalance = await checkBalance(newAccount.token);
    
    if (!newBalance.valid || newBalance.balance <= 0) {
        console.log('⚠️ Новый токен тоже пустой, помечаем использованным');
        await markAccountAsUsed(newAccount.id);
        return rotateToken(); // Рекурсивно ищем следующий
    }
    
    // 5. Установить новый токен
    console.log('\n📝 Устанавливаем новый токен...');
    const success = await setToken(newAccount.token);
    
    if (success) {
        await markAccountAsUsed(newAccount.id);
        console.log(`\n✅ Ротация завершена!`);
        console.log(`   Email: ${newAccount.email}`);
        console.log(`   Баланс: ${newBalance.balance} кредитов\n`);
        
        // Перезагрузка VS Code для применения токена
        console.log('⚠️ Перезапустите VS Code для применения нового токена');
        
        return { rotated: true, email: newAccount.email, balance: newBalance.balance };
    }
    
    return { rotated: false, error: 'set_failed' };
}

/**
 * Только проверка баланса
 */
async function checkOnly() {
    console.log('\n🔍 === Проверка баланса ===\n');
    
    const token = await getCurrentToken();
    
    if (!token) {
        console.log('❌ Токен не найден');
        return null;
    }
    
    const { valid, balance, data } = await checkBalance(token);
    
    if (valid) {
        console.log(`\n📊 Информация об аккаунте:`);
        console.log(`   Email: ${data.email || 'N/A'}`);
        console.log(`   Баланс: ${balance} кредитов`);
        console.log(`   Статус: ${balance > 0 ? '✅ Активный' : '⚠️ Пустой'}\n`);
    }
    
    return { valid, balance, data };
}

// Запуск
const args = process.argv.slice(2);

if (args.includes('--check-only') || args.includes('-c')) {
    checkOnly();
} else {
    rotateToken().then(result => {
        process.exit(result.rotated || result.balance > 0 ? 0 : 1);
    });
}

module.exports = { rotateToken, checkOnly, getCurrentToken, setToken, checkBalance };
