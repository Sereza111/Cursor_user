/**
 * CLINE Local Token Rotator
 * ===========================
 * 
 * Этот скрипт запускается на ПК с VS Code и CLINE.
 * Он получает токены с удалённого сервера и устанавливает их в VS Code.
 * 
 * Как это работает:
 * 1. Скрипт проверяет текущий баланс CLINE через API
 * 2. Если баланс низкий - запрашивает новый токен с сервера
 * 3. Устанавливает новый токен в VS Code через keytar (SecretStorage)
 * 4. VS Code CLINE автоматически использует новый токен
 * 
 * Требования:
 * - Windows с VS Code и расширением CLINE
 * - Node.js 16+
 * - Доступ к серверу с панелью регистрации
 */

require('dotenv').config();
const fetch = require('node-fetch');
const keytar = require('keytar');

// ==================== КОНФИГУРАЦИЯ ====================

const CONFIG = {
    // Имя сервиса и аккаунта для VS Code SecretStorage
    SERVICE_NAME: 'saoudrizwan.claude-dev',
    ACCOUNT_NAME: 'clineApiKey',
    
    // CLINE API для проверки баланса
    CLINE_API_URL: 'https://api.cline.bot/api/user',
    
    // Сервер с панелью регистрации
    SERVER_URL: process.env.SERVER_URL || 'http://localhost:3000',
    API_KEY: process.env.API_KEY || '',
    
    // Минимальный баланс для замены
    MIN_BALANCE: parseFloat(process.env.MIN_BALANCE) || 0.10,
    
    // Режим отладки
    VERBOSE: process.env.VERBOSE === 'true'
};

// ==================== УТИЛИТЫ ====================

function log(message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = {
        'info': '📋',
        'success': '✅',
        'warning': '⚠️',
        'error': '❌',
        'debug': '🔍'
    }[level] || '•';
    
    if (level === 'debug' && !CONFIG.VERBOSE) return;
    
    console.log(`[${timestamp}] ${prefix} ${message}`);
}

// ==================== РАБОТА С VS CODE SECRET STORAGE ====================

/**
 * Получить текущий токен из VS Code
 */
async function getCurrentToken() {
    try {
        const token = await keytar.getPassword(CONFIG.SERVICE_NAME, CONFIG.ACCOUNT_NAME);
        if (token) {
            log(`Текущий токен найден (${token.substring(0, 20)}...)`, 'debug');
        } else {
            log('Токен не найден в VS Code', 'warning');
        }
        return token;
    } catch (err) {
        log(`Ошибка чтения токена: ${err.message}`, 'error');
        return null;
    }
}

/**
 * Установить новый токен в VS Code
 */
async function setNewToken(token) {
    try {
        await keytar.setPassword(CONFIG.SERVICE_NAME, CONFIG.ACCOUNT_NAME, token);
        log('Новый токен установлен в VS Code!', 'success');
        return true;
    } catch (err) {
        log(`Ошибка установки токена: ${err.message}`, 'error');
        return false;
    }
}

// ==================== РАБОТА С CLINE API ====================

/**
 * Проверить баланс текущего токена через CLINE API
 */
async function checkBalance(token) {
    if (!token) {
        return { success: false, balance: 0, error: 'Токен не указан' };
    }
    
    try {
        const response = await fetch(CONFIG.CLINE_API_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                return { success: false, balance: 0, error: 'Токен недействителен' };
            }
            return { success: false, balance: 0, error: `HTTP ${response.status}` };
        }
        
        const data = await response.json();
        const balance = data.credits || data.balance || 0;
        
        log(`Текущий баланс: $${balance.toFixed(2)}`, 'info');
        
        return { success: true, balance, email: data.email };
        
    } catch (err) {
        log(`Ошибка проверки баланса: ${err.message}`, 'error');
        return { success: false, balance: 0, error: err.message };
    }
}

// ==================== РАБОТА С СЕРВЕРОМ ====================

/**
 * Получить новый токен с сервера
 */
async function fetchNewTokenFromServer() {
    if (!CONFIG.API_KEY) {
        log('API_KEY не настроен! Добавьте его в .env', 'error');
        return null;
    }
    
    const url = `${CONFIG.SERVER_URL}/api/token/fetch`;
    
    log(`Запрос нового токена с сервера: ${CONFIG.SERVER_URL}`, 'info');
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'X-API-Key': CONFIG.API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            log(`Сервер: ${data.error || 'Неизвестная ошибка'}`, 'error');
            return null;
        }
        
        log(`Получен токен: ${data.email} (баланс: $${data.balance || '?'})`, 'success');
        
        return data.token;
        
    } catch (err) {
        log(`Ошибка подключения к серверу: ${err.message}`, 'error');
        return null;
    }
}

// ==================== ОСНОВНАЯ ЛОГИКА ====================

/**
 * Проверка и ротация токена (если нужно)
 */
async function checkAndRotate() {
    console.log('\n' + '='.repeat(50));
    log('CLINE Local Token Rotator', 'info');
    console.log('='.repeat(50) + '\n');
    
    // 1. Получаем текущий токен из VS Code
    const currentToken = await getCurrentToken();
    
    if (!currentToken) {
        log('В VS Code нет токена, получаем новый...', 'warning');
        const newToken = await fetchNewTokenFromServer();
        if (newToken) {
            await setNewToken(newToken);
            log('Токен успешно установлен! Перезапустите VS Code.', 'success');
        }
        return;
    }
    
    // 2. Проверяем баланс
    const { success, balance, error } = await checkBalance(currentToken);
    
    if (!success) {
        log(`Проблема с текущим токеном: ${error}`, 'warning');
        log('Получаем новый токен...', 'info');
        
        const newToken = await fetchNewTokenFromServer();
        if (newToken) {
            await setNewToken(newToken);
            log('Токен заменён! Перезапустите VS Code.', 'success');
        }
        return;
    }
    
    // 3. Проверяем нужна ли замена
    if (balance < CONFIG.MIN_BALANCE) {
        log(`Баланс $${balance.toFixed(2)} ниже минимума $${CONFIG.MIN_BALANCE}`, 'warning');
        log('Получаем новый токен...', 'info');
        
        const newToken = await fetchNewTokenFromServer();
        if (newToken) {
            await setNewToken(newToken);
            
            // Проверяем баланс нового токена
            const newBalance = await checkBalance(newToken);
            if (newBalance.success) {
                log(`Новый баланс: $${newBalance.balance.toFixed(2)}`, 'success');
            }
            
            log('Токен заменён! Перезапустите VS Code для применения.', 'success');
        }
    } else {
        log(`Баланс в норме ($${balance.toFixed(2)} >= $${CONFIG.MIN_BALANCE}). Замена не требуется.`, 'success');
    }
}

/**
 * Только проверка баланса (без замены)
 */
async function checkOnly() {
    console.log('\n' + '='.repeat(50));
    log('Проверка баланса CLINE', 'info');
    console.log('='.repeat(50) + '\n');
    
    const currentToken = await getCurrentToken();
    
    if (!currentToken) {
        log('Токен не найден в VS Code', 'error');
        return;
    }
    
    const { success, balance, email, error } = await checkBalance(currentToken);
    
    if (success) {
        console.log('\n📊 Информация о токене:');
        console.log(`   Email: ${email || 'N/A'}`);
        console.log(`   Баланс: $${balance.toFixed(2)}`);
        console.log(`   Минимум: $${CONFIG.MIN_BALANCE}`);
        console.log(`   Статус: ${balance >= CONFIG.MIN_BALANCE ? '✅ OK' : '⚠️ Требуется замена'}`);
    } else {
        log(`Ошибка: ${error}`, 'error');
    }
}

// ==================== ЗАПУСК ====================

async function main() {
    // Проверяем конфигурацию
    if (!CONFIG.SERVER_URL) {
        log('SERVER_URL не настроен!', 'error');
        process.exit(1);
    }
    
    console.log('\n🔧 Конфигурация:');
    console.log(`   Сервер: ${CONFIG.SERVER_URL}`);
    console.log(`   API Key: ${CONFIG.API_KEY ? '***настроен***' : '❌ НЕ НАСТРОЕН'}`);
    console.log(`   Мин. баланс: $${CONFIG.MIN_BALANCE}`);
    
    // Проверяем режим запуска
    const args = process.argv.slice(2);
    
    if (args.includes('--check-only') || args.includes('-c')) {
        await checkOnly();
    } else {
        await checkAndRotate();
    }
    
    console.log('\n');
}

// Запуск
main().catch(err => {
    log(`Критическая ошибка: ${err.message}`, 'error');
    process.exit(1);
});

// Экспорт для daemon.js
module.exports = { checkAndRotate, checkOnly, checkBalance, getCurrentToken };
