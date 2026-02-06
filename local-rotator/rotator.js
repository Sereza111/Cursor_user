/**
 * CLINE Local Token Rotator v2
 * =============================
 * 
 * Этот скрипт запускается на ПК с VS Code и CLINE.
 * Он получает cookies сессии с сервера и устанавливает авторизацию в VS Code.
 * 
 * Как это работает:
 * 1. Скрипт получает cookies сессии CLINE с сервера панели
 * 2. Использует Puppeteer для авторизации на cline.bot с этими cookies
 * 3. Получает API key со страницы настроек
 * 4. Устанавливает API key в VS Code через keytar (SecretStorage)
 * 5. VS Code CLINE автоматически использует новый токен
 * 
 * Требования:
 * - Windows с VS Code и расширением CLINE
 * - Node.js 18+
 * - Chrome/Chromium для Puppeteer
 */

require('dotenv').config();
const fetch = require('node-fetch');
const keytar = require('keytar');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// ==================== КОНФИГУРАЦИЯ ====================

const CONFIG = {
    // Имя сервиса и аккаунта для VS Code SecretStorage
    SERVICE_NAME: 'saoudrizwan.claude-dev',
    ACCOUNT_NAME: 'clineApiKey',
    
    // CLINE URLs
    CLINE_DASHBOARD: 'https://app.cline.bot/dashboard',
    CLINE_SETTINGS: 'https://app.cline.bot/settings',
    CLINE_API_KEYS: 'https://app.cline.bot/api-keys',
    CLINE_API_URL: 'https://api.cline.bot/api/user',
    
    // Сервер с панелью регистрации
    SERVER_URL: process.env.SERVER_URL || 'http://localhost:3000',
    API_KEY: process.env.API_KEY || '',
    
    // Минимальный баланс для замены
    MIN_BALANCE: parseFloat(process.env.MIN_BALANCE) || 0.10,
    
    // Puppeteer настройки
    HEADLESS: process.env.HEADLESS !== 'false',
    TIMEOUT: parseInt(process.env.TIMEOUT) || 30000,
    
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

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== РАБОТА С VS CODE SECRET STORAGE ====================

/**
 * Получить текущий API key из VS Code
 */
async function getCurrentApiKey() {
    try {
        const apiKey = await keytar.getPassword(CONFIG.SERVICE_NAME, CONFIG.ACCOUNT_NAME);
        if (apiKey) {
            log(`Текущий API key найден (${apiKey.substring(0, 20)}...)`, 'debug');
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
 * Проверить баланс текущего API key
 */
async function checkBalance(apiKey) {
    if (!apiKey) {
        return { success: false, balance: 0, error: 'API key не указан' };
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
        
        log(`Текущий баланс: $${balance.toFixed(4)}`, 'info');
        
        return { success: true, balance, email: data.email };
        
    } catch (err) {
        log(`Ошибка проверки баланса: ${err.message}`, 'error');
        return { success: false, balance: 0, error: err.message };
    }
}

// ==================== РАБОТА С СЕРВЕРОМ ====================

/**
 * Получить cookies сессии с сервера
 */
async function fetchSessionFromServer() {
    if (!CONFIG.API_KEY) {
        log('API_KEY не настроен! Добавьте его в .env', 'error');
        return null;
    }
    
    const url = `${CONFIG.SERVER_URL}/api/token/fetch`;
    
    log(`Запрос сессии с сервера: ${CONFIG.SERVER_URL}`, 'info');
    
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
        
        // token содержит JSON с cookies
        log(`Получена сессия: ${data.email}`, 'success');
        
        return {
            email: data.email,
            cookies: data.token, // JSON строка с cookies
            balance: data.balance
        };
        
    } catch (err) {
        log(`Ошибка подключения к серверу: ${err.message}`, 'error');
        return null;
    }
}

// ==================== PUPPETEER: ПОЛУЧЕНИЕ API KEY ====================

/**
 * Использовать cookies сессии для получения API key через Puppeteer
 */
async function getApiKeyFromSession(sessionData) {
    log('🚀 Запускаем браузер для получения API key...', 'info');
    
    let browser = null;
    
    try {
        // Парсим cookies
        let cookies;
        try {
            cookies = typeof sessionData.cookies === 'string' 
                ? JSON.parse(sessionData.cookies) 
                : sessionData.cookies;
        } catch (e) {
            log(`Ошибка парсинга cookies: ${e.message}`, 'error');
            return null;
        }
        
        if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
            log('Cookies пусты или неверного формата', 'error');
            return null;
        }
        
        log(`Загружено cookies: ${cookies.length} шт.`, 'debug');
        
        // Запускаем браузер
        browser = await puppeteer.launch({
            headless: CONFIG.HEADLESS,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--window-size=1366,768'
            ],
            defaultViewport: { width: 1366, height: 768 }
        });
        
        const page = await browser.newPage();
        
        // Устанавливаем cookies
        log('🍪 Устанавливаем cookies сессии...', 'info');
        
        for (const cookie of cookies) {
            try {
                // Преобразуем формат cookies для Puppeteer
                const puppeteerCookie = {
                    name: cookie.name,
                    value: cookie.value,
                    domain: cookie.domain || '.cline.bot',
                    path: cookie.path || '/',
                    secure: cookie.secure !== false,
                    httpOnly: cookie.httpOnly || false,
                    sameSite: cookie.sameSite || 'Lax'
                };
                
                // Удаляем expires если он некорректный
                if (cookie.expires && cookie.expires > 0) {
                    puppeteerCookie.expires = cookie.expires;
                }
                
                await page.setCookie(puppeteerCookie);
                log(`  ✓ ${cookie.name}`, 'debug');
            } catch (e) {
                log(`  ✗ ${cookie.name}: ${e.message}`, 'debug');
            }
        }
        
        // Переходим на dashboard для проверки авторизации
        log('📍 Переходим на dashboard CLINE...', 'info');
        
        await page.goto(CONFIG.CLINE_DASHBOARD, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.TIMEOUT
        });
        
        await delay(3000);
        
        const currentUrl = page.url();
        log(`📍 URL: ${currentUrl}`, 'debug');
        
        // Проверяем авторизованы ли мы
        if (currentUrl.includes('auth') || currentUrl.includes('login') || currentUrl.includes('signin')) {
            log('❌ Cookies не работают - требуется авторизация', 'error');
            
            // Сохраняем скриншот для отладки
            await page.screenshot({ path: 'debug_auth_required.png' });
            
            await browser.close();
            return null;
        }
        
        log('✅ Авторизация через cookies успешна!', 'success');
        
        // Пробуем получить баланс со страницы
        const pageData = await page.evaluate(() => {
            const text = document.body.innerText;
            
            // Ищем баланс
            const balanceMatch = text.match(/\$[\d.]+/) || text.match(/credits?:?\s*[\d.]+/i);
            
            return {
                text: text.substring(0, 1000),
                balance: balanceMatch ? balanceMatch[0] : null
            };
        });
        
        if (pageData.balance) {
            log(`💰 Баланс на dashboard: ${pageData.balance}`, 'info');
        }
        
        // ==========================================
        // Получаем API key
        // ==========================================
        
        log('🔑 Переходим на страницу API keys...', 'info');
        
        // Пробуем разные URL для страницы с API keys
        const apiKeyUrls = [
            'https://app.cline.bot/api-keys',
            'https://app.cline.bot/settings/api-keys',
            'https://app.cline.bot/settings',
            'https://app.cline.bot/account/api-keys'
        ];
        
        let apiKey = null;
        
        for (const url of apiKeyUrls) {
            try {
                log(`  Пробуем: ${url}`, 'debug');
                
                await page.goto(url, {
                    waitUntil: 'networkidle2',
                    timeout: CONFIG.TIMEOUT
                });
                
                await delay(2000);
                
                // Ищем API key на странице
                apiKey = await page.evaluate(() => {
                    // Ищем элементы содержащие API key
                    const keyPatterns = [
                        /sk-[a-zA-Z0-9]{20,}/,  // Формат sk-...
                        /cline_[a-zA-Z0-9]{20,}/, // Формат cline_...
                        /api[_-]?key[_-]?[a-zA-Z0-9]{20,}/i
                    ];
                    
                    // Проверяем input поля
                    const inputs = document.querySelectorAll('input, code, pre, span[class*="key"], div[class*="key"]');
                    for (const el of inputs) {
                        const value = el.value || el.textContent || '';
                        for (const pattern of keyPatterns) {
                            const match = value.match(pattern);
                            if (match) {
                                return match[0];
                            }
                        }
                    }
                    
                    // Проверяем весь текст страницы
                    const text = document.body.innerText;
                    for (const pattern of keyPatterns) {
                        const match = text.match(pattern);
                        if (match) {
                            return match[0];
                        }
                    }
                    
                    return null;
                });
                
                if (apiKey) {
                    log(`🔑 Найден API key: ${apiKey.substring(0, 15)}...`, 'success');
                    break;
                }
                
                // Пробуем нажать кнопку "Generate API Key" или "Create"
                const generated = await page.evaluate(() => {
                    const buttons = document.querySelectorAll('button');
                    for (const btn of buttons) {
                        const text = btn.textContent?.toLowerCase() || '';
                        if (text.includes('generate') || text.includes('create') || 
                            text.includes('new key') || text.includes('add key')) {
                            btn.click();
                            return true;
                        }
                    }
                    return false;
                });
                
                if (generated) {
                    log('🔄 Нажали кнопку генерации API key, ждём...', 'info');
                    await delay(3000);
                    
                    // Повторно ищем key
                    apiKey = await page.evaluate(() => {
                        const keyPatterns = [
                            /sk-[a-zA-Z0-9]{20,}/,
                            /cline_[a-zA-Z0-9]{20,}/
                        ];
                        
                        const text = document.body.innerText;
                        for (const pattern of keyPatterns) {
                            const match = text.match(pattern);
                            if (match) return match[0];
                        }
                        
                        // Проверяем модальные окна
                        const modals = document.querySelectorAll('[role="dialog"], .modal, [class*="modal"]');
                        for (const modal of modals) {
                            const modalText = modal.textContent || '';
                            for (const pattern of keyPatterns) {
                                const match = modalText.match(pattern);
                                if (match) return match[0];
                            }
                        }
                        
                        return null;
                    });
                    
                    if (apiKey) {
                        log(`🔑 Сгенерирован API key: ${apiKey.substring(0, 15)}...`, 'success');
                        break;
                    }
                }
                
            } catch (e) {
                log(`  ✗ ${url}: ${e.message}`, 'debug');
            }
        }
        
        // Сохраняем скриншот для отладки
        await page.screenshot({ path: 'debug_api_keys_page.png' });
        
        await browser.close();
        
        if (!apiKey) {
            log('❌ API key не найден на странице', 'error');
            log('💡 Возможно CLINE использует другой метод авторизации', 'warning');
            
            // Пробуем использовать сами cookies как "токен"
            // Некоторые приложения принимают session cookie как Bearer токен
            const sessionCookie = cookies.find(c => 
                c.name.includes('session') || 
                c.name.includes('token') ||
                c.name.includes('auth')
            );
            
            if (sessionCookie) {
                log(`💡 Пробуем использовать cookie "${sessionCookie.name}" как токен`, 'info');
                return sessionCookie.value;
            }
        }
        
        return apiKey;
        
    } catch (err) {
        log(`❌ Ошибка Puppeteer: ${err.message}`, 'error');
        
        if (browser) {
            await browser.close();
        }
        
        return null;
    }
}

// ==================== ОСНОВНАЯ ЛОГИКА ====================

/**
 * Проверка и ротация токена (если нужно)
 */
async function checkAndRotate() {
    console.log('\n' + '='.repeat(50));
    log('CLINE Local Token Rotator v2', 'info');
    console.log('='.repeat(50) + '\n');
    
    // 1. Получаем текущий API key из VS Code
    const currentApiKey = await getCurrentApiKey();
    
    if (!currentApiKey) {
        log('В VS Code нет API key, получаем новый...', 'warning');
        
        const session = await fetchSessionFromServer();
        if (session) {
            const newApiKey = await getApiKeyFromSession(session);
            if (newApiKey) {
                await setNewApiKey(newApiKey);
                log('API key успешно установлен! Перезапустите VS Code.', 'success');
            }
        }
        return;
    }
    
    // 2. Проверяем баланс
    const { success, balance, error } = await checkBalance(currentApiKey);
    
    if (!success) {
        log(`Проблема с текущим API key: ${error}`, 'warning');
        log('Получаем новую сессию...', 'info');
        
        const session = await fetchSessionFromServer();
        if (session) {
            const newApiKey = await getApiKeyFromSession(session);
            if (newApiKey) {
                await setNewApiKey(newApiKey);
                log('API key заменён! Перезапустите VS Code.', 'success');
            }
        }
        return;
    }
    
    // 3. Проверяем нужна ли замена
    if (balance < CONFIG.MIN_BALANCE) {
        log(`Баланс $${balance.toFixed(4)} ниже минимума $${CONFIG.MIN_BALANCE}`, 'warning');
        log('Получаем новую сессию...', 'info');
        
        const session = await fetchSessionFromServer();
        if (session) {
            const newApiKey = await getApiKeyFromSession(session);
            if (newApiKey) {
                await setNewApiKey(newApiKey);
                
                // Проверяем баланс нового токена
                const newBalance = await checkBalance(newApiKey);
                if (newBalance.success) {
                    log(`Новый баланс: $${newBalance.balance.toFixed(4)}`, 'success');
                }
                
                log('API key заменён! Перезапустите VS Code для применения.', 'success');
            }
        }
    } else {
        log(`Баланс в норме ($${balance.toFixed(4)} >= $${CONFIG.MIN_BALANCE}). Замена не требуется.`, 'success');
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
 * Тестовое получение сессии с сервера
 */
async function testFetch() {
    console.log('\n' + '='.repeat(50));
    log('Тест получения сессии с сервера', 'info');
    console.log('='.repeat(50) + '\n');
    
    const session = await fetchSessionFromServer();
    
    if (session) {
        console.log('\n📊 Полученная сессия:');
        console.log(`   Email: ${session.email}`);
        console.log(`   Баланс: $${session.balance || '?'}`);
        console.log(`   Cookies: ${session.cookies ? 'получены' : 'отсутствуют'}`);
        
        // Парсим и показываем cookies
        try {
            const cookies = JSON.parse(session.cookies);
            console.log(`   Количество cookies: ${cookies.length}`);
            cookies.forEach(c => {
                console.log(`     - ${c.name}: ${c.value.substring(0, 30)}...`);
            });
        } catch (e) {
            console.log(`   Ошибка парсинга cookies: ${e.message}`);
        }
    } else {
        log('Не удалось получить сессию', 'error');
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
    console.log(`   Headless: ${CONFIG.HEADLESS}`);
    
    // Проверяем режим запуска
    const args = process.argv.slice(2);
    
    if (args.includes('--check-only') || args.includes('-c')) {
        await checkOnly();
    } else if (args.includes('--test-fetch') || args.includes('-t')) {
        await testFetch();
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
module.exports = { checkAndRotate, checkOnly, checkBalance, getCurrentApiKey };
