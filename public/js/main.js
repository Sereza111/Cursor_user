/**
 * Account Mass Register - Клиентский JavaScript
 * Поддержка Cursor AI и CLINE
 */

// Глобальные переменные
let currentSessionId = null;
let pollingInterval = null;
let currentService = 'cursor'; // 'cursor' или 'cline'

// DOM элементы
document.addEventListener('DOMContentLoaded', () => {
    initServiceSelect();
    initModeSelect();
    initForm();
    initAccountsCounter();
    initDragDrop();
    initExportButtons();
    
    console.log('🚀 Account Mass Register Panel v2.0 loaded');
});

/**
 * Инициализация выбора сервиса
 */
function initServiceSelect() {
    const serviceOptions = document.querySelectorAll('.service-option');
    const cursorModeSelect = document.getElementById('cursorModeSelect');
    const clineModeSelect = document.getElementById('clineModeSelect');
    const clineHint = document.getElementById('clineHint');
    const accountsLabel = document.getElementById('accountsLabel');
    const accountsHint = document.getElementById('accountsHint');
    const trialLabel = document.getElementById('trialLabel');
    
    serviceOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Убираем active со всех
            serviceOptions.forEach(o => o.classList.remove('active'));
            // Добавляем active на текущий
            option.classList.add('active');
            
            // Устанавливаем radio
            const radio = option.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
            
            // Определяем выбранный сервис
            currentService = option.dataset.service;
            
            // Переключаем UI
            if (currentService === 'cline') {
                if (cursorModeSelect) cursorModeSelect.style.display = 'none';
                if (clineModeSelect) clineModeSelect.style.display = 'flex';
                if (clineHint) clineHint.style.display = 'block';
                if (accountsLabel) accountsLabel.textContent = 'Microsoft/Outlook аккаунты';
                if (accountsHint) accountsHint.textContent = 'Формат: outlook_email@outlook.com:password';
                if (trialLabel) trialLabel.textContent = 'С токеном';
            } else {
                if (cursorModeSelect) cursorModeSelect.style.display = 'flex';
                if (clineModeSelect) clineModeSelect.style.display = 'none';
                if (clineHint) clineHint.style.display = 'none';
                if (accountsLabel) accountsLabel.textContent = 'Список аккаунтов';
                if (accountsHint) accountsHint.textContent = 'Формат: email:password (один аккаунт на строку)';
                if (trialLabel) trialLabel.textContent = 'С Trial';
            }
            
            addLog('info', `Выбран сервис: ${currentService.toUpperCase()}`);
        });
    });
}

/**
 * Инициализация выбора режима
 */
function initModeSelect() {
    const modeOptions = document.querySelectorAll('.mode-option');
    
    modeOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Убираем active с соседних options в том же контейнере
            const parent = option.parentElement;
            parent.querySelectorAll('.mode-option').forEach(o => o.classList.remove('active'));
            option.classList.add('active');
            
            const radio = option.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        });
    });
}

/**
 * Инициализация формы
 */
function initForm() {
    const registerForm = document.getElementById('registerForm');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    if (!registerForm) return;
    
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const accountsList = document.getElementById('accountsList');
        const proxyList = document.getElementById('proxyList');
        
        const accounts = accountsList.value.trim();
        if (!accounts) {
            addLog('error', 'Введите список аккаунтов!');
            return;
        }
        
        // Определяем режим
        let mode = 'register';
        if (currentService === 'cursor') {
            const modeRadio = document.querySelector('input[name="mode"]:checked');
            mode = modeRadio ? modeRadio.value : 'register';
        } else {
            mode = 'login'; // CLINE всегда login
        }
        
        const proxies = proxyList ? proxyList.value.trim() : '';
        
        // Блокируем кнопку
        startBtn.disabled = true;
        startBtn.innerHTML = '⏳ Запуск...';
        stopBtn.disabled = false;
        
        try {
            const response = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    accounts, 
                    mode, 
                    proxies,
                    service: currentService 
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                currentSessionId = data.sessionId;
                addLog('success', `✅ Сессия запущена! ID: ${data.sessionId}, Аккаунтов: ${data.totalAccounts}`);
                startSession(data.sessionId, data.totalAccounts);
            } else {
                throw new Error(data.error || 'Неизвестная ошибка');
            }
        } catch (err) {
            addLog('error', `❌ Ошибка: ${err.message}`);
            startBtn.disabled = false;
            startBtn.innerHTML = '⚔ Запустить обработку';
            stopBtn.disabled = true;
        }
    });
    
    // Кнопка остановки
    if (stopBtn) {
        stopBtn.addEventListener('click', async () => {
            if (!currentSessionId) return;
            
            if (!confirm('Остановить текущую сессию?')) return;
            
            stopBtn.disabled = true;
            
            try {
                const response = await fetch(`/api/stop/${currentSessionId}`, { method: 'POST' });
                const data = await response.json();
                
                if (data.success) {
                    addLog('warning', '⏹️ Сессия останавливается...');
                } else {
                    throw new Error(data.error);
                }
            } catch (err) {
                addLog('error', `❌ Ошибка: ${err.message}`);
                stopBtn.disabled = false;
            }
        });
    }
}

/**
 * Запуск отслеживания сессии
 */
function startSession(sessionId, totalAccounts) {
    // Показываем секции
    document.getElementById('statsSection').style.display = 'grid';
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('resultsSection').style.display = 'block';
    
    // Обновляем статистику
    document.getElementById('statTotal').textContent = totalAccounts;
    document.getElementById('statProcessed').textContent = '0';
    document.getElementById('statSuccess').textContent = '0';
    document.getElementById('statFailed').textContent = '0';
    document.getElementById('statTrial').textContent = '0';
    
    // Сбрасываем прогресс
    updateProgress(0, totalAccounts);
    
    // Очищаем таблицу
    document.getElementById('resultsTable').innerHTML = '';
    
    // Запускаем polling
    startPolling(sessionId);
}

/**
 * Обновление прогресса
 */
function updateProgress(processed, total) {
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
    
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressPercent = document.getElementById('progressPercent');
    
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressText) progressText.textContent = `Обработано: ${processed} из ${total}`;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
}

/**
 * Polling статуса сессии
 */
function startPolling(sessionId) {
    let lastLogCount = 0;
    
    pollingInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/status/${sessionId}`);
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            const session = data.session;
            const stats = data.stats;
            const accounts = data.accounts || [];
            
            // Обновляем статистику
            document.getElementById('statProcessed').textContent = stats.success + stats.failed;
            document.getElementById('statSuccess').textContent = stats.success;
            document.getElementById('statFailed').textContent = stats.failed;
            document.getElementById('statTrial').textContent = stats.with_trial || 0;
            
            // Обновляем прогресс
            updateProgress(stats.success + stats.failed, session.total_accounts);
            
            // Обновляем таблицу
            updateResultsTable(accounts);
            
            // Добавляем новые логи
            if (data.logs && data.logs.length > lastLogCount) {
                const newLogs = data.logs.slice(lastLogCount);
                newLogs.forEach(log => {
                    addLog(log.level, log.message);
                });
                lastLogCount = data.logs.length;
            }
            
            // Проверяем завершение
            if (['completed', 'stopped', 'error'].includes(session.status)) {
                stopPolling();
                onSessionComplete(session.status);
            }
            
        } catch (err) {
            console.error('Polling error:', err);
        }
    }, 2000);
}

/**
 * Остановка polling
 */
function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

/**
 * Форматирование токена для отображения
 */
function formatTokenDisplay(token, serviceType) {
    if (!token) return null;
    
    // Проверяем, является ли токен JSON массивом cookies (для CLINE - старые аккаунты)
    if (token.startsWith('[')) {
        try {
            const cookies = JSON.parse(token);
            if (Array.isArray(cookies) && cookies.length > 0) {
                // Показываем информацию о сессии (это СТАРЫЙ формат - только cookies)
                return {
                    display: `🍪 Cookies (${cookies.length} шт.)`,
                    fullValue: token,
                    isCookies: true,
                    isApiKey: false,
                    warning: 'Старый формат - только cookies, нужен API KEY'
                };
            }
        } catch (e) {
            // Не JSON - показываем как есть
        }
    }
    
    // Проверяем, является ли токен API KEY (для CLINE - новые аккаунты)
    const apiKeyPatterns = [
        /^sk-[a-zA-Z0-9_-]{20,}/,
        /^cline_[a-zA-Z0-9_-]{20,}/,
        /^clsk_[a-zA-Z0-9_-]{20,}/
    ];
    
    for (const pattern of apiKeyPatterns) {
        if (pattern.test(token)) {
            return {
                display: `🔑 ${token.substring(0, 20)}...`,
                fullValue: token,
                isCookies: false,
                isApiKey: true
            };
        }
    }
    
    // Для Cursor - обычный session token
    if (serviceType === 'cursor') {
        return {
            display: token.substring(0, 25) + '...',
            fullValue: token,
            isCookies: false,
            isApiKey: false
        };
    }
    
    // Неизвестный формат токена
    return {
        display: token.substring(0, 25) + '...',
        fullValue: token,
        isCookies: false,
        isApiKey: false
    };
}

/**
 * Обновление таблицы результатов
 */
function updateResultsTable(accounts) {
    const tbody = document.getElementById('resultsTable');
    if (!tbody) return;
    
    tbody.innerHTML = accounts.map((acc, idx) => {
        const statusClass = acc.status === 'success' ? 'status-success' : 
                           acc.status === 'failed' ? 'status-failed' :
                           acc.status === 'processing' ? 'status-processing' : 'status-pending';
        
        const serviceClass = (acc.service_type || 'cursor') === 'cline' ? 'cline' : 'cursor';
        const serviceName = (acc.service_type || 'cursor').toUpperCase();
        
        const rawToken = acc.session_token || acc.access_token;
        const tokenInfo = formatTokenDisplay(rawToken, acc.service_type);
        
        let tokenDisplay;
        if (tokenInfo) {
            let cssClass = 'has-token';
            if (tokenInfo.isApiKey) {
                cssClass = 'has-token api-key-token';
            } else if (tokenInfo.isCookies) {
                cssClass = 'has-token cookies-token';
            }
            tokenDisplay = `<span class="token-cell ${cssClass}" title="Кликните для копирования" data-token="${escapeHtml(tokenInfo.fullValue)}" onclick="copyToken(this)">${tokenInfo.display}</span>`;
        } else {
            tokenDisplay = '<span class="token-cell no-token">-</span>';
        }
        
        return `
            <tr>
                <td>${idx + 1}</td>
                <td>${escapeHtml(acc.email)}</td>
                <td><span class="service-badge ${serviceClass}">${serviceName}</span></td>
                <td><span class="status-badge ${statusClass}">${acc.status}</span></td>
                <td>${tokenDisplay}</td>
                <td class="text-muted" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(acc.error_message || '-')}</td>
            </tr>
        `;
    }).join('');
}

/**
 * Копирование токена
 */
window.copyToken = function(element) {
    // Берём токен из data-token атрибута (содержит полные cookies)
    const token = element.dataset.token || element.title;
    
    if (!token) {
        addLog('warning', '⚠️ Токен пустой');
        return;
    }
    
    navigator.clipboard.writeText(token).then(() => {
        // Показываем обратную связь
        const originalText = element.textContent;
        element.textContent = '📋 Скопировано!';
        element.classList.add('copied');
        
        setTimeout(() => {
            element.textContent = originalText;
            element.classList.remove('copied');
        }, 1500);
        
        // Для cookies показываем сколько скопировано
        if (token.startsWith('[')) {
            try {
                const cookies = JSON.parse(token);
                addLog('info', `📋 Скопированы cookies сессии (${cookies.length} шт.) - используйте в local-rotator`);
            } catch (e) {
                addLog('info', '📋 Токен скопирован в буфер обмена');
            }
        } else {
            addLog('info', '📋 Токен скопирован в буфер обмена');
        }
    }).catch(err => {
        addLog('error', `❌ Ошибка копирования: ${err.message}`);
    });
};

/**
 * Обработка завершения сессии
 */
function onSessionComplete(status) {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = '⚔ Запустить обработку';
    }
    
    if (stopBtn) {
        stopBtn.disabled = true;
    }
    
    if (status === 'completed') {
        addLog('success', '🎉 Сессия успешно завершена!');
    } else if (status === 'stopped') {
        addLog('warning', '⏹️ Сессия остановлена');
    } else {
        addLog('error', '💥 Сессия завершилась с ошибкой');
    }
}

/**
 * Добавление лога в контейнер
 */
function addLog(level, message) {
    const logContainer = document.getElementById('logContainer');
    if (!logContainer) return;
    
    const time = new Date().toLocaleTimeString('ru-RU');
    let icon = 'ℹ️';
    let levelClass = 'info';
    
    switch (level) {
        case 'error':
            icon = '❌';
            levelClass = 'error';
            break;
        case 'warning':
            icon = '⚠️';
            levelClass = 'warning';
            break;
        case 'success':
            icon = '✅';
            levelClass = 'success';
            break;
    }
    
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry fade-in';
    logEntry.innerHTML = `
        <span class="log-time">${time}</span>
        <span class="log-level ${levelClass}">${icon}</span>
        <span class="log-message">${escapeHtml(message)}</span>
    `;
    
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

/**
 * Счётчик аккаунтов
 */
function initAccountsCounter() {
    const accountsList = document.getElementById('accountsList');
    if (!accountsList) return;
    
    accountsList.addEventListener('input', () => {
        const lines = accountsList.value.split('\n').filter(l => l.trim() && l.includes(':'));
        const label = document.getElementById('accountsLabel');
        if (label) {
            const countSpan = label.querySelector('.count') || document.createElement('span');
            countSpan.className = 'count';
            countSpan.style.cssText = 'float: right; color: var(--text-muted);';
            countSpan.textContent = `(${lines.length} шт.)`;
            if (!label.querySelector('.count')) {
                label.appendChild(countSpan);
            }
        }
    });
}

/**
 * Drag & Drop
 */
function initDragDrop() {
    const accountsList = document.getElementById('accountsList');
    if (!accountsList) return;
    
    accountsList.addEventListener('dragover', (e) => {
        e.preventDefault();
        accountsList.style.borderColor = 'var(--success)';
    });
    
    accountsList.addEventListener('dragleave', () => {
        accountsList.style.borderColor = '';
    });
    
    accountsList.addEventListener('drop', async (e) => {
        e.preventDefault();
        accountsList.style.borderColor = '';
        
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.txt') || file.name.endsWith('.csv'))) {
            try {
                const text = await file.text();
                accountsList.value = text;
                accountsList.dispatchEvent(new Event('input'));
                addLog('info', `📁 Загружен файл: ${file.name}`);
            } catch (err) {
                addLog('error', `Ошибка чтения файла: ${err.message}`);
            }
        }
    });
}

/**
 * Кнопки экспорта
 */
function initExportButtons() {
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const exportTxtBtn = document.getElementById('exportTxtBtn');
    const exportSuccessBtn = document.getElementById('exportSuccessBtn');
    const exportTokensBtn = document.getElementById('exportTokensBtn');
    
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', () => {
            if (currentSessionId) {
                window.location.href = `/api/export/${currentSessionId}?format=csv`;
            }
        });
    }
    
    if (exportTxtBtn) {
        exportTxtBtn.addEventListener('click', () => {
            if (currentSessionId) {
                window.location.href = `/api/export/${currentSessionId}?format=txt`;
            }
        });
    }
    
    if (exportSuccessBtn) {
        exportSuccessBtn.addEventListener('click', () => {
            if (currentSessionId) {
                window.location.href = `/api/export/${currentSessionId}?format=txt&filter=success`;
            }
        });
    }
    
    if (exportTokensBtn) {
        exportTokensBtn.addEventListener('click', () => {
            if (currentSessionId) {
                window.location.href = `/api/export/${currentSessionId}?format=tokens`;
            }
        });
    }
}

/**
 * Экранирование HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Очистка при закрытии страницы
window.addEventListener('beforeunload', () => {
    stopPolling();
});
