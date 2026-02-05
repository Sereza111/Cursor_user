/**
 * Модуль регистрации аккаунтов Cursor AI
 * Использует Puppeteer для автоматизации браузера
 * Поддержка FlareSolverr для обхода Cloudflare
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { generateFullName, generateUserAgent, generateViewport } = require('./nameGenerator');
const db = require('./database');
const mailReader = require('./mailReader');

// Подключаем stealth плагин с максимальными настройками
const stealthPlugin = StealthPlugin();
// Включаем все evasions
stealthPlugin.enabledEvasions.add('chrome.app');
stealthPlugin.enabledEvasions.add('chrome.csi');
stealthPlugin.enabledEvasions.add('chrome.loadTimes');
stealthPlugin.enabledEvasions.add('chrome.runtime');
stealthPlugin.enabledEvasions.add('defaultArgs');
stealthPlugin.enabledEvasions.add('iframe.contentWindow');
stealthPlugin.enabledEvasions.add('media.codecs');
stealthPlugin.enabledEvasions.add('navigator.hardwareConcurrency');
stealthPlugin.enabledEvasions.add('navigator.languages');
stealthPlugin.enabledEvasions.add('navigator.permissions');
stealthPlugin.enabledEvasions.add('navigator.plugins');
stealthPlugin.enabledEvasions.add('navigator.webdriver');
stealthPlugin.enabledEvasions.add('sourceurl');
stealthPlugin.enabledEvasions.add('user-agent-override');
stealthPlugin.enabledEvasions.add('webgl.vendor');
stealthPlugin.enabledEvasions.add('window.outerdimensions');

puppeteer.use(stealthPlugin);

// Настройки проверки почты
const getMailConfig = () => ({
    enabled: process.env.MAIL_VERIFICATION_ENABLED === 'true'
});

// Флаг включения автоматической проверки почты
const MAIL_VERIFICATION_ENABLED = process.env.MAIL_VERIFICATION_ENABLED === 'true';

// FlareSolverr конфигурация
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';
const FLARESOLVERR_ENABLED = process.env.FLARESOLVERR_ENABLED === 'true';

// Режим ожидания капчи (для ручного решения через VNC)
const CAPTCHA_WAIT_MODE = process.env.CAPTCHA_WAIT_MODE === 'true';
const CAPTCHA_WAIT_TIMEOUT = parseInt(process.env.CAPTCHA_WAIT_TIMEOUT) || 300; // 5 минут по умолчанию

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
        this.flareSolverrCookies = null;
        this.flareSolverrUserAgent = null;
    }

    /**
     * Получение куки через FlareSolverr для обхода Cloudflare
     * @param {string} url - URL для получения куки
     * @param {string} proxy - прокси сервер (опционально)
     * @returns {Object|null} - куки и user-agent или null при ошибке
     */
    async getFlareSolverrSession(url, proxy = null) {
        if (!FLARESOLVERR_ENABLED) {
            this.log('info', 'FlareSolverr отключён, пропускаем...');
            return null;
        }

        this.log('info', `🌐 FlareSolverr: Получение сессии для ${url}...`);

        try {
            const requestBody = {
                cmd: 'request.get',
                url: url,
                maxTimeout: 60000
            };

            // Добавляем прокси если есть
            if (proxy) {
                requestBody.proxy = {
                    url: proxy
                };
            }

            const response = await fetch(FLARESOLVERR_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`FlareSolverr HTTP error: ${response.status}`);
            }

            const data = await response.json();

            if (data.status === 'ok' && data.solution) {
                this.log('info', `✅ FlareSolverr: Получены куки (${data.solution.cookies?.length || 0} шт.)`);
                
                this.flareSolverrCookies = data.solution.cookies || [];
                this.flareSolverrUserAgent = data.solution.userAgent;

                return {
                    cookies: data.solution.cookies,
                    userAgent: data.solution.userAgent,
                    response: data.solution.response
                };
            } else {
                this.log('warning', `⚠️ FlareSolverr: Не удалось получить сессию - ${data.message || 'Unknown error'}`);
                return null;
            }
        } catch (error) {
            this.log('error', `❌ FlareSolverr ошибка: ${error.message}`);
            return null;
        }
    }

    /**
     * Применение куки FlareSolverr к странице Puppeteer
     */
    async applyFlareSolverrCookies() {
        if (!this.flareSolverrCookies || this.flareSolverrCookies.length === 0) {
            return false;
        }

        try {
            // Преобразуем куки в формат Puppeteer
            const puppeteerCookies = this.flareSolverrCookies.map(cookie => ({
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path || '/',
                expires: cookie.expiry ? cookie.expiry : -1,
                httpOnly: cookie.httpOnly || false,
                secure: cookie.secure || false,
                sameSite: cookie.sameSite || 'Lax'
            }));

            await this.page.setCookie(...puppeteerCookies);
            this.log('info', `🍪 Применено ${puppeteerCookies.length} куки от FlareSolverr`);
            return true;
        } catch (error) {
            this.log('error', `Ошибка применения куки: ${error.message}`);
            return false;
        }
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
     * Парсинг прокси строки с поддержкой авторизации
     * Поддерживаемые форматы:
     * - host:port
     * - host:port@user:pass
     * - user:pass@host:port
     * - http://user:pass@host:port
     */
    parseProxy(proxyString) {
        if (!proxyString) return null;
        
        let host, port, username, password;
        
        // Убираем протокол если есть
        let proxy = proxyString.replace(/^https?:\/\//, '');
        
        // Формат: host:port@user:pass
        if (proxy.includes('@')) {
            const atIndex = proxy.indexOf('@');
            const beforeAt = proxy.substring(0, atIndex);
            const afterAt = proxy.substring(atIndex + 1);
            
            // Определяем где host:port, а где user:pass
            // Если beforeAt содержит точку - это скорее всего host
            if (beforeAt.includes('.') || beforeAt.includes(':') && beforeAt.split(':')[0].match(/^\d+$/)) {
                // Формат: host:port@user:pass
                const hostParts = beforeAt.split(':');
                host = hostParts[0];
                port = hostParts[1];
                const authParts = afterAt.split(':');
                username = authParts[0];
                password = authParts.slice(1).join(':'); // Пароль может содержать :
            } else {
                // Формат: user:pass@host:port
                const authParts = beforeAt.split(':');
                username = authParts[0];
                password = authParts.slice(1).join(':');
                const hostParts = afterAt.split(':');
                host = hostParts[0];
                port = hostParts[1];
            }
        } else {
            // Формат: host:port (без авторизации)
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
            // URL для --proxy-server (без авторизации)
            serverUrl: `${host}:${port}`,
            // Полный URL
            fullUrl: username ? `http://${username}:${password}@${host}:${port}` : `http://${host}:${port}`
        };
    }

    /**
     * Запуск браузера с максимальной маскировкой
     */
    async launchBrowser(proxy = null) {
        const viewport = generateViewport();
        const userAgent = generateUserAgent();
        
        // Парсим прокси
        const proxyConfig = this.parseProxy(proxy);

        const launchOptions = {
            headless: CONFIG.HEADLESS,
            slowMo: CONFIG.SLOW_MO,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--no-zygote',
                '--single-process',
                '--disable-software-rasterizer',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--lang=en-US,en',
                // Дополнительные флаги для обхода детекции
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials',
                '--disable-web-security',
                '--allow-running-insecure-content',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
                '--disable-background-timer-throttling',
                '--enable-features=NetworkService,NetworkServiceInProcess',
                '--force-color-profile=srgb',
                '--metrics-recording-only',
                '--no-first-run',
                '--password-store=basic',
                '--use-mock-keychain',
                '--export-tagged-pdf',
                '--disable-popup-blocking',
                // Скрываем автоматизацию
                '--disable-automation',
                '--disable-blink-automation',
                // WebGL и Canvas
                '--enable-webgl',
                '--use-gl=swiftshader',
                '--enable-webgl-draft-extensions',
                // Аудио/Видео
                '--autoplay-policy=user-gesture-required',
                '--disable-background-media-suspend'
            ],
            defaultViewport: null, // Используем полный размер окна
            ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection']
        };

        // Добавляем прокси если есть
        if (proxyConfig) {
            launchOptions.args.push(`--proxy-server=${proxyConfig.serverUrl}`);
            this.log('info', `🌐 Используем прокси: ${proxyConfig.serverUrl}${proxyConfig.hasAuth ? ' (с авторизацией)' : ''}`);
        }

        this.browser = await puppeteer.launch(launchOptions);
        this.page = await this.browser.newPage();
        
        // Если прокси требует авторизации - устанавливаем credentials
        if (proxyConfig && proxyConfig.hasAuth) {
            await this.page.authenticate({
                username: proxyConfig.username,
                password: proxyConfig.password
            });
            this.log('info', `🔐 Прокси авторизация установлена: ${proxyConfig.username}`);
        }

        // Устанавливаем User-Agent (реальный Chrome)
        await this.page.setUserAgent(userAgent);

        // Настраиваем viewport
        await this.page.setViewport(viewport);

        // Добавляем дополнительные заголовки как у реального браузера
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'max-age=0',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1'
        });

        // Расширенная маскировка признаков автоматизации
        await this.page.evaluateOnNewDocument(() => {
            // ========================================
            // 1. Удаляем webdriver флаг
            // ========================================
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
                configurable: true
            });
            
            // Удаляем из prototype
            delete Navigator.prototype.webdriver;
            
            // ========================================
            // 2. Подменяем plugins (как у реального Chrome)
            // ========================================
            Object.defineProperty(navigator, 'plugins', {
                get: () => {
                    const plugins = [
                        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                    ];
                    const pluginArray = Object.create(PluginArray.prototype);
                    plugins.forEach((p, i) => {
                        const plugin = Object.create(Plugin.prototype);
                        Object.defineProperties(plugin, {
                            name: { value: p.name },
                            filename: { value: p.filename },
                            description: { value: p.description },
                            length: { value: 1 }
                        });
                        pluginArray[i] = plugin;
                    });
                    Object.defineProperty(pluginArray, 'length', { value: plugins.length });
                    return pluginArray;
                }
            });
            
            // ========================================
            // 3. Languages
            // ========================================
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
            });
            
            Object.defineProperty(navigator, 'language', {
                get: () => 'en-US'
            });
            
            // ========================================
            // 4. Hardware Concurrency (реалистичное значение)
            // ========================================
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => 8
            });
            
            // ========================================
            // 5. Device Memory
            // ========================================
            Object.defineProperty(navigator, 'deviceMemory', {
                get: () => 8
            });
            
            // ========================================
            // 6. Platform
            // ========================================
            Object.defineProperty(navigator, 'platform', {
                get: () => 'Win32'
            });
            
            // ========================================
            // 7. Chrome runtime (важно для детекции)
            // ========================================
            window.chrome = {
                app: {
                    isInstalled: false,
                    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
                },
                runtime: {
                    OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
                    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
                    PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                    PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                    PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
                    RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
                    connect: function() {},
                    sendMessage: function() {}
                },
                csi: function() {},
                loadTimes: function() {}
            };
            
            // ========================================
            // 8. Permissions API
            // ========================================
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
            
            // ========================================
            // 9. WebGL маскировка
            // ========================================
            const getParameterProto = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                // UNMASKED_VENDOR_WEBGL
                if (parameter === 37445) {
                    return 'Google Inc. (NVIDIA)';
                }
                // UNMASKED_RENDERER_WEBGL
                if (parameter === 37446) {
                    return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                }
                return getParameterProto.call(this, parameter);
            };
            
            // WebGL2
            const getParameterProto2 = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) {
                    return 'Google Inc. (NVIDIA)';
                }
                if (parameter === 37446) {
                    return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                }
                return getParameterProto2.call(this, parameter);
            };
            
            // ========================================
            // 10. Canvas fingerprint protection
            // ========================================
            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function(type) {
                if (type === 'image/png' && this.width === 220 && this.height === 30) {
                    // Это вероятно fingerprint тест - добавляем шум
                    const context = this.getContext('2d');
                    const imageData = context.getImageData(0, 0, this.width, this.height);
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        imageData.data[i] = imageData.data[i] ^ (Math.random() * 2);
                    }
                    context.putImageData(imageData, 0, 0);
                }
                return originalToDataURL.apply(this, arguments);
            };
            
            // ========================================
            // 11. Отключаем automation флаги
            // ========================================
            Object.defineProperty(document, 'hidden', { get: () => false });
            Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
            
            // ========================================
            // 12. Connection API
            // ========================================
            Object.defineProperty(navigator, 'connection', {
                get: () => ({
                    effectiveType: '4g',
                    rtt: 50,
                    downlink: 10,
                    saveData: false
                })
            });
            
            // ========================================
            // 13. Battery API
            // ========================================
            Object.defineProperty(navigator, 'getBattery', {
                value: () => Promise.resolve({
                    charging: true,
                    chargingTime: 0,
                    dischargingTime: Infinity,
                    level: 1.0
                })
            });
            
            // ========================================
            // 14. Timezone
            // ========================================
            Date.prototype.getTimezoneOffset = function() {
                return -180; // Moscow timezone (UTC+3)
            };
        });

        this.log('info', '🚀 Браузер запущен с улучшенной маскировкой');
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
     * Клик на кнопку Continue/Submit с поиском по тексту
     * @returns {boolean} - Была ли нажата кнопка
     */
    async clickContinueButton() {
        try {
            const clicked = await this.page.evaluate(() => {
                // Приоритет 1: Кнопка type="submit"
                const submitBtn = document.querySelector('button[type="submit"]');
                if (submitBtn && !submitBtn.disabled) {
                    submitBtn.click();
                    return 'submit';
                }
                
                // Приоритет 2: Поиск по тексту кнопки
                const buttons = document.querySelectorAll('button');
                const buttonTexts = ['continue', 'sign up', 'create account', 'register', 'submit', 'next'];
                
                for (const btn of buttons) {
                    if (btn.disabled) continue;
                    const text = btn.textContent.toLowerCase().trim();
                    for (const searchText of buttonTexts) {
                        if (text.includes(searchText)) {
                            btn.click();
                            return text;
                        }
                    }
                }
                
                // Приоритет 3: Любая видимая кнопка с типом submit или primary стилем
                const primaryBtn = document.querySelector('button.primary, button.btn-primary, button[data-testid*="submit"]');
                if (primaryBtn && !primaryBtn.disabled) {
                    primaryBtn.click();
                    return 'primary';
                }
                
                return null;
            });
            
            if (clicked) {
                this.log('info', `✅ Нажата кнопка: "${clicked}"`);
                return true;
            } else {
                this.log('warning', '⚠️ Кнопка Continue/Submit не найдена');
                return false;
            }
        } catch (error) {
            this.log('error', `Ошибка клика на кнопку: ${error.message}`);
            return false;
        }
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
     * Проверка наличия Cloudflare Turnstile капчи
     * @returns {boolean} - Есть ли капча на странице
     */
    async hasTurnstileCaptcha() {
        try {
            const pageText = await this.page.evaluate(() => document.body.innerText);
            return pageText.includes('Verify you are human') || 
                   pageText.includes('needs to review the security') ||
                   pageText.includes('checking your browser') ||
                   pageText.includes('Just a moment');
        } catch {
            return false;
        }
    }

    /**
     * Ожидание и попытка решить Turnstile CAPTCHA
     * Поддерживает режим CAPTCHA_WAIT_MODE для ручного решения через VNC
     */
    async waitForTurnstile() {
        try {
            // Проверяем наличие страницы верификации Cloudflare
            const hasCaptcha = await this.hasTurnstileCaptcha();
            
            if (!hasCaptcha) {
                return true; // Нет капчи - успех
            }

            this.log('info', '🔒 Обнаружена Cloudflare Turnstile капча!');
            
            // Делаем скриншот капчи
            await this.page.screenshot({ 
                path: `captcha_detected_${Date.now()}.png`,
                fullPage: true 
            });
            
            // ==========================================
            // Режим ручного решения через VNC
            // ==========================================
            if (CAPTCHA_WAIT_MODE) {
                this.log('info', `⏳ CAPTCHA_WAIT_MODE включён - ожидаем ручное решение (таймаут: ${CAPTCHA_WAIT_TIMEOUT} сек)`);
                this.log('info', '🖥️  Подключитесь через VNC и решите капчу вручную!');
                this.log('info', '📍 VNC обычно на порту 5900 или 5901');
                
                const startWait = Date.now();
                const maxWaitMs = CAPTCHA_WAIT_TIMEOUT * 1000;
                
                while (Date.now() - startWait < maxWaitMs) {
                    // Проверяем каждые 3 секунды
                    await this.humanDelay(3000, 3500);
                    
                    const stillHasCaptcha = await this.hasTurnstileCaptcha();
                    const currentUrl = this.page.url();
                    
                    // Проверяем, решена ли капча
                    if (!stillHasCaptcha) {
                        this.log('info', '✅ Капча решена! Продолжаем...');
                        await this.humanDelay(1000, 2000);
                        return true;
                    }
                    
                    // Проверяем редирект на страницу регистрации
                    if (currentUrl.includes('sign-up') && !currentUrl.includes('challenge')) {
                        this.log('info', '✅ Редирект на страницу регистрации - капча пройдена!');
                        return true;
                    }
                    
                    const elapsedSec = Math.floor((Date.now() - startWait) / 1000);
                    if (elapsedSec % 15 === 0) { // Лог каждые 15 сек
                        this.log('info', `⏳ Ожидаем решение капчи... ${elapsedSec}/${CAPTCHA_WAIT_TIMEOUT} сек`);
                    }
                }
                
                this.log('error', `❌ Таймаут ожидания ручного решения капчи (${CAPTCHA_WAIT_TIMEOUT} сек)`);
                return false;
            }
            
            // ==========================================
            // Автоматическая попытка решить
            // ==========================================
            this.log('info', '🤖 Пытаемся решить Turnstile автоматически...');
            
            // Ждём загрузки iframe с капчей
            await this.humanDelay(2000, 3000);
            
            // Пробуем найти и кликнуть на чекбокс внутри iframe
            for (let attempt = 0; attempt < 5; attempt++) {
                try {
                    // Ищем iframe Turnstile
                    const frames = this.page.frames();
                    for (const frame of frames) {
                        const url = frame.url();
                        if (url.includes('challenges.cloudflare.com') || url.includes('turnstile')) {
                            this.log('info', `Попытка ${attempt + 1}: Нашли iframe Turnstile`);
                            
                            // Пробуем кликнуть на чекбокс внутри iframe
                            try {
                                await frame.waitForSelector('input[type="checkbox"], .cb-i, #challenge-stage', { timeout: 5000 });
                                await frame.click('input[type="checkbox"], .cb-i, #challenge-stage');
                                this.log('info', '✔️ Кликнули на чекбокс Turnstile');
                            } catch (e) {
                                // Пробуем кликнуть по координатам центра iframe
                                try {
                                    const box = await frame.evaluate(() => {
                                        const body = document.body;
                                        return { width: body.clientWidth, height: body.clientHeight };
                                    });
                                    await this.page.mouse.click(box.width / 2, box.height / 2);
                                    this.log('info', '✔️ Кликнули по центру iframe');
                                } catch (e2) {
                                    this.log('warning', `Не удалось кликнуть: ${e2.message}`);
                                }
                            }
                            
                            break;
                        }
                    }
                } catch (e) {
                    this.log('warning', `Попытка ${attempt + 1} не удалась: ${e.message}`);
                }
                
                // Ждём и проверяем, решилась ли капча
                await this.humanDelay(3000, 5000);
                
                // Проверяем, исчезла ли страница капчи
                const stillHasCaptcha = await this.hasTurnstileCaptcha();
                if (!stillHasCaptcha) {
                    this.log('info', '✅ Turnstile решена автоматически!');
                    return true;
                }
                
                // Проверяем URL - может быть редирект
                const currentUrl = this.page.url();
                if (currentUrl.includes('sign-up') && !currentUrl.includes('challenge')) {
                    this.log('info', '✅ Прошли верификацию, на странице регистрации');
                    return true;
                }
            }

            this.log('error', '❌ Не удалось решить Turnstile автоматически за 5 попыток');
            this.log('info', '💡 Рекомендации:');
            this.log('info', '   1. Включите CAPTCHA_WAIT_MODE=true и HEADLESS=false');
            this.log('info', '   2. Настройте VNC для доступа к браузеру');
            this.log('info', '   3. Используйте резидентные прокси');
            this.log('info', '   4. Используйте сервис решения капчи (2captcha, anti-captcha)');
            return false;
        } catch (error) {
            this.log('error', `Ошибка при решении Turnstile: ${error.message}`);
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
            // ==========================================
            // ЭТАП 1: FlareSolverr (если включён)
            // ==========================================
            if (FLARESOLVERR_ENABLED) {
                this.log('info', '🚀 Используем FlareSolverr для обхода Cloudflare...');
                const flareSession = await this.getFlareSolverrSession(CONFIG.SIGNUP_URL, proxy);
                
                if (flareSession) {
                    this.log('info', '✅ FlareSolverr успешно получил сессию');
                } else {
                    this.log('warning', '⚠️ FlareSolverr не смог получить сессию, продолжаем без него...');
                }
            }

            // ==========================================
            // ЭТАП 2: Запуск браузера
            // ==========================================
            await this.launchBrowser(proxy);

            // Применяем User-Agent от FlareSolverr (если есть)
            if (this.flareSolverrUserAgent) {
                await this.page.setUserAgent(this.flareSolverrUserAgent);
                this.log('info', '🔄 Применён User-Agent от FlareSolverr');
            }

            // Применяем куки от FlareSolverr (если есть)
            if (this.flareSolverrCookies && this.flareSolverrCookies.length > 0) {
                await this.applyFlareSolverrCookies();
            }

            // ==========================================
            // ЭТАП 3: Переход на страницу регистрации
            // ==========================================
            this.log('info', 'Переход на страницу регистрации...');
            await this.page.goto(CONFIG.SIGNUP_URL, { 
                waitUntil: 'networkidle2',
                timeout: CONFIG.TIMEOUT 
            });

            await this.humanDelay(1000, 2000);

            // ==========================================
            // ЭТАП 4: Проверка Cloudflare Turnstile
            // ==========================================
            const captchaSolved = await this.waitForTurnstile();
            if (!captchaSolved) {
                throw new Error('❌ Cloudflare Turnstile не решена. Попробуйте: 1) Включить FlareSolverr 2) Использовать резидентные прокси 3) Использовать сервис решения капчи');
            }
            
            // После решения капчи ждём загрузки страницы регистрации
            this.log('info', '⏳ Ожидаем загрузку формы регистрации...');
            await this.humanDelay(3000, 5000);
            
            // ==========================================
            // ВАЖНО: Ждём появления формы регистрации
            // ==========================================
            const formSelectors = [
                'input[name="firstName"]',
                'input[name="first_name"]',
                'input[placeholder*="first" i]',
                'input[type="email"]',
                'input[name="email"]'
            ];
            
            let formLoaded = false;
            for (let attempt = 0; attempt < 10; attempt++) {
                for (const selector of formSelectors) {
                    const field = await this.page.$(selector);
                    if (field) {
                        this.log('info', `✅ Форма загружена! Найден элемент: ${selector}`);
                        formLoaded = true;
                        break;
                    }
                }
                
                if (formLoaded) break;
                
                this.log('info', `⏳ Попытка ${attempt + 1}/10: форма ещё не загружена, ждём...`);
                await this.humanDelay(2000, 3000);
                
                // Проверяем, не вернулась ли капча
                const stillHasCaptcha = await this.hasTurnstileCaptcha();
                if (stillHasCaptcha) {
                    this.log('warning', '⚠️ Капча снова появилась!');
                    const captchaAgain = await this.waitForTurnstile();
                    if (!captchaAgain) {
                        throw new Error('Повторная капча не решена');
                    }
                }
            }

            // Делаем скриншот для отладки
            await this.page.screenshot({ 
                path: `debug_signup_${accountId}.png`,
                fullPage: true 
            });
            
            // Логируем текущий URL и часть HTML для отладки
            const currentSignupUrl = this.page.url();
            this.log('info', `📍 Текущий URL: ${currentSignupUrl}`);
            
            const pageHtmlSnippet = await this.page.evaluate(() => {
                const inputs = document.querySelectorAll('input');
                return Array.from(inputs).map(i => `${i.name || i.type || 'unknown'}[${i.placeholder || ''}]`).join(', ');
            });
            this.log('info', `📋 Найденные поля ввода: ${pageHtmlSnippet || 'нет'}`);

            // ==========================================
            // Cursor форма регистрации:
            // ПЕРВАЯ СТРАНИЦА: Имя + Фамилия + Email → Continue
            // ВТОРАЯ СТРАНИЦА: Password → Continue
            // ТРЕТЬЯ СТРАНИЦА: Verification email sent
            // ==========================================
            
            // Проверяем наличие полей на первой странице (расширенные селекторы)
            const firstNameInput = await this.page.$('input[name="firstName"], input[name="first_name"], input[placeholder*="first" i], input[data-testid*="first" i]');
            const lastNameInput = await this.page.$('input[name="lastName"], input[name="last_name"], input[placeholder*="last" i], input[data-testid*="last" i]');
            const emailInput = await this.page.$('input[type="email"], input[name="email"], input[placeholder*="email" i], input[data-testid*="email" i]');
            
            this.log('info', `🔍 Поиск полей: firstName=${!!firstNameInput}, lastName=${!!lastNameInput}, email=${!!emailInput}`);

            if (firstNameInput && lastNameInput && emailInput) {
                // ==========================================
                // СТРАНИЦА 1: Имя + Фамилия + Email на одной странице
                // ==========================================
                this.log('info', '📝 Страница 1: Заполняем Имя + Фамилия + Email...');
                
                // Сначала имя
                await this.humanType('input[name="firstName"], input[placeholder*="first" i], input[name="first_name"]', firstName);
                await this.humanDelay(300, 500);
                
                // Потом фамилия
                await this.humanType('input[name="lastName"], input[placeholder*="last" i], input[name="last_name"]', lastName);
                await this.humanDelay(300, 500);
                
                // Потом email
                await this.humanType('input[type="email"], input[name="email"], input[placeholder*="email" i]', email);
                await this.humanDelay(500, 1000);

                this.log('info', `✅ Заполнено: ${firstName} ${lastName} / ${email}`);

                // Делаем скриншот ПЕРЕД нажатием Continue
                await this.page.screenshot({ 
                    path: `debug_page1_filled_${accountId}.png`,
                    fullPage: true 
                });

                // Нажимаем Continue
                this.log('info', '🔘 Нажимаем Continue...');
                const continueClicked = await this.clickContinueButton();
                if (!continueClicked) {
                    this.log('warning', '⚠️ Кнопка Continue не найдена на странице 1');
                }
                
                // ==========================================
                // ПРОВЕРКА ПОВТОРНОЙ КАПЧИ после Continue #1
                // ==========================================
                await this.humanDelay(2000, 3000);
                
                this.log('info', '🔍 Проверяем повторную капчу после Continue #1...');
                const captchaAfterStep1 = await this.hasTurnstileCaptcha();
                if (captchaAfterStep1) {
                    this.log('warning', '⚠️ Появилась повторная капча! Ожидаем решение...');
                    const captchaSolved2 = await this.waitForTurnstile();
                    if (!captchaSolved2) {
                        throw new Error('Повторная капча после шага 1 не решена');
                    }
                    this.log('info', '✅ Повторная капча решена!');
                    await this.humanDelay(2000, 3000);
                } else {
                    this.log('info', '✅ Повторной капчи нет, продолжаем...');
                }

                // Делаем скриншот страницы 2
                await this.page.screenshot({ 
                    path: `debug_page2_${accountId}.png`,
                    fullPage: true 
                });

                // ==========================================
                // СТРАНИЦА 2: Ввод пароля
                // ==========================================
                const passwordInput = await this.page.$('input[type="password"], input[name="password"]');
                if (passwordInput) {
                    this.log('info', '📝 Страница 2: Ввод пароля...');
                    await this.humanType('input[type="password"], input[name="password"]', password);
                    await this.humanDelay(500, 1000);
                    
                    // Нажимаем Continue/Submit после пароля
                    this.log('info', '🔘 Нажимаем Continue после пароля...');
                    const passwordContinueClicked = await this.clickContinueButton();
                    if (!passwordContinueClicked) {
                        this.log('warning', '⚠️ Кнопка Continue не найдена после пароля');
                    }
                    
                    // ==========================================
                    // ПРОВЕРКА ПОВТОРНОЙ КАПЧИ после Continue #2 (пароль)
                    // ==========================================
                    await this.humanDelay(2000, 3000);
                    
                    this.log('info', '🔍 Проверяем повторную капчу после Continue #2 (пароль)...');
                    const captchaAfterStep2 = await this.hasTurnstileCaptcha();
                    if (captchaAfterStep2) {
                        this.log('warning', '⚠️ Появилась капча после ввода пароля! Ожидаем решение...');
                        const captchaSolved3 = await this.waitForTurnstile();
                        if (!captchaSolved3) {
                            throw new Error('Капча после ввода пароля не решена');
                        }
                        this.log('info', '✅ Капча после пароля решена!');
                        await this.humanDelay(2000, 3000);
                    } else {
                        this.log('info', '✅ Капчи после пароля нет, продолжаем...');
                    }
                    
                    this.log('info', '✅ Форма регистрации отправлена');
                } else {
                    this.log('warning', '⚠️ Поле пароля не найдено на странице 2');
                    
                    // Проверяем - может это уже страница подтверждения email?
                    const pageText = await this.page.evaluate(() => document.body.innerText.toLowerCase());
                    if (pageText.includes('verify') || pageText.includes('email') || pageText.includes('code')) {
                        this.log('info', '📧 Похоже на страницу подтверждения email (magic link)');
                    }
                }

            } else if (emailInput) {
                // ==========================================
                // Альтернативный вариант: только email на первой странице
                // ==========================================
                this.log('info', '📝 Альтернативная форма: только email на первой странице');
                await this.humanType('input[type="email"], input[name="email"], input[placeholder*="email" i]', email);
                await this.humanDelay(500, 1000);

                // Нажимаем Continue
                this.log('info', '🔘 Нажимаем Continue после email...');
                await this.clickContinueButton();
                await this.humanDelay(2000, 3000);

                // Ищем поля имени на следующей странице
                const nameFieldsExist = await this.page.$('input[name="firstName"], input[placeholder*="first" i]');
                if (nameFieldsExist) {
                    this.log('info', '📝 Страница 2: Ввод имени и фамилии...');
                    await this.humanType('input[name="firstName"], input[placeholder*="first" i]', firstName);
                    await this.humanDelay(300, 500);
                    await this.humanType('input[name="lastName"], input[placeholder*="last" i]', lastName);
                    await this.humanDelay(500, 1000);
                    
                    await this.clickContinueButton();
                    await this.humanDelay(2000, 3000);
                }

                // Ищем поле пароля
                const passwordField = await this.page.$('input[type="password"]');
                if (passwordField) {
                    this.log('info', '📝 Ввод пароля...');
                    await this.humanType('input[type="password"]', password);
                    await this.humanDelay(500, 1000);
                    await this.clickContinueButton();
                    await this.humanDelay(2000, 3000);
                }

                this.log('info', '✅ Форма регистрации отправлена');
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

            // Проверяем на ошибки в видимом тексте (не в HTML)
            const visibleText = await this.page.evaluate(() => document.body.innerText.toLowerCase());
            
            const errorMessages = [
                'already exists',
                'already registered', 
                'email is taken',
                'account already',
                'invalid email',
                'password too weak',
                'something went wrong',
                'unable to create',
                'registration failed'
            ];

            let hasError = false;
            let foundError = '';
            for (const errorMsg of errorMessages) {
                if (visibleText.includes(errorMsg)) {
                    hasError = true;
                    foundError = errorMsg;
                    this.log('error', `Обнаружена ошибка: ${errorMsg}`);
                    break;
                }
            }

            if (hasError) {
                throw new Error(`Ошибка регистрации: ${foundError}`);
            }

            // Проверяем на страницу подтверждения email
            if (pageContent.toLowerCase().includes('verify') || 
                pageContent.toLowerCase().includes('confirmation') ||
                pageContent.toLowerCase().includes('check your email')) {
                this.log('info', 'Требуется подтверждение email');
                
                // ==========================================
                // ЭТАП 5: Автоматическое получение кода из почты
                // ==========================================
                // Получаем актуальные настройки почты
                const mailConfig = getMailConfig();
                this.log('info', `📧 Настройки почты: enabled=${mailConfig.enabled}`);
                this.log('info', `📧 Пароль аккаунта: ${password ? 'есть (' + password.length + ' символов)' : 'НЕ ЗАДАН'}`);
                
                if (mailConfig.enabled && password) {
                    this.log('info', '📧 Запуск автоматической проверки почты...');
                    
                    // Используем пароль от аккаунта (из строки email:password)
                    const verificationSuccess = await this.waitAndEnterVerificationCode(email, password, new Date(startTime));
                    
                    if (verificationSuccess) {
                        // Проверяем trial статус после верификации
                        const trialResult = await this.checkTrialStatus();
                        const processingTime = Date.now() - startTime;

                        db.updateAccount(accountId, {
                            status: 'success',
                            trial_status: trialResult.hasTriaI ? 'active' : 'verified',
                            trial_days: trialResult.trialDays || 0,
                            processing_time: processingTime
                        });

                        this.log('info', `✅ Регистрация и верификация завершены: ${email}`);
                        await this.closeBrowser();
                        return { success: true, verified: true, trial: trialResult };
                    } else {
                        this.log('warning', '⚠️ Автоматическая верификация не удалась');
                    }
                }
                
                // Если автоверификация отключена или не удалась
                const processingTime = Date.now() - startTime;
                
                db.updateAccount(accountId, {
                    status: 'success',
                    trial_status: 'pending_verification',
                    error_message: 'Требуется подтверждение email (проверьте почту вручную)',
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
            // ==========================================
            // ЭТАП 1: FlareSolverr (если включён)
            // ==========================================
            if (FLARESOLVERR_ENABLED) {
                this.log('info', '🚀 Используем FlareSolverr для обхода Cloudflare...');
                const flareSession = await this.getFlareSolverrSession(CONFIG.LOGIN_URL, proxy);
                
                if (flareSession) {
                    this.log('info', '✅ FlareSolverr успешно получил сессию');
                } else {
                    this.log('warning', '⚠️ FlareSolverr не смог получить сессию, продолжаем без него...');
                }
            }

            // ==========================================
            // ЭТАП 2: Запуск браузера
            // ==========================================
            await this.launchBrowser(proxy);

            // Применяем User-Agent от FlareSolverr (если есть)
            if (this.flareSolverrUserAgent) {
                await this.page.setUserAgent(this.flareSolverrUserAgent);
                this.log('info', '🔄 Применён User-Agent от FlareSolverr');
            }

            // Применяем куки от FlareSolverr (если есть)
            if (this.flareSolverrCookies && this.flareSolverrCookies.length > 0) {
                await this.applyFlareSolverrCookies();
            }

            // ==========================================
            // ЭТАП 3: Переход на страницу входа
            // ==========================================
            await this.page.goto(CONFIG.LOGIN_URL, { 
                waitUntil: 'networkidle2',
                timeout: CONFIG.TIMEOUT 
            });

            await this.humanDelay(1000, 2000);

            // ==========================================
            // ЭТАП 4: Проверка Cloudflare Turnstile
            // ==========================================
            const captchaSolved = await this.waitForTurnstile();
            if (!captchaSolved) {
                throw new Error('❌ Cloudflare Turnstile не решена. Попробуйте: 1) Включить FlareSolverr 2) Использовать резидентные прокси');
            }
            
            await this.humanDelay(2000, 3000);

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
     * Ожидание письма и ввод кода верификации
     * @param {string} email - Email для проверки почты
     * @param {string} mailPassword - Пароль от почтового ящика (из строки email:password)
     * @param {Date} registrationTime - Время начала регистрации
     * @returns {boolean} - Успешно ли введён код
     */
    async waitAndEnterVerificationCode(email, mailPassword, registrationTime) {
        // Получаем актуальные настройки почты
        const mailConfig = getMailConfig();
        
        if (!mailConfig.enabled) {
            this.log('info', '📧 Автоматическая проверка почты отключена (MAIL_VERIFICATION_ENABLED != true)');
            return false;
        }
        
        if (!mailPassword) {
            this.log('info', '📧 Пароль от почты не передан');
            return false;
        }

        this.log('info', `📧 Ожидаем письмо с кодом подтверждения для ${email}...`);

        try {
            // Ждём код из почты (используем пароль от аккаунта)
            const code = await mailReader.waitForVerificationCode(
                email, 
                mailPassword, 
                registrationTime,
                (msg) => this.log('info', msg)
            );

            if (!code) {
                this.log('warning', '⚠️ Код подтверждения не получен из почты');
                return false;
            }

            this.log('info', `✅ Получен код: ${code}, вводим на странице...`);

            // Ищем поле для ввода кода
            const codeSelectors = [
                'input[name="code"]',
                'input[placeholder*="code" i]',
                'input[placeholder*="verification" i]',
                'input[type="text"][maxlength="6"]',
                'input[autocomplete="one-time-code"]',
                '.verification-code input',
                '#verification-code'
            ];

            let codeInputFound = false;
            for (const selector of codeSelectors) {
                const input = await this.page.$(selector);
                if (input) {
                    await this.humanType(selector, code);
                    codeInputFound = true;
                    this.log('info', `Код введён в поле: ${selector}`);
                    break;
                }
            }

            if (!codeInputFound) {
                // Пробуем найти несколько полей для ввода кода (OTP стиль)
                const otpInputs = await this.page.$$('input[maxlength="1"]');
                if (otpInputs.length >= 6) {
                    this.log('info', `Найдены OTP поля (${otpInputs.length} шт.), вводим код...`);
                    for (let i = 0; i < 6 && i < otpInputs.length; i++) {
                        await otpInputs[i].type(code[i], { delay: 100 });
                        await this.humanDelay(50, 150);
                    }
                    codeInputFound = true;
                }
            }

            if (!codeInputFound) {
                this.log('error', '❌ Поле для ввода кода не найдено');
                return false;
            }

            await this.humanDelay(500, 1000);

            // Ищем кнопку подтверждения
            const submitClicked = await this.page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    const text = btn.textContent.toLowerCase();
                    if (text.includes('verify') || 
                        text.includes('confirm') ||
                        text.includes('submit') ||
                        text.includes('continue')) {
                        btn.click();
                        return true;
                    }
                }
                const submitBtn = document.querySelector('button[type="submit"]');
                if (submitBtn) {
                    submitBtn.click();
                    return true;
                }
                return false;
            });

            if (submitClicked) {
                this.log('info', 'Код отправлен на проверку');
            }

            await this.humanDelay(3000, 5000);

            // Проверяем результат
            const currentUrl = this.page.url();
            const pageText = await this.page.evaluate(() => document.body.innerText.toLowerCase());

            if (pageText.includes('success') || 
                pageText.includes('verified') ||
                pageText.includes('welcome') ||
                currentUrl.includes('dashboard') ||
                currentUrl.includes('settings')) {
                this.log('info', '✅ Email успешно подтверждён!');
                return true;
            }

            if (pageText.includes('invalid') || 
                pageText.includes('incorrect') ||
                pageText.includes('wrong code') ||
                pageText.includes('expired')) {
                this.log('error', '❌ Код неверный или истёк');
                return false;
            }

            this.log('info', '⚠️ Статус подтверждения неизвестен');
            return false;

        } catch (error) {
            this.log('error', `❌ Ошибка ввода кода: ${error.message}`);
            return false;
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
