# CLINE Local Token Rotator v2

Локальный скрипт для автоматической ротации токенов CLINE в VS Code.

## Как это работает

1. Скрипт запрашивает cookies сессии CLINE с сервера панели
2. Использует Puppeteer для авторизации на cline.bot с этими cookies
3. Получает или генерирует API key со страницы настроек
4. Устанавливает API key в VS Code через keytar (SecretStorage)
5. VS Code CLINE автоматически использует новый токен

## Требования

- Windows с VS Code и расширением CLINE
- Node.js 18+
- Chrome/Chromium (автоматически скачивается Puppeteer)
- Доступ к серверу панели регистрации

## Установка

```bash
cd local-rotator
npm install
```

## Настройка

Создайте файл `.env`:

```env
# URL сервера с панелью регистрации
SERVER_URL=http://109.172.37.69:3002

# API ключ для получения токенов (из .env сервера - TOKEN_API_KEY)
API_KEY=your-token-api-key

# Минимальный баланс для замены токена ($)
MIN_BALANCE=0.10

# Puppeteer: true = без окна браузера, false = с окном
HEADLESS=true

# Таймаут операций (мс)
TIMEOUT=30000

# Интервал проверки для daemon (секунды)
CHECK_INTERVAL=300

# Режим отладки
VERBOSE=false
```

## Использование

### Разовая проверка и замена
```bash
npm start
# или
node rotator.js
```

### Только проверка баланса (без замены)
```bash
npm run check
# или
node rotator.js --check-only
```

### Тест получения сессии с сервера
```bash
npm run test-fetch
# или
node rotator.js --test-fetch
```

### Daemon режим (автоматическая проверка)
```bash
npm run daemon
# или
node daemon.js
```

В daemon режиме скрипт:
- Проверяет баланс каждые N секунд (CHECK_INTERVAL)
- Автоматически меняет токен когда баланс ниже MIN_BALANCE
- Работает в фоне

## Как работает авторизация

### Сервер (clineRegister.js):
1. Авторизует аккаунт Microsoft на cline.bot
2. Сохраняет все cookies сессии в БД (`session_token`)

### Local-rotator:
1. Получает cookies с сервера через API `/api/token/fetch`
2. Запускает Puppeteer и устанавливает cookies
3. Переходит на dashboard CLINE для проверки авторизации
4. Ищет или генерирует API key на странице настроек
5. Сохраняет API key в VS Code keytar

## Важно

- **Перезапуск VS Code**: После установки нового API key нужно перезапустить VS Code
- **Puppeteer**: При первом запуске автоматически скачается Chromium (~150MB)
- **Headless**: Для отладки установите `HEADLESS=false` чтобы видеть браузер

## Логи и отладка

Скрипт создаёт скриншоты для отладки:
- `debug_auth_required.png` - если cookies не работают
- `debug_api_keys_page.png` - страница с API keys

Для подробных логов:
```env
VERBOSE=true
```

## Структура файлов

```
local-rotator/
├── rotator.js      # Основной скрипт
├── daemon.js       # Daemon для автопроверки
├── package.json    # Зависимости
├── .env            # Конфигурация (создать самому)
└── README.md       # Документация
```

## Troubleshooting

### "API key не найден"
- Возможно CLINE использует другой метод авторизации
- Попробуйте с `HEADLESS=false` чтобы увидеть что происходит
- Проверьте скриншот `debug_api_keys_page.png`

### "Cookies не работают"
- Cookies могли истечь, зарегистрируйте новый аккаунт
- Проверьте скриншот `debug_auth_required.png`

### "Нет доступных сессий"
- На сервере закончились неиспользованные аккаунты CLINE
- Зарегистрируйте новые аккаунты через панель
