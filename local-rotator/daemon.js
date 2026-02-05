/**
 * CLINE Local Token Rotator - Daemon
 * ====================================
 * 
 * Фоновый процесс, который автоматически проверяет баланс
 * и меняет токен когда он заканчивается.
 * 
 * Запуск: npm run daemon
 */

require('dotenv').config();
const { checkAndRotate, checkBalance, getCurrentToken } = require('./rotator');

// Интервал проверки (по умолчанию 5 минут)
const CHECK_INTERVAL = (parseInt(process.env.CHECK_INTERVAL) || 300) * 1000;
const MIN_BALANCE = parseFloat(process.env.MIN_BALANCE) || 0.10;

console.log('');
console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║                                                           ║');
console.log('║      🤖 CLINE LOCAL TOKEN ROTATOR - DAEMON                ║');
console.log('║                                                           ║');
console.log(`║      Интервал проверки: ${CHECK_INTERVAL / 1000} сек (${CHECK_INTERVAL / 60000} мин)             ║`);
console.log(`║      Минимальный баланс: $${MIN_BALANCE}                          ║`);
console.log('║                                                           ║');
console.log('║      Нажмите Ctrl+C для остановки                         ║');
console.log('║                                                           ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log('');

let checkCount = 0;

async function runCheck() {
    checkCount++;
    const timestamp = new Date().toLocaleString();
    
    console.log(`\n[${timestamp}] 🔄 Проверка #${checkCount}`);
    console.log('-'.repeat(40));
    
    try {
        // Получаем текущий токен
        const currentToken = await getCurrentToken();
        
        if (!currentToken) {
            console.log('⚠️ Токен не найден, запускаем ротацию...');
            await checkAndRotate();
            return;
        }
        
        // Проверяем баланс
        const { success, balance, error } = await checkBalance(currentToken);
        
        if (!success) {
            console.log(`⚠️ Проблема с токеном: ${error}`);
            await checkAndRotate();
            return;
        }
        
        if (balance < MIN_BALANCE) {
            console.log(`⚠️ Баланс низкий: $${balance.toFixed(2)} < $${MIN_BALANCE}`);
            await checkAndRotate();
        } else {
            console.log(`✅ Баланс OK: $${balance.toFixed(2)}`);
        }
        
    } catch (err) {
        console.log(`❌ Ошибка проверки: ${err.message}`);
    }
}

// Первая проверка сразу при запуске
runCheck();

// Затем по интервалу
setInterval(runCheck, CHECK_INTERVAL);

// Обработка завершения
process.on('SIGINT', () => {
    console.log('\n\n👋 Daemon остановлен');
    console.log(`   Всего проверок: ${checkCount}`);
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n👋 Daemon остановлен (SIGTERM)');
    process.exit(0);
});
