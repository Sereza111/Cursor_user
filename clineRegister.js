/**
 * Модуль регистрации/авторизации аккаунтов CLINE
 * Использует Microsoft OAuth через Outlook аккаунты
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const db = require('./database');

// Подключаем stealth плагин
const stealthPlugin = StealthPlugin();
puppeteer.use(stealthPlugin);

// Конфигурация CLINE
const CLINE_CONFIG = {
    // Базовый URL для авторизации
    AUTH_URL: 'https://authkit.cline.bot/',
    // Параметры OAuth (можно обновлять)
    CLIENT_ID: 'client_01K3A541FN8TA3EPPHTD2325AR',
    REDIRECT_URI: 'https://api.cline.bot/api/v1/auth/callback',
    // Таймауты
    TIMEOUT: parseInt(process.env.TIMEOUT) || 60000,
    SLOW_MO: parseInt(process.env.SLOW_MO) || 50,
    HEADLESS: process.env.HEADLESS !== 'false'
};

// Microsoft Login URLs
const MS_LOGIN = {
    BASE: 'https://login.microsoftonline.com',
    LIVE: 'https://login.live.com'
};

/**
 * Класс для регистрации аккаунтов CLINE через Microsoft
 */
class ClineRegister {
    constructor(sessionId, proxies = []) {
        this.sessionId = sessionId;
        this.proxies = proxies;
        this.currentProxyIndex = 0;
        this.browser = null;
        this.page = null;
    }

    /**
     * Получение следующего прокси из списка
     */
    getNextProxy() {
        if (this.proxies.length === 0) return null;
        const proxy = this.proxies[this.currentProxyIndex];
        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
        return proxy;
    }

    /**
     * Логирование
     */
    log(level, message) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [CLINE] [${level.toUpperCase()}] ${message}`);
        if (this.sessionId) {
            db.addLog(this.sessionId, level, `[CLINE] ${message}`);
        }
    }

    /**
     * Парсинг прокси строки
     */
    parseProxy(proxyString) {
        if (!proxyString) return null;
        
        let host, port, username, password;
        let proxy = proxyString.replace(/^https?:\/\//, '');
        
        if (proxy.includes('@')) {
            const atIndex = proxy.indexOf('@');
            const beforeAt = proxy.substring(0, atIndex);
            const afterAt = proxy.substring(atIndex + 1);
            
            if (beforeAt.includes('.') || (beforeAt.includes(':') && beforeAt.split(':')[0].match(/^\d+$/))) {
                const hostParts = beforeAt.split(':');
                host = hostParts[0];
                port = hostParts[1];
                const authParts = afterAt.split(':');
                username = authParts[0];
                password = authParts.slice(1).join(':');
            } else {
                const authParts = beforeAt.split(':');
                username = authParts[0];
                password = authParts.slice(1).join(':');
                const hostParts = afterAt.split(':');
                host = hostParts[0];
                port = hostParts[1];
            }
        } else {
            const parts = proxy.split(':');
            host = parts[0];
            port = parts[1];
        }
        
        return {
            host,
            port,
            username,
            password,
            hasAuth: !!(username && password),
            serverUrl: `${host}:${port}`
        };
    }

    /**
     * Запуск браузера
     */
    async launchBrowser(proxy = null) {
        const proxyConfig = this.parseProxy(proxy);

        const launchOptions = {
            headless: CLINE_CONFIG.HEADLESS ? 'new' : false,
            slowMo: CLINE_CONFIG.SLOW_MO,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--lang=en-US,en'
            ],
            defaultViewport: { width: 1366, height: 768 },
            ignoreDefaultArgs: ['--enable-automation']
        };

        if (proxyConfig) {
            launchOptions.args.push(`--proxy-server=${proxyConfig.serverUrl}`);
            this.log('info', `🌐 Используем прокси: ${proxyConfig.serverUrl}`);
        }

        this.browser = await puppeteer.launch(launchOptions);
        this.page = await this.browser.newPage();

        if (proxyConfig && proxyConfig.hasAuth) {
            await this.page.authenticate({
                username: proxyConfig.username,
                password: proxyConfig.password
            });
            this.log('info', `🔐 Прокси авторизация: ${proxyConfig.username}`);
        }

        // User-Agent
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Маскировка webdriver
        await this.page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
        });

        this.log('info', '🚀 Браузер запущен');
        return this.browser;
    }

    /**
     * Закрытие браузера
     */
    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.log('info', 'Браузер закрыт');
        }
    }

    /**
     * Задержка с рандомом
     */
    async humanDelay(min = 500, max = 1500) {
        const delay = Math.floor(Math.random() * (max - min) + min);
        await new Promise(r => setTimeout(r, delay));
    }

    /**
     * Ввод текста как человек
     */
    async humanType(selector, text) {
        await this.page.waitForSelector(selector, { timeout: CLINE_CONFIG.TIMEOUT });
        await this.page.click(selector);
        await this.humanDelay(100, 300);
        
        for (const char of text) {
            await this.page.type(selector, char, { delay: Math.random() * 100 + 30 });
        }
    }

    /**
     * Генерация URL авторизации CLINE
     */
    generateAuthUrl() {
        // Генерируем state и session_id
        const state = Buffer.from(JSON.stringify({
            client_type: 'web',
            callback_url: 'https://app.cline.bot/dashboard'
        })).toString('base64');
        
        const sessionId = this.generateSessionId();
        
        const params = new URLSearchParams({
            client_id: CLINE_CONFIG.CLIENT_ID,
            redirect_uri: CLINE_CONFIG.REDIRECT_URI,
            state: state,
            authorization_session_id: sessionId
        });
        
        return `${CLINE_CONFIG.AUTH_URL}?${params.toString()}`;
    }

    /**
     * Генерация session ID
     */
    generateSessionId() {
        const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
        let result = '01';
        for (let i = 0; i < 24; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }

    /**
     * Авторизация через Microsoft (Outlook)
     * @param {string} email - Outlook email
     * @param {string} password - Пароль от Outlook
     * @returns {Object} - Результат с токеном сессии
     */
    async loginWithMicrosoft(accountId, email, password) {
        const startTime = Date.now();
        const proxy = this.getNextProxy();

        // Обновляем статус
        db.updateAccount(accountId, {
            status: 'processing',
            proxy_used: proxy || 'direct'
        });

        this.log('info', `🚀 Начинаем авторизацию CLINE: ${email}`);

        try {
            await this.launchBrowser(proxy);

            // ==========================================
            // ЭТАП 1: Переход на страницу CLINE Auth
            // ==========================================
            const authUrl = this.generateAuthUrl();
            this.log('info', `📍 Переход на: ${authUrl}`);
            
            await this.page.goto(authUrl, {
                waitUntil: 'networkidle2',
                timeout: CLINE_CONFIG.TIMEOUT
            });

            await this.humanDelay(2000, 3000);

            // Делаем скриншот
            await this.page.screenshot({ path: `cline_step1_${accountId}.png` });

            // ==========================================
            // ЭТАП 2: Нажимаем "Продолжить с Microsoft"
            // ==========================================
            this.log('info', '🔍 Ищем кнопку Microsoft...');

            // Ждём загрузки кнопок
            await this.humanDelay(2000, 3000);

            // Ищем кнопку Microsoft разными способами
            const msButtonClicked = await this.page.evaluate(() => {
                // Поиск по тексту
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    const text = btn.textContent.toLowerCase();
                    if (text.includes('microsoft')) {
                        btn.click();
                        return true;
                    }
                }
                
                // Поиск по иконке/классу
                const msBtn = document.querySelector('[data-provider="microsoft"], button[aria-label*="Microsoft"], a[href*="microsoft"]');
                if (msBtn) {
                    msBtn.click();
                    return true;
                }
                
                return false;
            });

            if (!msButtonClicked) {
                // Пробуем найти по XPath или другим селекторам
                try {
                    await this.page.waitForSelector('button:has-text("Microsoft")', { timeout: 5000 });
                    await this.page.click('button:has-text("Microsoft")');
                } catch (e) {
                    // Ищем любую кнопку с Microsoft
                    const buttons = await this.page.$$('button');
                    for (const btn of buttons) {
                        const text = await btn.evaluate(el => el.textContent);
                        if (text && text.toLowerCase().includes('microsoft')) {
                            await btn.click();
                            break;
                        }
                    }
                }
            }

            this.log('info', '✅ Нажали на Microsoft, ожидаем редирект...');
            await this.humanDelay(3000, 5000);

            // Скриншот после клика
            await this.page.screenshot({ path: `cline_step2_ms_${accountId}.png` });

            // ==========================================
            // ЭТАП 3: Авторизация в Microsoft
            // ==========================================
            const currentUrl = this.page.url();
            this.log('info', `📍 Текущий URL: ${currentUrl}`);

            // Проверяем, что мы на странице Microsoft
            if (currentUrl.includes('login.microsoftonline.com') || 
                currentUrl.includes('login.live.com')) {
                
                this.log('info', '📧 На странице Microsoft Login, вводим email...');

                // Вводим email
                await this.humanDelay(1000, 2000);
                
                const emailSelectors = [
                    'input[type="email"]',
                    'input[name="loginfmt"]',
                    '#i0116'
                ];

                for (const selector of emailSelectors) {
                    try {
                        const emailInput = await this.page.$(selector);
                        if (emailInput) {
                            await this.humanType(selector, email);
                            this.log('info', `✅ Email введён: ${email}`);
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }

                await this.humanDelay(500, 1000);

                // Нажимаем Next
                const nextClicked = await this.page.evaluate(() => {
                    const nextBtn = document.querySelector('#idSIButton9, input[type="submit"], button[type="submit"]');
                    if (nextBtn) {
                        nextBtn.click();
                        return true;
                    }
                    return false;
                });

                if (nextClicked) {
                    this.log('info', '➡️ Нажали Next');
                }

                await this.humanDelay(3000, 5000);
                await this.page.screenshot({ path: `cline_step3_email_${accountId}.png` });

                // ==========================================
                // ЭТАП 4: Ввод пароля
                // ==========================================
                this.log('info', '🔑 Вводим пароль...');

                const passwordSelectors = [
                    'input[type="password"]',
                    'input[name="passwd"]',
                    '#i0118'
                ];

                for (const selector of passwordSelectors) {
                    try {
                        await this.page.waitForSelector(selector, { timeout: 10000 });
                        await this.humanType(selector, password);
                        this.log('info', '✅ Пароль введён');
                        break;
                    } catch (e) {
                        continue;
                    }
                }

                await this.humanDelay(500, 1000);

                // Нажимаем Sign in
                await this.page.evaluate(() => {
                    const signInBtn = document.querySelector('#idSIButton9, input[type="submit"], button[type="submit"]');
                    if (signInBtn) signInBtn.click();
                });

                this.log('info', '➡️ Нажали Sign In');
                await this.humanDelay(5000, 7000);
                await this.page.screenshot({ path: `cline_step4_password_${accountId}.png` });

                // ==========================================
                // ЭТАП 5: Обработка "Stay signed in?" и других окон
                // ==========================================
                const afterLoginUrl = this.page.url();
                this.log('info', `📍 URL после логина: ${afterLoginUrl}`);

                // Проверяем на "Stay signed in?"
                const staySignedIn = await this.page.$('#idBtn_Back, #idSIButton9');
                if (staySignedIn) {
                    this.log('info', '🔄 Обрабатываем "Stay signed in?"...');
                    
                    // Нажимаем "No" или "Yes" в зависимости от настроек
                    const noBtn = await this.page.$('#idBtn_Back');
                    if (noBtn) {
                        await noBtn.click();
                        this.log('info', 'Нажали "No"');
                    } else {
                        const yesBtn = await this.page.$('#idSIButton9');
                        if (yesBtn) {
                            await yesBtn.click();
                            this.log('info', 'Нажали "Yes"');
                        }
                    }
                    
                    await this.humanDelay(3000, 5000);
                }

                // Проверяем на запрос разрешений (permissions consent)
                const consentBtn = await this.page.$('#idSIButton9, button[type="submit"]');
                if (consentBtn) {
                    const pageText = await this.page.evaluate(() => document.body.innerText);
                    if (pageText.toLowerCase().includes('permission') || 
                        pageText.toLowerCase().includes('accept') ||
                        pageText.toLowerCase().includes('consent')) {
                        this.log('info', '🔄 Принимаем разрешения...');
                        await consentBtn.click();
                        await this.humanDelay(3000, 5000);
                    }
                }
            }

            // ==========================================
            // ЭТАП 6: Проверка результата и получение токена
            // ==========================================
            await this.humanDelay(3000, 5000);
            
            const finalUrl = this.page.url();
            this.log('info', `📍 Финальный URL: ${finalUrl}`);
            await this.page.screenshot({ path: `cline_final_${accountId}.png` });

            // Проверяем успешность авторизации
            let sessionToken = null;
            let accessToken = null;

            // Пробуем получить токены из cookies
            const cookies = await this.page.cookies();
            for (const cookie of cookies) {
                if (cookie.name.includes('session') || cookie.name.includes('token') || 
                    cookie.name.includes('auth') || cookie.name.includes('cline')) {
                    this.log('info', `🍪 Найден cookie: ${cookie.name}`);
                    if (cookie.name.includes('session')) {
                        sessionToken = cookie.value;
                    }
                    if (cookie.name.includes('token') || cookie.name.includes('access')) {
                        accessToken = cookie.value;
                    }
                }
            }

            // Пробуем получить токен из localStorage
            const localStorageData = await this.page.evaluate(() => {
                const data = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (key.includes('token') || key.includes('session') || key.includes('auth'))) {
                        data[key] = localStorage.getItem(key);
                    }
                }
                return data;
            });

            if (Object.keys(localStorageData).length > 0) {
                this.log('info', `💾 LocalStorage данные: ${JSON.stringify(Object.keys(localStorageData))}`);
            }

            // Проверяем URL на наличие токена
            if (finalUrl.includes('code=') || finalUrl.includes('token=')) {
                const urlParams = new URL(finalUrl).searchParams;
                const code = urlParams.get('code');
                const token = urlParams.get('token');
                if (code) {
                    this.log('info', `🔑 Получен authorization code: ${code.substring(0, 20)}...`);
                    accessToken = code;
                }
                if (token) {
                    this.log('info', `🔑 Получен token: ${token.substring(0, 20)}...`);
                    accessToken = token;
                }
            }

            // Проверяем на страницу dashboard
            if (finalUrl.includes('cline.bot') || finalUrl.includes('dashboard')) {
                this.log('info', '✅ Успешная авторизация! На странице CLINE');
                
                // Получаем все cookies для CLINE
                const clineCookies = cookies.filter(c => 
                    c.domain.includes('cline.bot') || c.domain.includes('workos')
                );
                
                this.log('info', `🍪 CLINE cookies: ${clineCookies.length} шт.`);

                const processingTime = Date.now() - startTime;
                
                db.updateAccount(accountId, {
                    status: 'success',
                    trial_status: 'active',
                    session_token: sessionToken || JSON.stringify(clineCookies),
                    access_token: accessToken,
                    processing_time: processingTime
                });

                await this.closeBrowser();
                
                return {
                    success: true,
                    email: email,
                    sessionToken: sessionToken,
                    accessToken: accessToken,
                    cookies: clineCookies,
                    finalUrl: finalUrl
                };
            }

            // Проверяем на ошибки
            const pageText = await this.page.evaluate(() => document.body.innerText);
            
            if (pageText.includes('incorrect') || pageText.includes('wrong password') ||
                pageText.includes('invalid') || pageText.includes('error')) {
                throw new Error('Неверный email или пароль Microsoft');
            }

            if (pageText.includes('blocked') || pageText.includes('unusual activity')) {
                throw new Error('Аккаунт Microsoft заблокирован или требует верификации');
            }

            // Если не на dashboard но и нет явных ошибок
            const processingTime = Date.now() - startTime;
            
            db.updateAccount(accountId, {
                status: 'pending',
                trial_status: 'requires_verification',
                error_message: `Финальный URL: ${finalUrl}`,
                processing_time: processingTime
            });

            await this.closeBrowser();
            
            return {
                success: false,
                email: email,
                error: 'Авторизация не завершена. Возможно требуется 2FA или верификация.',
                finalUrl: finalUrl,
                cookies: cookies
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            this.log('error', `❌ Ошибка: ${error.message}`);
            
            // Сохраняем скриншот ошибки
            if (this.page) {
                await this.page.screenshot({ path: `cline_error_${accountId}.png` });
            }
            
            db.updateAccount(accountId, {
                status: 'failed',
                trial_status: 'error',
                error_message: error.message.substring(0, 500),
                processing_time: processingTime
            });

            await this.closeBrowser();
            
            return {
                success: false,
                email: email,
                error: error.message
            };
        }
    }

    /**
     * Обработка аккаунта
     */
    async processAccount(account) {
        return await this.loginWithMicrosoft(account.id, account.email, account.password);
    }
}

module.exports = ClineRegister;
