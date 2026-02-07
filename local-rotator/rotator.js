/**
 * CLINE Local Token Rotator v3
 * =============================
 * 
 * Этот скрипт запускается на ПК с VS Code и CLINE.
 * Он получает API KEY с сервера и устанавливает его в VS Code.
 * 
 * Как это работает:
 * 1. Скрипт получает API KEY с сервера панели
 * 2. Проверяет баланс через CLINE API
 * 3. Устанавливает API key в VS Code через keytar (SecretStorage)
 * 4. VS Code CLINE автоматически использует новый токен
 * 
 * ВАЖНО: Теперь сервер сразу получает API KEY при регистрации,
 * поэтому Puppeteer не нужен!
 * 
 * Требования:
 * - Windows с VS Code и расширением CLINE
 * - Node.js 18+
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
    
    // Минимальный баланс для замены (в долларах)
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
 * Получить текущий API key из VS Code
 */
async function getCurrentApiKey() {
    try {
        const apiKey = await keytar.getPassword(CONFIG.SERVICE_NAME, CONFIG.ACCOUNT_NAME);
        if (apiKey) {
            log(`Текущий API key: ${apiKey.substring(0, 20)}...`, 'debug');
        } else {
            log('API key не найден в VS Code', 'warning');
        }
        return apiKey;
    } catch (err) {
        log(`Ошибка чтения API key: ${err.message}`, 'error');
        return null;
    }
}

/**
 * Установить новый API key в VS Code
 */
async function setNewApiKey(apiKey) {
    try {
        await keytar.setPassword(CONFIG.SERVICE_NAME, CONFIG.ACCOUNT_NAME, apiKey);
        log('Новый API key установлен в VS Code!', 'success');
        return true;
    } catch (err) {
        log(`Ошибка установки API key: ${err.message}`, 'error');
        return false;
    }
}

// ==================== РАБОТА С CLINE API ====================

/**
 * Проверить баланс API key через CLINE API
 */
async function checkBalance(apiKey) {
    if (!apiKey) {
        return { success: false, balance: 0, error: 'API key не указан' };
    }
    
    // Проверяем формат - должен быть API KEY, а не JSON cookies
    if (apiKey.startsWith('[') || apiKey.startsWith('{')) {
        log('Токен является cookies, а не API KEY', 'warning');
        return { success: false, balance: 0, error: 'Токен является cookies, требуется API KEY' };
    }
    
    try {
        const response = await fetch(CONFIG.CLINE_API_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                return { success: false, balance: 0, error: 'API key недействителен' };
            }
            return { success: false, balance: 0, error: `HTTP ${response.status}` };
        }
        
        const data = await response.json();
        const balance = data.credits || data.balance || 0;
        
        log(`Баланс: $${balance.toFixed(4)}`, 'info');
        
        return { success: true, balance, email: data.email };
        
    } catch (err) {
        log(`Ошибка проверки баланса: ${err.message}`, 'error');
        return { success: false, balance: 0, error: err.message };
    }
}

// ==================== РАБОТА С СЕРВЕРОМ ====================

/**
 * Получить API KEY с сервера
 */
async function fetchApiKeyFromServer() {
    if (!CONFIG.API_KEY) {
        log('API_KEY не настроен! Добавьте его в .env', 'error');
        return null;
    }
    
    const url = `${CONFIG.SERVER_URL}/api/token/fetch`;
    
    log(`Запрос API KEY с сервера: ${CONFIG.SERVER_URL}`, 'info');
    
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
        
        const token = data.token;
        
        // Проверяем что это API KEY, а не cookies
        if (!token) {
            log('Сервер вернул пустой токен', 'error');
            return null;
        }
        
        if (token.startsWith('[') || token.startsWith('{')) {
            log('⚠️ Сервер вернул COOKIES вместо API KEY!', 'warning');
            log('Аккаунт был зарегистрирован до обновления - API KEY недоступен', 'warning');
            log('Нужно зарегистрировать новый аккаунт', 'warning');
            return null;
        }
        
        log(`✅ Получен API KEY: ${token.substring(0, 20)}...`, 'success');
        log(`   Email: ${data.email}`, 'info');
        
        return {
            apiKey: token,
            email: data.email,
            balance: data.balance
        };
        
    } catch (err) {
        log(`Ошибка подключения к серверу: ${err.message}`, 'error');
        return null;
    }
}

/**
 * Отметить аккаунт как использованный (опционально)
 */
async function markAccountUsed(email) {
    // Можно реализовать если нужно отслеживать использование
    log(`Аккаунт ${email} помечен как используемый`, 'debug');
}

// ==================== ОСНОВНАЯ ЛОГИКА ====================

/**
 * Проверка и ротация токена (если нужно)
 */
async function checkAndRotate() {
    console.log('\n' + '='.repeat(50));
    log('CLINE Local Token Rotator v3', 'info');
    console.log('='.repeat(50) + '\n');
    
    // 1. Получаем текущий API key из VS Code
    const currentApiKey = await getCurrentApiKey();
    
    if (!currentApiKey) {
        log('В VS Code нет API key, получаем новый...', 'warning');
        
        const serverData = await fetchApiKeyFromServer();
        if (serverData && serverData.apiKey) {
            const success = await setNewApiKey(serverData.apiKey);
            if (success) {
                log('✅ API key успешно установлен!', 'success');
                log('🔄 Перезапустите VS Code для применения', 'info');
            }
        } else {
            log('❌ Не удалось получить API KEY с сервера', 'error');
            log('💡 Возможно все аккаунты - это старые с cookies', 'info');
            log('💡 Зарегистрируйте новый аккаунт CLINE через панель', 'info');
        }
        return;
    }
    
    // 2. Проверяем баланс текущего API key
    const { success, balance, error, email } = await checkBalance(currentApiKey);
    
    if (!success) {
        log(`Проблема с текущим API key: ${error}`, 'warning');
        log('Получаем новый API KEY с сервера...', 'info');
        
        const serverData = await fetchApiKeyFromServer();
        if (serverData && serverData.apiKey) {
            const setSuccess = await setNewApiKey(serverData.apiKey);
            if (setSuccess) {
                log('✅ API key заменён!', 'success');
                log('🔄 Перезапустите VS Code для применения', 'info');
            }
        } else {
            log('❌ Не удалось получить новый API KEY', 'error');
        }
        return;
    }
    
    // 3. Проверяем нужна ли замена по балансу
    if (balance < CONFIG.MIN_BALANCE) {
        log(`⚠️ Баланс $${balance.toFixed(4)} ниже минимума $${CONFIG.MIN_BALANCE}`, 'warning');
        log('Получаем новый API KEY с сервера...', 'info');
        
        const serverData = await fetchApiKeyFromServer();
        if (serverData && serverData.apiKey) {
            const setSuccess = await setNewApiKey(serverData.apiKey);
            if (setSuccess) {
                // Проверяем баланс нового токена
                const newBalanceCheck = await checkBalance(serverData.apiKey);
                if (newBalanceCheck.success) {
                    log(`💰 Новый баланс: $${newBalanceCheck.balance.toFixed(4)}`, 'success');
                }
                log('✅ API key заменён!', 'success');
                log('🔄 Перезапустите VS Code для применения', 'info');
            }
        } else {
            log('❌ Не удалось получить новый API KEY', 'error');
        }
    } else {
        log(`✅ Баланс в норме: $${balance.toFixed(4)} (минимум: $${CONFIG.MIN_BALANCE})`, 'success');
        if (email) {
            log(`   Email: ${email}`, 'info');
        }
        log('Замена не требуется', 'info');
    }
}

/**
 * Только проверка баланса (без замены)
 */
async function checkOnly() {
    console.log('\n' + '='.repeat(50));
    log('Проверка баланса CLINE', 'info');
    console.log('='.repeat(50) + '\n');
    
    const currentApiKey = await getCurrentApiKey();
    
    if (!currentApiKey) {
        log('API key не найден в VS Code', 'error');
        log('💡 Запустите скрипт без флагов для получения API KEY', 'info');
        return;
    }
    
    // Проверяем формат
    if (currentApiKey.startsWith('[') || currentApiKey.startsWith('{')) {
        log('⚠️ В VS Code установлены COOKIES, а не API KEY', 'warning');
        log('💡 Запустите скрипт без флагов для получения правильного API KEY', 'info');
        return;
    }
    
    const { success, balance, email, error } = await checkBalance(currentApiKey);
    
    if (success) {
        console.log('\n📊 Информация о токене:');
        console.log(`   Email: ${email || 'N/A'}`);
        console.log(`   Баланс: $${balance.toFixed(4)}`);
        console.log(`   Минимум: $${CONFIG.MIN_BALANCE}`);
        console.log(`   Статус: ${balance >= CONFIG.MIN_BALANCE ? '✅ OK' : '⚠️ Требуется замена'}`);
    } else {
        log(`Ошибка: ${error}`, 'error');
    }
}

/**
 * Тестовое получение API KEY с сервера
 */
async function testFetch() {
    console.log('\n' + '='.repeat(50));
    log('Тест получения API KEY с сервера', 'info');
    console.log('='.repeat(50) + '\n');
    
    const serverData = await fetchApiKeyFromServer();
    
    if (serverData) {
        console.log('\n📊 Полученные данные:');
        console.log(`   Email: ${serverData.email}`);
        console.log(`   API KEY: ${serverData.apiKey.substring(0, 25)}...`);
        console.log(`   Баланс: $${serverData.balance || '?'}`);
        
        // Проверяем баланс через API
        log('\nПроверка баланса через CLINE API...', 'info');
        const balanceCheck = await checkBalance(serverData.apiKey);
        if (balanceCheck.success) {
            console.log(`   Проверенный баланс: $${balanceCheck.balance.toFixed(4)}`);
        } else {
            console.log(`   Ошибка проверки: ${balanceCheck.error}`);
        }
    } else {
        log('Не удалось получить API KEY', 'error');
    }
}

/**
 * Принудительная установка API KEY
 */
async function forceSet() {
    console.log('\n' + '='.repeat(50));
    log('Принудительная установка API KEY', 'info');
    console.log('='.repeat(50) + '\n');
    
    const serverData = await fetchApiKeyFromServer();
    
    if (serverData && serverData.apiKey) {
        log(`Устанавливаем API KEY от ${serverData.email}...`, 'info');
        
        const success = await setNewApiKey(serverData.apiKey);
        if (success) {
            log('✅ API key установлен!', 'success');
            log('🔄 Перезапустите VS Code для применения', 'info');
            
            // Проверяем баланс
            const balanceCheck = await checkBalance(serverData.apiKey);
            if (balanceCheck.success) {
                log(`💰 Баланс: $${balanceCheck.balance.toFixed(4)}`, 'info');
            }
        }
    } else {
        log('❌ Не удалось получить API KEY', 'error');
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
    } else if (args.includes('--test-fetch') || args.includes('-t')) {
        await testFetch();
    } else if (args.includes('--force') || args.includes('-f')) {
        await forceSet();
    } else if (args.includes('--help') || args.includes('-h')) {
        console.log('\n📖 Использование:');
        console.log('   node rotator.js          - Проверка и автозамена при необходимости');
        console.log('   node rotator.js -c       - Только проверка баланса');
        console.log('   node rotator.js -t       - Тест получения с сервера');
        console.log('   node rotator.js -f       - Принудительная установка нового API KEY');
        console.log('   node rotator.js -h       - Показать справку');
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
module.exports = { checkAndRotate, checkOnly, checkBalance, getCurrentApiKey, setNewApiKey };
