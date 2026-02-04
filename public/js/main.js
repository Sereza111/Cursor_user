/**
 * Cursor Mass Register - Клиентский JavaScript
 * Управление формой регистрации и отображение прогресса
 */

// Глобальные переменные
let currentSessionId = null;
let eventSource = null;
let pollingInterval = null;

// DOM элементы
const registerForm = document.getElementById('registerForm');
const accountsList = document.getElementById('accountsList');
const fileInput = document.getElementById('fileInput');
const proxyList = document.getElementById('proxyList');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const activeSessionCard = document.getElementById('activeSessionCard');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const statSuccess = document.getElementById('statSuccess');
const statFailed = document.getElementById('statFailed');
const statTrial = document.getElementById('statTrial');
const logsContainer = document.getElementById('logsContainer');
const exportButtons = document.getElementById('exportButtons');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportTxtBtn = document.getElementById('exportTxtBtn');
const toastEl = document.getElementById('liveToast');
const toastBody = document.getElementById('toastBody');

// Bootstrap Toast
let toast = null;
if (toastEl) {
    toast = new bootstrap.Toast(toastEl);
}

/**
 * Показать уведомление
 */
function showToast(message, type = 'info') {
    if (toastBody && toast) {
        toastBody.textContent = message;
        const header = toastEl.querySelector('.toast-header i');
        if (header) {
            header.className = `bi bi-${type === 'error' ? 'exclamation-circle' : 'info-circle'} text-${type === 'error' ? 'danger' : 'primary'} me-2`;
        }
        toast.show();
    }
}

/**
 * Обработка загрузки файла
 */
if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            accountsList.value = text;
            showToast(`Загружено ${text.split('\n').filter(l => l.trim()).length} строк`);
        } catch (err) {
            showToast('Ошибка чтения файла', 'error');
        }
    });
}

/**
 * Отправка формы регистрации
 */
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const accounts = accountsList.value.trim();
        if (!accounts) {
            showToast('Введите список аккаунтов', 'error');
            return;
        }
        
        const mode = document.querySelector('input[name="mode"]:checked').value;
        const proxies = proxyList.value.trim();
        
        // Блокируем кнопку
        startBtn.disabled = true;
        startBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Запуск...';
        
        try {
            const response = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accounts, mode, proxies })
            });
            
            const data = await response.json();
            
            if (data.success) {
                currentSessionId = data.sessionId;
                showToast(`Сессия запущена! Аккаунтов: ${data.totalAccounts}`);
                startSession(data.sessionId, data.totalAccounts);
            } else {
                throw new Error(data.error || 'Неизвестная ошибка');
            }
        } catch (err) {
            showToast(err.message, 'error');
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="bi bi-play-fill me-2"></i>Запустить регистрацию';
        }
    });
}

/**
 * Запуск отслеживания сессии
 */
function startSession(sessionId, totalAccounts) {
    // Показываем карточку активной сессии
    if (activeSessionCard) {
        activeSessionCard.style.display = 'block';
    }
    
    // Обновляем прогресс
    updateProgress(0, totalAccounts);
    
    // Очищаем логи
    if (logsContainer) {
        logsContainer.innerHTML = '<div class="log-line text-success">🚀 Сессия запущена...</div>';
    }
    
    // Обновляем ссылки экспорта
    if (exportCsvBtn) exportCsvBtn.href = `/api/export/${sessionId}`;
    if (exportTxtBtn) exportTxtBtn.href = `/api/export-txt/${sessionId}`;
    
    // Запускаем polling статуса
    startPolling(sessionId);
}

/**
 * Обновление прогресса
 */
function updateProgress(processed, total) {
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
    
    if (progressBar) {
        progressBar.style.width = `${percent}%`;
        progressBar.setAttribute('aria-valuenow', percent);
    }
    
    if (progressText) {
        progressText.textContent = `${processed} / ${total}`;
    }
}

/**
 * Обновление статистики
 */
function updateStats(stats) {
    if (statSuccess) statSuccess.textContent = stats.success || 0;
    if (statFailed) statFailed.textContent = stats.failed || 0;
    if (statTrial) statTrial.textContent = stats.with_trial || 0;
}

/**
 * Добавление лога
 */
function addLog(log) {
    if (!logsContainer) return;
    
    const logLine = document.createElement('div');
    logLine.className = 'log-line';
    
    const time = new Date(log.created_at).toLocaleTimeString('ru-RU');
    let icon = '📝';
    let colorClass = '';
    
    switch (log.level) {
        case 'error':
            icon = '❌';
            colorClass = 'text-danger';
            break;
        case 'warning':
            icon = '⚠️';
            colorClass = 'text-warning';
            break;
        case 'info':
            if (log.message.includes('✅') || log.message.includes('успе')) {
                icon = '✅';
                colorClass = 'text-success';
            } else {
                icon = 'ℹ️';
                colorClass = 'text-info';
            }
            break;
    }
    
    logLine.innerHTML = `<span class="text-muted">[${time}]</span> ${icon} <span class="${colorClass}">${escapeHtml(log.message)}</span>`;
    logsContainer.appendChild(logLine);
    
    // Автопрокрутка вниз
    logsContainer.scrollTop = logsContainer.scrollHeight;
}

/**
 * Экранирование HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Polling статуса сессии
 */
function startPolling(sessionId) {
    let lastLogId = 0;
    
    pollingInterval = setInterval(async () => {
        try {
            // Получаем статус
            const statusRes = await fetch(`/api/status/${sessionId}`);
            const statusData = await statusRes.json();
            
            if (statusData.error) {
                throw new Error(statusData.error);
            }
            
            // Обновляем прогресс
            const session = statusData.session;
            const stats = statusData.stats;
            
            updateProgress(session.processed || 0, session.total_accounts);
            updateStats(stats);
            
            // Получаем новые логи
            const logsRes = await fetch(`/api/logs-poll/${sessionId}?lastId=${lastLogId}`);
            const logsData = await logsRes.json();
            
            if (logsData.logs && logsData.logs.length > 0) {
                logsData.logs.forEach(log => addLog(log));
                lastLogId = logsData.logs[logsData.logs.length - 1].id;
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
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
}

/**
 * Обработка завершения сессии
 */
function onSessionComplete(status) {
    // Обновляем кнопку
    if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="bi bi-play-fill me-2"></i>Запустить регистрацию';
    }
    
    // Скрываем кнопку остановки
    if (stopBtn) {
        stopBtn.style.display = 'none';
    }
    
    // Показываем кнопки экспорта
    if (exportButtons) {
        exportButtons.style.display = 'flex';
        exportButtons.style.cssText = 'display: flex !important;';
    }
    
    // Убираем анимацию прогресс-бара
    if (progressBar) {
        progressBar.classList.remove('progress-bar-animated');
        if (status === 'completed') {
            progressBar.classList.remove('bg-primary');
            progressBar.classList.add('bg-success');
        } else if (status === 'error') {
            progressBar.classList.remove('bg-primary');
            progressBar.classList.add('bg-danger');
        }
    }
    
    // Показываем уведомление
    if (status === 'completed') {
        showToast('Сессия успешно завершена!');
        addLog({ level: 'info', message: '🎉 Сессия завершена!', created_at: new Date().toISOString() });
    } else if (status === 'stopped') {
        showToast('Сессия остановлена');
        addLog({ level: 'warning', message: '⏹️ Сессия остановлена пользователем', created_at: new Date().toISOString() });
    } else {
        showToast('Сессия завершилась с ошибкой', 'error');
        addLog({ level: 'error', message: '💥 Сессия завершилась с ошибкой', created_at: new Date().toISOString() });
    }
}

/**
 * Остановка сессии
 */
if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
        if (!currentSessionId) return;
        
        if (!confirm('Остановить текущую сессию?')) return;
        
        stopBtn.disabled = true;
        
        try {
            const response = await fetch(`/api/stop/${currentSessionId}`, { method: 'POST' });
            const data = await response.json();
            
            if (data.success) {
                showToast('Сессия останавливается...');
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            showToast(err.message, 'error');
            stopBtn.disabled = false;
        }
    });
}

/**
 * Подсчёт аккаунтов при вводе
 */
if (accountsList) {
    accountsList.addEventListener('input', () => {
        const lines = accountsList.value.split('\n').filter(l => l.trim() && l.includes(':'));
        const countBadge = document.getElementById('accountsCount');
        if (!countBadge) {
            const badge = document.createElement('span');
            badge.id = 'accountsCount';
            badge.className = 'badge bg-primary ms-2';
            accountsList.parentElement.querySelector('label').appendChild(badge);
        }
        document.getElementById('accountsCount').textContent = `${lines.length} аккаунтов`;
    });
}

/**
 * Drag & Drop для файлов
 */
if (accountsList) {
    accountsList.addEventListener('dragover', (e) => {
        e.preventDefault();
        accountsList.classList.add('border-primary');
    });
    
    accountsList.addEventListener('dragleave', () => {
        accountsList.classList.remove('border-primary');
    });
    
    accountsList.addEventListener('drop', async (e) => {
        e.preventDefault();
        accountsList.classList.remove('border-primary');
        
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.txt') || file.name.endsWith('.csv'))) {
            try {
                const text = await file.text();
                accountsList.value = text;
                accountsList.dispatchEvent(new Event('input'));
                showToast(`Загружен файл: ${file.name}`);
            } catch (err) {
                showToast('Ошибка чтения файла', 'error');
            }
        } else {
            showToast('Поддерживаются только .txt и .csv файлы', 'error');
        }
    });
}

// Очистка при закрытии страницы
window.addEventListener('beforeunload', () => {
    stopPolling();
});

console.log('🚀 Cursor Mass Register Panel loaded');
