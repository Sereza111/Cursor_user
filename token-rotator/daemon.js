/**
 * CLINE Token Rotator Daemon
 * Автоматическая проверка баланса в фоновом режиме
 */

require('dotenv').config();
const { rotateToken, checkBalance, getCurrentToken } = require('./rotator');

// Интервал проверки (по умолчанию каждые 5 минут)
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '300000');

// Минимальный баланс для триггера ротации
const MIN_BALANCE = parseFloat(process.env.MIN_BALANCE || '0.1');

let isRunning = true;
let checkCount = 0;
let lastRotation = null;

/**
 * Форматирование даты
 */
function formatDate(date) {
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

/**
 * Лог с временной меткой
 */
function log(message) {
    console.log(`[${formatDate(new Date())}] ${message}`);
}

/**
 * Основной цикл проверки
 */
async function checkLoop() {
    while (isRunning) {
        checkCount++;
        log(`🔄 Проверка #${checkCount}`);
        
        try {
            const token = await getCurrentToken();
            
            if (!token) {
                log('⚠️ Токен не найден, выполняем ротацию...');
                const result = await rotateToken();
                if (result.rotated) {
                    lastRotation = new Date();
                    log(`✅ Ротация выполнена: ${result.email}`);
                }
            } else {
                const { valid, balance } = await checkBalance(token);
                
                if (!valid || balance <= MIN_BALANCE) {
                    log(`⚠️ Баланс низкий (${balance}), выполняем ротацию...`);
                    const result = await rotateToken();
                    if (result.rotated) {
                        lastRotation = new Date();
                        log(`✅ Ротация выполнена: ${result.email}`);
                    }
                } else {
                    log(`✅ Баланс OK: ${balance} кредитов`);
                }
            }
        } catch (error) {
            log(`❌ Ошибка: ${error.message}`);
        }
        
        // Показать статус
        if (lastRotation) {
            log(`📊 Последняя ротация: ${formatDate(lastRotation)}`);
        }
        
        log(`⏳ Следующая проверка через ${CHECK_INTERVAL / 1000} секунд\n`);
        
        // Ожидание
        await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
    }
}

/**
 * Обработка сигналов завершения
 */
function setupSignalHandlers() {
    process.on('SIGINT', () => {
        log('🛑 Получен SIGINT, завершение...');
        isRunning = false;
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        log('🛑 Получен SIGTERM, завершение...');
        isRunning = false;
        process.exit(0);
    });
}

/**
 * Запуск демона
 */
async function startDaemon() {
    console.log('\n' + '='.repeat(50));
    console.log('  🤖 CLINE Token Rotator Daemon');
    console.log('='.repeat(50));
    console.log(`  Интервал проверки: ${CHECK_INTERVAL / 1000} секунд`);
    console.log(`  Минимальный баланс: ${MIN_BALANCE}`);
    console.log('='.repeat(50) + '\n');
    
    setupSignalHandlers();
    
    // Первая проверка сразу
    await checkLoop();
}

// Запуск
startDaemon().catch(error => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
});
