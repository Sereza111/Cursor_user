/**
 * Тестовый скрипт для проверки получения API KEY от CLINE
 * Использование: node test-cline-api.js <email> <password>
 */

require('dotenv').config();
const ClineRegister = require('./clineRegister');

// ВАЖНО: Для тестирования выключаем headless чтобы видеть браузер
process.env.HEADLESS = 'false';
process.env.SLOW_MO = '100';

async function test() {
    const email = process.argv[2];
    const password = process.argv[3];
    
    if (!email || !password) {
        console.log('❌ Использование: node test-cline-api.js <outlook_email> <password>');
        console.log('   Пример: node test-cline-api.js user@outlook.com mypassword123');
        process.exit(1);
    }
    
    console.log('🚀 Тестирование получения CLINE API KEY');
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Password: ${'*'.repeat(password.length)}`);
    console.log('');
    console.log('⚙️ Настройки:');
    console.log(`   HEADLESS: ${process.env.HEADLESS}`);
    console.log(`   SLOW_MO: ${process.env.SLOW_MO}`);
    console.log('');
    
    // Мокаем функции базы данных для тестирования
    const mockDb = {
        logs: [],
        account: {
            id: 'test-' + Date.now(),
            status: 'pending',
            session_token: null,
            access_token: null
        }
    };
    
    // Патчим require('./database')
    const originalRequire = require;
    require.cache[require.resolve('./database')] = {
        exports: {
            addLog: (sessionId, level, message) => {
                mockDb.logs.push({ sessionId, level, message, time: new Date().toISOString() });
            },
            updateAccount: (accountId, data) => {
                console.log(`\n📝 [DB UPDATE] Account ${accountId}:`, JSON.stringify(data, null, 2));
                Object.assign(mockDb.account, data);
            }
        }
    };
    
    try {
        const register = new ClineRegister('test-session', []);
        
        console.log('🔄 Запускаем авторизацию...\n');
        
        const result = await register.loginWithMicrosoft(
            mockDb.account.id,
            email,
            password
        );
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 РЕЗУЛЬТАТ:');
        console.log('='.repeat(60));
        
        if (result.success) {
            console.log('✅ УСПЕХ!');
            console.log('');
            
            if (result.apiKey) {
                console.log('🔑 API KEY ПОЛУЧЕН:');
                console.log(`   ${result.apiKey}`);
                console.log('');
                console.log('✅ Этот ключ можно использовать в local-rotator!');
            } else {
                console.log('⚠️ API KEY НЕ ПОЛУЧЕН');
                console.log('');
                console.log('📦 Сохранены cookies:', result.cookies?.length || 0, 'шт.');
                console.log('   (Cookies НЕ работают для local-rotator!)');
            }
            
            console.log('');
            console.log('🔗 Финальный URL:', result.finalUrl);
            
        } else {
            console.log('❌ ОШИБКА:', result.error);
            console.log('🔗 Финальный URL:', result.finalUrl);
        }
        
        console.log('');
        console.log('📜 Последние логи:');
        mockDb.logs.slice(-10).forEach(log => {
            console.log(`   [${log.level}] ${log.message}`);
        });
        
    } catch (error) {
        console.log('');
        console.log('❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
        console.log(error.stack);
    }
}

test();
