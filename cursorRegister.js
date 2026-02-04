/**
 * Модуль регистрации аккаунтов Cursor AI
 * Использует Puppeteer для автоматизации браузера
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { generateFullName, generateUserAgent, generateViewport } = require('./nameGenerator');
const db = require('./database');

// Подключаем stealth плагин для обхода обнаружения
puppeteer.use(StealthPlugin());

// Конфигурация
const CONFIG = {
    CURSOR_URL: 'https://cursor.com',
    SIGNUP_URL: 'https://authenticator.cursor.sh/sign-up',
    LOGIN_URL: 'https://authenticator.cursor.sh/sign-in',
    SETTINGS_URL: 'https://cursor.com/settings',
    TIMEOUT: parseInt(process.env.TIMEOUT) || 60000,
    SLOW_MO: parseInt(process.env.SLOW_MO) || 50,
    HEADLESS: process.env.HEADLESS !== 'false'
};

// Класс для регистрации аккаунта
class CursorRegister {
    constructor(sessionId, proxies = []) {
        this.sessionId = sessionId;
        this.proxies = proxies;
        this.currentProxyIndex = 0;
        this.browser = null;
        this.page = null;
    }

    /**
     * Получение следующего прокси из списка (ротация)
     */
    getNextProxy() {
        if (this.proxies.length === 0) return null;
        const proxy = this.proxies[this.currentProxyIndex];
        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
        return proxy;
    }

    /**
     * Логирование с сохранением в БД
     */
    log(level, message) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
        db.addLog(this.sessionId, level, message);
    }

    /**
     * Запуск браузера
     */
    async launchBrowser(proxy = null) {
        const viewport = generateViewport();
        const userAgent = generateUserAgent();

        const launchOptions = {
            headless: CONFIG.HEADLESS ? 'new' : false,
            slowMo: CONFIG.SLOW_MO,
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
            defaultViewport: viewport
        };

        // Добавляем прокси если есть
        if (proxy) {
            launchOptions.args.push(`--proxy-server=${proxy}`);
            this.log('info', `Используем прокси: ${proxy}`);
        }

        this.browser = await puppeteer.launch(launchOptions);
        this.page = await this.browser.newPage();

        // Устанавливаем User-Agent
        await this.page.setUserAgent(userAgent);

        // Настраиваем viewport
        await this.page.setViewport(viewport);

        // Добавляем дополнительные заголовки
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        });

        // Перехват для подмены webdriver
        await this.page.evaluateOnNewDocument(() => {
            // Скрываем признаки автоматизации
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            
            // Подменяем Chrome runtime
            window.chrome = { runtime: {} };
            
            // Подменяем permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' 
                    ? Promise.resolve({ state: Notification.permission }) 
                    : originalQuery(parameters)
            );
        });

        this.log('info', 'Браузер запущен');
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
     * Ожидание с рандомной задержкой (имитация человека)
     */
    async humanDelay(min = 500, max = 1500) {
        const delay = Math.floor(Math.random() * (max - min) + min);
        await new Promise(r => setTimeout(r, delay));
    }

    /**
     * Ввод текста с имитацией набора
     */
    async humanType(selector, text) {
        await this.page.waitForSelector(selector, { timeout: CONFIG.TIMEOUT });
        await this.page.click(selector);
        await this.humanDelay(100, 300);
        
        // Очищаем поле
        await this.page.evaluate((sel) => {
            document.querySelector(sel).value = '';
        }, selector);
        
        // Печатаем посимвольно
        for (const char of text) {
            await this.page.type(selector, char, { delay: Math.random() * 100 + 30 });
        }
    }

    /**
     * Клик с имитацией человека
     */
    async humanClick(selector) {
        await this.page.waitForSelector(selector, { timeout: CONFIG.TIMEOUT });
        await this.humanDelay(200, 500);
        
        // Наводим мышку перед кликом
        const element = await this.page.$(selector);
        if (element) {
            const box = await element.boundingBox();
            if (box) {
                await this.page.mouse.move(
                    box.x + box.width / 2 + (Math.random() * 10 - 5),
                    box.y + box.height / 2 + (Math.random() * 10 - 5)
                );
            }
        }
        
        await this.humanDelay(100, 200);
        await this.page.click(selector);
    }

    /**
     * Проверка наличия CAPTCHA
     */
    async checkForCaptcha() {
        const captchaSelectors = [
            'iframe[src*="captcha"]',
            'iframe[src*="recaptcha"]',
            'iframe[src*="hcaptcha"]',
            '.cf-turnstile',
            '#cf-turnstile',
            '[data-turnstile]',
            '.g-recaptcha',
            '.h-captcha'
        ];

        for (const selector of captchaSelectors) {
            const captcha = await this.page.$(selector);
            if (captcha) {
                this.log('warning', `Обнаружена CAPTCHA: ${selector}`);
                return true;
            }
        }
        return false;
    }

    /**
     * Ожидание и попытка решить Turnstile CAPTCHA
     */
    async waitForTurnstile() {
        try {
            // Ждём появления Turnstile
            const turnstileFrame = await this.page.$('iframe[src*="challenges.cloudflare.com"]');
            if (!turnstileFrame) {
                return true; // Нет капчи - успех
            }

            this.log('info', 'Ожидание решения Cloudflare Turnstile...');
            
            // Ждём до 30 секунд пока капча решится автоматически (иногда stealth помогает)
            for (let i = 0; i < 30; i++) {
                await this.humanDelay(1000, 1000);
                
                // Проверяем, исчезла ли капча или появился успех
                const stillThere = await this.page.$('iframe[src*="challenges.cloudflare.com"]');
                if (!stillThere) {
                    this.log('info', 'Turnstile решена');
                    return true;
                }
                
                // Проверяем, не произошла ли навигация
                const currentUrl = this.page.url();
                if (!currentUrl.includes('challenges.cloudflare.com')) {
                    return true;
                }
            }

            this.log('error', 'Не удалось решить Turnstile за 30 секунд');
            return false;
        } catch (error) {
            this.log('error', `Ошибка при ожидании Turnstile: ${error.message}`);
            return false;
        }
    }

    /**
     * Регистрация нового аккаунта Cursor
     */
    async registerAccount(accountId, email, password) {
        const startTime = Date.now();
        const proxy = this.getNextProxy();
        const { firstName, lastName, fullName } = generateFullName(true);

        // Обновляем статус в БД
        db.updateAccount(accountId, {
            status: 'processing',
            first_name: firstName,
            last_name: lastName,
            full_name: fullName,
            proxy_used: proxy || 'direct'
        });

        this.log('info', `Начинаем регистрацию: ${email} (${fullName})`);

        try {
            // Запускаем браузер
            await this.launchBrowser(proxy);

            // Переходим на страницу регистрации
            this.log('info', 'Переход на страницу регистрации...');
            await this.page.goto(CONFIG.SIGNUP_URL, { 
                waitUntil: 'networkidle2',
                timeout: CONFIG.TIMEOUT 
            });

            await this.humanDelay(1000, 2000);

            // Проверяем CAPTCHA
            const hasCaptcha = await this.checkForCaptcha();
            if (hasCaptcha) {
                const captchaSolved = await this.waitForTurnstile();
                if (!captchaSolved) {
                    throw new Error('CAPTCHA не решена');
                }
            }

            // Делаем скриншот для отладки
            await this.page.screenshot({ 
                path: `debug_signup_${accountId}.png`,
                fullPage: true 
            });

            // Ищем форму регистрации
            // Cursor использует разные варианты форм, пробуем найти нужные поля
            
            // Вариант 1: Регистрация через email
            const emailInput = await this.page.$('input[type="email"], input[name="email"], input[placeholder*="email" i]');
            
            if (emailInput) {
                // Вводим email
                this.log('info', 'Ввод email...');
                await this.humanType('input[type="email"], input[name="email"], input[placeholder*="email" i]', email);
                await this.humanDelay(500, 1000);

                // Ищем поле имени (если есть)
                const nameInput = await this.page.$('input[name="name"], input[placeholder*="name" i], input[name="firstName"]');
                if (nameInput) {
                    this.log('info', 'Ввод имени...');
                    await this.humanType('input[name="name"], input[placeholder*="name" i], input[name="firstName"]', fullName);
                    await this.humanDelay(500, 1000);
                }

                // Ищем поле пароля
                const passwordInput = await this.page.$('input[type="password"], input[name="password"]');
                if (passwordInput) {
                    this.log('info', 'Ввод пароля...');
                    await this.humanType('input[type="password"], input[name="password"]', password);
                    await this.humanDelay(500, 1000);
                }

                // Ищем и кликаем кнопку подтверждения
                this.log('info', 'Поиск кнопки отправки формы...');
                const buttonClicked = await this.page.evaluate(() => {
                    // Сначала ищем submit button
                    const submitBtn = document.querySelector('button[type="submit"]');
                    if (submitBtn) {
                        submitBtn.click();
                        return true;
                    }
                    // Ищем по тексту
                    const buttons = document.querySelectorAll('button');
                    for (const btn of buttons) {
                        const text = btn.textContent.toLowerCase();
                        if (text.includes('sign up') || 
                            text.includes('continue') ||
                            text.includes('create account') ||
                            text.includes('register') ||
                            text.includes('submit')) {
                            btn.click();
                            return true;
                        }
                    }
                    return false;
                });
                
                if (buttonClicked) {
                    this.log('info', 'Форма отправлена');
                } else {
                    this.log('warning', 'Кнопка отправки не найдена');
                }
            } else {
                // Альтернативный поток - может быть OAuth или magic link
                this.log('warning', 'Стандартная форма не найдена, проверяем альтернативные методы...');
                
                // Делаем скриншот текущего состояния
                await this.page.screenshot({ 
                    path: `debug_alt_${accountId}.png`,
                    fullPage: true 
                });
                
                // Проверяем наличие кнопки "Sign up with email"
                const emailSignupClicked = await this.page.evaluate(() => {
                    const elements = [...document.querySelectorAll('button, a')];
                    for (const el of elements) {
                        if (el.textContent.toLowerCase().includes('email')) {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                });
                
                if (emailSignupClicked) {
                    this.log('info', 'Кликнули на кнопку email');
                    await this.humanDelay(1000, 2000);
                }
            }

            // Ждём результата
            await this.humanDelay(3000, 5000);

            // Проверяем успешность регистрации
            const currentUrl = this.page.url();
            const pageContent = await this.page.content();

            // Проверяем на ошибки
            const errorMessages = [
                'already exists',
                'already registered',
                'email is taken',
                'account already',
                'invalid email',
                'password too weak',
                'error',
                'failed'
            ];

            let hasError = false;
            for (const errorMsg of errorMessages) {
                if (pageContent.toLowerCase().includes(errorMsg)) {
                    hasError = true;
                    this.log('error', `Обнаружена ошибка: ${errorMsg}`);
                    break;
                }
            }

            if (hasError) {
                throw new Error('Ошибка регистрации - email может быть уже зарегистрирован');
            }

            // Проверяем на страницу подтверждения email
            if (pageContent.toLowerCase().includes('verify') || 
                pageContent.toLowerCase().includes('confirmation') ||
                pageContent.toLowerCase().includes('check your email')) {
                this.log('info', 'Требуется подтверждение email');
                
                // Для автоматизации нужно было бы проверить почту
                // Здесь мы просто отмечаем, что регистрация прошла
                const processingTime = Date.now() - startTime;
                
                db.updateAccount(accountId, {
                    status: 'success',
                    trial_status: 'pending_verification',
                    error_message: 'Требуется подтверждение email',
                    processing_time: processingTime
                });

                this.log('info', `✅ Регистрация успешна (ожидает подтверждения): ${email}`);
                await this.closeBrowser();
                return { success: true, needsVerification: true };
            }

            // Если мы дошли сюда - проверяем trial статус
            const trialResult = await this.checkTrialStatus();
            const processingTime = Date.now() - startTime;

            db.updateAccount(accountId, {
                status: 'success',
                trial_status: trialResult.hasTriaI ? 'active' : 'none',
                trial_days: trialResult.trialDays || 0,
                processing_time: processingTime
            });

            this.log('info', `✅ Регистрация успешна: ${email}, Trial: ${trialResult.hasTriaI ? 'Да' : 'Нет'}`);

            await this.closeBrowser();
            return { success: true, trial: trialResult };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            this.log('error', `❌ Ошибка регистрации ${email}: ${error.message}`);
            
            db.updateAccount(accountId, {
                status: 'failed',
                trial_status: 'error',
                error_message: error.message.substring(0, 500),
                processing_time: processingTime
            });

            await this.closeBrowser();
            return { success: false, error: error.message };
        }
    }

    /**
     * Попытка входа в существующий аккаунт
     */
    async loginAccount(accountId, email, password) {
        const startTime = Date.now();
        const proxy = this.getNextProxy();

        db.updateAccount(accountId, {
            status: 'processing',
            proxy_used: proxy || 'direct'
        });

        this.log('info', `Попытка входа: ${email}`);

        try {
            await this.launchBrowser(proxy);

            // Переходим на страницу входа
            await this.page.goto(CONFIG.LOGIN_URL, { 
                waitUntil: 'networkidle2',
                timeout: CONFIG.TIMEOUT 
            });

            await this.humanDelay(1000, 2000);

            // Проверяем CAPTCHA
            const hasCaptcha = await this.checkForCaptcha();
            if (hasCaptcha) {
                const captchaSolved = await this.waitForTurnstile();
                if (!captchaSolved) {
                    throw new Error('CAPTCHA не решена');
                }
            }

            // Вводим email
            await this.humanType('input[type="email"], input[name="email"]', email);
            await this.humanDelay(500, 1000);

            // Вводим пароль
            const passwordInput = await this.page.$('input[type="password"]');
            if (passwordInput) {
                await this.humanType('input[type="password"]', password);
                await this.humanDelay(500, 1000);
            }

            // Нажимаем кнопку входа
            await this.page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    if (btn.textContent.toLowerCase().includes('sign in') || 
                        btn.textContent.toLowerCase().includes('log in') ||
                        btn.textContent.toLowerCase().includes('continue')) {
                        btn.click();
                        return;
                    }
                }
                // Если не нашли - кликаем submit
                const submitBtn = document.querySelector('button[type="submit"]');
                if (submitBtn) submitBtn.click();
            });

            await this.humanDelay(3000, 5000);

            // Проверяем успешность входа
            const currentUrl = this.page.url();
            
            if (currentUrl.includes('dashboard') || 
                currentUrl.includes('settings') ||
                currentUrl.includes('cursor.com') && !currentUrl.includes('sign-in')) {
                
                // Проверяем trial статус
                const trialResult = await this.checkTrialStatus();
                const processingTime = Date.now() - startTime;

                // Генерируем имя если его нет
                const { firstName, lastName, fullName } = generateFullName(true);

                db.updateAccount(accountId, {
                    status: 'success',
                    first_name: firstName,
                    last_name: lastName,
                    full_name: fullName,
                    trial_status: trialResult.hasTriaI ? 'active' : 'none',
                    trial_days: trialResult.trialDays || 0,
                    processing_time: processingTime
                });

                this.log('info', `✅ Вход успешен: ${email}, Trial: ${trialResult.hasTriaI ? 'Да' : 'Нет'}`);

                await this.closeBrowser();
                return { success: true, trial: trialResult };
            } else {
                throw new Error('Не удалось войти - проверьте логин/пароль');
            }

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            this.log('error', `❌ Ошибка входа ${email}: ${error.message}`);
            
            db.updateAccount(accountId, {
                status: 'failed',
                trial_status: 'error',
                error_message: error.message.substring(0, 500),
                processing_time: processingTime
            });

            await this.closeBrowser();
            return { success: false, error: error.message };
        }
    }

    /**
     * Проверка статуса Pro Trial
     */
    async checkTrialStatus() {
        try {
            this.log('info', 'Проверка статуса Trial...');

            // Переходим на страницу настроек
            await this.page.goto(CONFIG.SETTINGS_URL, { 
                waitUntil: 'networkidle2',
                timeout: CONFIG.TIMEOUT 
            });

            await this.humanDelay(2000, 3000);

            const pageContent = await this.page.content();
            const pageText = await this.page.evaluate(() => document.body.innerText);

            // Ищем индикаторы Pro Trial
            const trialIndicators = [
                'pro trial',
                'trial active',
                '7 days',
                '7 day trial',
                'free trial',
                'trial period',
                'days remaining',
                'trial expires'
            ];

            let hasTriaI = false;
            let trialDays = 0;

            for (const indicator of trialIndicators) {
                if (pageText.toLowerCase().includes(indicator)) {
                    hasTriaI = true;
                    
                    // Пробуем найти количество дней
                    const daysMatch = pageText.match(/(\d+)\s*days?\s*(remaining|left|trial)/i);
                    if (daysMatch) {
                        trialDays = parseInt(daysMatch[1]);
                    } else {
                        trialDays = 7; // По умолчанию 7 дней
                    }
                    break;
                }
            }

            // Альтернативно проверяем через API
            try {
                const billingResponse = await this.page.evaluate(async () => {
                    try {
                        const response = await fetch('/api/billing/status', {
                            credentials: 'include'
                        });
                        return await response.json();
                    } catch {
                        return null;
                    }
                });

                if (billingResponse && billingResponse.trial) {
                    hasTriaI = true;
                    trialDays = billingResponse.trialDaysRemaining || 7;
                }
            } catch (e) {
                // Игнорируем ошибки API
            }

            this.log('info', `Trial статус: ${hasTriaI ? `Активен (${trialDays} дней)` : 'Нет trial'}`);

            return { hasTriaI, trialDays };

        } catch (error) {
            this.log('error', `Ошибка проверки trial: ${error.message}`);
            return { hasTriaI: false, trialDays: 0 };
        }
    }

    /**
     * Обработка одного аккаунта (регистрация или логин)
     * @param {Object} account - данные аккаунта из БД
     * @param {string} mode - 'register' или 'login'
     */
    async processAccount(account, mode = 'register') {
        if (mode === 'register') {
            return await this.registerAccount(account.id, account.email, account.password);
        } else {
            return await this.loginAccount(account.id, account.email, account.password);
        }
    }
}

// Экспорт класса
module.exports = CursorRegister;
