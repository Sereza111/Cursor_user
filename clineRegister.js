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
     * Безопасное выполнение действия с обработкой навигации
     */
    async safeAction(action, description = 'action') {
        try {
            return await action();
        } catch (error) {
            if (error.message.includes('Execution context was destroyed') ||
                error.message.includes('navigation') ||
                error.message.includes('detached')) {
                this.log('info', `⚡ Навигация произошла во время: ${description}`);
                await this.humanDelay(2000, 3000);
                return null;
            }
            throw error;
        }
    }

    /**
     * Обработка диалогов Microsoft (Stay signed in?, permissions, etc.)
     */
    async handleMicrosoftDialogs() {
        this.log('info', '🔄 Проверяем наличие диалогов Microsoft...');
        
        let dialogsHandled = 0;
        const maxDialogs = 5; // Максимум диалогов для обработки
        
        for (let i = 0; i < maxDialogs; i++) {
            try {
                await this.humanDelay(2000, 3000);
                
                const currentUrl = this.page.url();
                this.log('info', `📍 URL: ${currentUrl}`);
                
                // Если уже на CLINE - выходим
                if (currentUrl.includes('cline.bot') || currentUrl.includes('dashboard')) {
                    this.log('info', '✅ Уже на CLINE, диалоги обработаны');
                    break;
                }
                
                // Получаем текст страницы безопасно
                const pageContent = await this.safeAction(async () => {
                    return await this.page.evaluate(() => ({
                        text: document.body.innerText.toLowerCase(),
                        title: document.title.toLowerCase()
                    }));
                }, 'получение контента страницы');
                
                if (!pageContent) continue;
                
                const { text, title } = pageContent;
                
                // ==========================================
                // Диалог 1: "Stay signed in?"
                // ==========================================
                if (text.includes('stay signed in') || text.includes('оставаться в системе') || 
                    title.includes('stay signed in')) {
                    this.log('info', '📋 Найден диалог "Stay signed in?"');
                    
                    // Нажимаем "No" (не оставаться в сессии)
                    const noClicked = await this.safeAction(async () => {
                        return await this.page.evaluate(() => {
                            // Сначала ищем кнопку "No" по ID (самый надёжный способ для MS)
                            const noBtn = document.querySelector('#idBtn_Back');
                            if (noBtn) {
                                console.log('Найдена кнопка No по ID:', noBtn);
                                noBtn.click();
                                return 'idBtn_Back';
                            }
                            
                            // Ищем по другим селекторам
                            const noSelectors = [
                                'button[id*="Back"]',
                                'input[value="No"]',
                                'input[id*="Back"]'
                            ];
                            
                            for (const selector of noSelectors) {
                                try {
                                    const btn = document.querySelector(selector);
                                    if (btn) {
                                        console.log('Найдена кнопка No:', selector);
                                        btn.click();
                                        return selector;
                                    }
                                } catch (e) {}
                            }
                            
                            // Ищем по тексту
                            const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
                            for (const btn of buttons) {
                                const btnText = (btn.textContent || btn.value || '').toLowerCase().trim();
                                if (btnText === 'no' || btnText === 'нет') {
                                    console.log('Найдена кнопка No по тексту:', btnText);
                                    btn.click();
                                    return 'text:no';
                                }
                            }
                            
                            // Логируем все кнопки для отладки
                            const allBtns = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
                            console.log('Все кнопки на странице:', Array.from(allBtns).map(b => ({
                                id: b.id,
                                text: b.textContent?.trim(),
                                value: b.value,
                                type: b.type
                            })));
                            
                            return false;
                        });
                    }, 'нажатие No');
                    
                    if (noClicked) {
                        this.log('info', `✅ Нажали "No" на "Stay signed in?" (способ: ${noClicked})`);
                        dialogsHandled++;
                        await this.humanDelay(3000, 5000);
                        continue;
                    } else {
                        this.log('warning', '⚠️ Не удалось найти кнопку No, пробуем другой способ...');
                        
                        // Пробуем через Puppeteer клик
                        const puppeteerClicked = await this.page.$('#idBtn_Back');
                        if (puppeteerClicked) {
                            await puppeteerClicked.click();
                            this.log('info', '✅ Нажали "No" через Puppeteer');
                            dialogsHandled++;
                            await this.humanDelay(3000, 5000);
                            continue;
                        }
                    }
                }
                
                // ==========================================
                // Диалог 2: Запрос разрешений (Permissions/Consent)
                // ==========================================
                if (text.includes('permission') || text.includes('consent') || 
                    text.includes('access') || text.includes('allow') ||
                    text.includes('approve') || text.includes('разрешения')) {
                    this.log('info', '📋 Найден диалог разрешений');
                    
                    const acceptClicked = await this.safeAction(async () => {
                        return await this.page.evaluate(() => {
                            const acceptSelectors = [
                                '#idSIButton9',
                                '#idBtn_Accept',
                                'input[value="Accept"]',
                                'input[value="Yes"]',
                                'button[type="submit"]'
                            ];
                            
                            for (const selector of acceptSelectors) {
                                const btn = document.querySelector(selector);
                                if (btn) {
                                    btn.click();
                                    return true;
                                }
                            }
                            
                            // Ищем по тексту
                            const buttons = document.querySelectorAll('button, input[type="submit"]');
                            for (const btn of buttons) {
                                const btnText = (btn.textContent || btn.value || '').toLowerCase();
                                if (btnText.includes('accept') || btnText.includes('yes') || 
                                    btnText.includes('allow') || btnText.includes('continue') ||
                                    btnText.includes('принять') || btnText.includes('да')) {
                                    btn.click();
                                    return true;
                                }
                            }
                            return false;
                        });
                    }, 'принятие разрешений');
                    
                    if (acceptClicked) {
                        this.log('info', '✅ Приняли разрешения');
                        dialogsHandled++;
                        await this.humanDelay(3000, 5000);
                        continue;
                    }
                }
                
                // ==========================================
                // Диалог 3: "Don't show this again" / "Keep me signed in"
                // ==========================================
                if (text.includes("don't show") || text.includes('keep me signed') ||
                    text.includes('remember')) {
                    this.log('info', '📋 Найден диалог "Don\'t show this again"');
                    
                    const dismissed = await this.safeAction(async () => {
                        return await this.page.evaluate(() => {
                            // Снимаем галочку если есть
                            const checkbox = document.querySelector('input[type="checkbox"]');
                            if (checkbox && checkbox.checked) {
                                checkbox.click();
                            }
                            
                            // Нажимаем No/Cancel
                            const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
                            for (const btn of buttons) {
                                const btnText = (btn.textContent || btn.value || '').toLowerCase();
                                if (btnText === 'no' || btnText.includes('cancel') || btnText.includes('skip')) {
                                    btn.click();
                                    return true;
                                }
                            }
                            
                            // Если нет кнопки No, нажимаем submit
                            const submitBtn = document.querySelector('#idSIButton9, button[type="submit"]');
                            if (submitBtn) {
                                submitBtn.click();
                                return true;
                            }
                            return false;
                        });
                    }, 'закрытие диалога');
                    
                    if (dismissed) {
                        this.log('info', '✅ Закрыли диалог');
                        dialogsHandled++;
                        await this.humanDelay(3000, 5000);
                        continue;
                    }
                }
                
                // Если ничего не найдено - пробуем общий submit
                if (currentUrl.includes('login.live.com') || currentUrl.includes('login.microsoftonline.com')) {
                    this.log('info', '🔍 Проверяем наличие кнопок на странице...');
                    
                    const anyClicked = await this.safeAction(async () => {
                        return await this.page.evaluate(() => {
                            // Приоритет кнопкам No/Back
                            const backBtn = document.querySelector('#idBtn_Back');
                            if (backBtn) {
                                backBtn.click();
                                return 'back';
                            }
                            
                            // Потом submit
                            const submitBtn = document.querySelector('#idSIButton9');
                            if (submitBtn) {
                                submitBtn.click();
                                return 'submit';
                            }
                            
                            return false;
                        });
                    }, 'клик по кнопке');
                    
                    if (anyClicked) {
                        this.log('info', `✅ Нажали кнопку: ${anyClicked}`);
                        dialogsHandled++;
                        await this.humanDelay(3000, 5000);
                        continue;
                    }
                }
                
                // Если никаких диалогов не найдено - выходим
                this.log('info', '📋 Диалогов больше не найдено');
                break;
                
            } catch (error) {
                if (error.message.includes('Execution context was destroyed') ||
                    error.message.includes('navigation')) {
                    this.log('info', '⚡ Навигация, ждём...');
                    await this.humanDelay(2000, 3000);
                    continue;
                }
                this.log('warning', `⚠️ Ошибка обработки диалога: ${error.message}`);
                break;
            }
        }
        
        this.log('info', `📊 Обработано диалогов: ${dialogsHandled}`);
        return dialogsHandled;
    }

    /**
     * Обработка диалогов на authkit.cline.bot (Accept, Continue, Allow и т.д.)
     */
    async handleClineAuthDialogs() {
        this.log('info', '🔄 Проверяем наличие диалогов CLINE Auth...');
        
        let dialogsHandled = 0;
        const maxDialogs = 5;
        
        for (let i = 0; i < maxDialogs; i++) {
            try {
                await this.humanDelay(2000, 3000);
                
                const currentUrl = this.page.url();
                this.log('info', `📍 CLINE URL: ${currentUrl}`);
                
                // Если уже на dashboard или app - выходим
                if (currentUrl.includes('app.cline.bot') || 
                    currentUrl.includes('dashboard') ||
                    currentUrl.includes('api.cline.bot/api/v1/auth/callback')) {
                    this.log('info', '✅ Авторизация CLINE завершена');
                    break;
                }
                
                // Проверяем что мы на authkit.cline.bot
                if (!currentUrl.includes('authkit.cline.bot') && !currentUrl.includes('cline.bot')) {
                    this.log('info', '📍 Не на CLINE, пропускаем...');
                    break;
                }
                
                // Получаем текст страницы
                const pageContent = await this.safeAction(async () => {
                    return await this.page.evaluate(() => ({
                        text: document.body.innerText.toLowerCase(),
                        title: document.title.toLowerCase(),
                        html: document.body.innerHTML.substring(0, 2000)
                    }));
                }, 'получение контента CLINE');
                
                if (!pageContent) continue;
                
                const { text, title, html } = pageContent;
                this.log('info', `📄 Текст страницы: ${text.substring(0, 200)}...`);
                
                // ==========================================
                // Диалог: Consent / Accept / Allow access
                // ==========================================
                if (text.includes('accept') || text.includes('allow') || 
                    text.includes('consent') || text.includes('authorize') ||
                    text.includes('continue') || text.includes('grant') ||
                    text.includes('permission') || text.includes('access')) {
                    
                    this.log('info', '📋 Найден диалог согласия CLINE');
                    
                    // Скриншот для отладки
                    await this.page.screenshot({ path: `cline_consent_dialog.png` });
                    
                    // Пробуем нажать Accept/Allow/Continue
                    const acceptClicked = await this.safeAction(async () => {
                        return await this.page.evaluate(() => {
                            // Сначала ищем по распространённым селекторам
                            const acceptSelectors = [
                                // Кнопки по ID
                                '#accept-button',
                                '#accept',
                                '#allow-button',
                                '#allow',
                                '#continue-button',
                                '#continue',
                                '#authorize-button',
                                '#authorize',
                                '#consent-button',
                                '#consent',
                                '#submit',
                                '#confirm',
                                // data атрибуты
                                '[data-testid="accept-button"]',
                                '[data-testid="allow-button"]',
                                '[data-testid="continue-button"]',
                                '[data-action="accept"]',
                                '[data-action="allow"]',
                                // Классы
                                '.accept-button',
                                '.allow-button',
                                '.continue-button',
                                '.consent-button',
                                '.authorize-button',
                                // Типы
                                'button[type="submit"]',
                                'input[type="submit"]'
                            ];
                            
                            for (const selector of acceptSelectors) {
                                try {
                                    const btn = document.querySelector(selector);
                                    if (btn && btn.offsetParent !== null) {
                                        console.log('Найдена кнопка по селектору:', selector);
                                        btn.click();
                                        return selector;
                                    }
                                } catch (e) {}
                            }
                            
                            // Ищем по тексту кнопки
                            const buttons = document.querySelectorAll('button, a[role="button"], div[role="button"], input[type="submit"], input[type="button"]');
                            const acceptTexts = ['accept', 'allow', 'continue', 'authorize', 'grant', 'yes', 'confirm', 'ok', 'принять', 'разрешить', 'продолжить'];
                            
                            for (const btn of buttons) {
                                const btnText = (btn.textContent || btn.value || '').toLowerCase().trim();
                                const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                                
                                for (const acceptText of acceptTexts) {
                                    if (btnText.includes(acceptText) || ariaLabel.includes(acceptText)) {
                                        console.log('Найдена кнопка по тексту:', btnText);
                                        btn.click();
                                        return `text:${btnText}`;
                                    }
                                }
                            }
                            
                            // Логируем все кнопки для отладки
                            const allBtns = document.querySelectorAll('button, a[role="button"], div[role="button"], input[type="submit"], input[type="button"]');
                            console.log('Все кнопки на CLINE:', Array.from(allBtns).map(b => ({
                                tag: b.tagName,
                                id: b.id,
                                text: b.textContent?.trim().substring(0, 50),
                                value: b.value,
                                className: b.className?.substring(0, 50),
                                visible: b.offsetParent !== null
                            })));
                            
                            return false;
                        });
                    }, 'нажатие Accept на CLINE');
                    
                    if (acceptClicked) {
                        this.log('info', `✅ Нажали Accept на CLINE (способ: ${acceptClicked})`);
                        dialogsHandled++;
                        await this.humanDelay(3000, 5000);
                        continue;
                    } else {
                        this.log('warning', '⚠️ Не удалось найти кнопку Accept, пробуем через Puppeteer...');
                        
                        // Пробуем через Puppeteer найти и кликнуть
                        const buttons = await this.page.$$('button, a[role="button"], input[type="submit"]');
                        
                        for (const btn of buttons) {
                            const text = await btn.evaluate(el => (el.textContent || el.value || '').toLowerCase().trim());
                            
                            if (text.includes('accept') || text.includes('allow') || 
                                text.includes('continue') || text.includes('authorize') ||
                                text.includes('yes') || text.includes('confirm')) {
                                this.log('info', `✅ Нашли кнопку через Puppeteer: "${text}"`);
                                await btn.click();
                                dialogsHandled++;
                                await this.humanDelay(3000, 5000);
                                break;
                            }
                        }
                    }
                }
                
                // ==========================================
                // Диалог: Ошибка или проблема
                // ==========================================
                if (text.includes('error') || text.includes('failed') || 
                    text.includes('problem') || text.includes('try again')) {
                    this.log('warning', '⚠️ Обнаружена ошибка на странице CLINE');
                    
                    // Ищем кнопку "Try again" или "Retry"
                    const retryClicked = await this.safeAction(async () => {
                        return await this.page.evaluate(() => {
                            const buttons = document.querySelectorAll('button, a');
                            for (const btn of buttons) {
                                const text = (btn.textContent || '').toLowerCase();
                                if (text.includes('try again') || text.includes('retry') || 
                                    text.includes('back') || text.includes('return')) {
                                    btn.click();
                                    return true;
                                }
                            }
                            return false;
                        });
                    }, 'нажатие Retry');
                    
                    if (retryClicked) {
                        this.log('info', '🔄 Нажали Try Again');
                        dialogsHandled++;
                        await this.humanDelay(3000, 5000);
                        continue;
                    }
                }
                
                // Если на странице нет явных диалогов - выходим
                this.log('info', '📋 Диалогов CLINE больше не найдено');
                break;
                
            } catch (error) {
                if (error.message.includes('Execution context was destroyed') ||
                    error.message.includes('navigation')) {
                    this.log('info', '⚡ Навигация на CLINE, ждём...');
                    await this.humanDelay(2000, 3000);
                    continue;
                }
                this.log('warning', `⚠️ Ошибка обработки диалога CLINE: ${error.message}`);
                break;
            }
        }
        
        this.log('info', `📊 Обработано диалогов CLINE: ${dialogsHandled}`);
        return dialogsHandled;
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

            // Ждём загрузки страницы и кнопок
            await this.humanDelay(3000, 5000);

            // Получаем список всех элементов на странице для отладки
            const pageInfo = await this.page.evaluate(() => {
                const allButtons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
                return allButtons.map(el => ({
                    tag: el.tagName,
                    text: el.textContent?.trim().substring(0, 100),
                    className: el.className,
                    id: el.id,
                    href: el.href || null
                }));
            });
            this.log('info', `📋 Найдено кликабельных элементов: ${pageInfo.length}`);
            
            // Логируем первые 10 элементов
            pageInfo.slice(0, 10).forEach((el, i) => {
                this.log('info', `  ${i}: [${el.tag}] "${el.text?.substring(0, 50)}" class="${el.className?.substring(0, 50)}"`);
            });

            // Ищем кнопку Microsoft разными способами
            let msButtonClicked = false;
            
            // Способ 1: Поиск по тексту содержащему "Microsoft"
            msButtonClicked = await this.page.evaluate(() => {
                // Ищем все кликабельные элементы
                const elements = document.querySelectorAll('button, a, div[role="button"], span[role="button"]');
                for (const el of elements) {
                    const text = (el.textContent || '').toLowerCase();
                    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                    
                    if (text.includes('microsoft') || ariaLabel.includes('microsoft')) {
                        console.log('Found Microsoft button:', el);
                        el.click();
                        return 'text';
                    }
                }
                return false;
            });

            if (!msButtonClicked) {
                this.log('info', '🔍 Способ 1 не сработал, пробуем способ 2...');
                
                // Способ 2: Поиск по изображению Microsoft или SVG
                msButtonClicked = await this.page.evaluate(() => {
                    // Ищем элементы с Microsoft иконкой
                    const imgs = document.querySelectorAll('img, svg');
                    for (const img of imgs) {
                        const src = img.src || img.getAttribute('src') || '';
                        const alt = img.alt || img.getAttribute('alt') || '';
                        
                        if (src.includes('microsoft') || alt.toLowerCase().includes('microsoft')) {
                            // Кликаем на родительский элемент
                            const parent = img.closest('button, a, div[role="button"]');
                            if (parent) {
                                parent.click();
                                return 'icon';
                            }
                        }
                    }
                    return false;
                });
            }

            if (!msButtonClicked) {
                this.log('info', '🔍 Способ 2 не сработал, пробуем способ 3...');
                
                // Способ 3: Поиск по классу или data атрибутам
                msButtonClicked = await this.page.evaluate(() => {
                    const selectors = [
                        '[data-provider="microsoft"]',
                        '[data-testid*="microsoft"]',
                        '[class*="microsoft"]',
                        '[class*="Microsoft"]',
                        'button[name*="microsoft"]',
                        'a[href*="microsoft"]'
                    ];
                    
                    for (const selector of selectors) {
                        const el = document.querySelector(selector);
                        if (el) {
                            el.click();
                            return 'selector';
                        }
                    }
                    return false;
                });
            }

            if (!msButtonClicked) {
                this.log('info', '🔍 Способ 3 не сработал, пробуем способ 4 (все кнопки)...');
                
                // Способ 4: Перебираем все кнопки через Puppeteer
                const buttons = await this.page.$$('button, a[class*="btn"], div[role="button"]');
                this.log('info', `📋 Всего кнопок для проверки: ${buttons.length}`);
                
                for (const btn of buttons) {
                    const text = await btn.evaluate(el => el.textContent || '');
                    const outerHTML = await btn.evaluate(el => el.outerHTML.substring(0, 200));
                    this.log('info', `  Кнопка: "${text.trim().substring(0, 50)}" HTML: ${outerHTML.substring(0, 100)}`);
                    
                    if (text.toLowerCase().includes('microsoft') || 
                        text.toLowerCase().includes('continue with') ||
                        outerHTML.toLowerCase().includes('microsoft')) {
                        this.log('info', '✅ Нашли кнопку Microsoft, кликаем...');
                        await btn.click();
                        msButtonClicked = 'puppeteer';
                        break;
                    }
                }
            }

            if (!msButtonClicked) {
                this.log('warning', '⚠️ Кнопка Microsoft не найдена! Сохраняем HTML страницы...');
                
                // Сохраняем HTML для отладки
                const html = await this.page.content();
                require('fs').writeFileSync(`cline_debug_${accountId}.html`, html);
                this.log('info', `💾 HTML сохранён в cline_debug_${accountId}.html`);
            } else {
                this.log('info', `✅ Нажали на Microsoft (способ: ${msButtonClicked}), ожидаем редирект...`);
            }

            // Ждём редирект на Microsoft
            await this.humanDelay(5000, 7000);

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
                await this.handleMicrosoftDialogs();
            }

            // ==========================================
            // ЭТАП 5.5: Обработка кнопок на authkit.cline.bot
            // ==========================================
            await this.handleClineAuthDialogs();

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
