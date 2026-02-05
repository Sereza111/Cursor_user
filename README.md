# ⚜ Cursor Mass Register Panel

Веб-панель для массовой регистрации аккаунтов Cursor AI и авторизации CLINE через Microsoft OAuth с готическим интерфейсом и встроенным VNC просмотром.

![Gothic Theme](https://img.shields.io/badge/Theme-Gothic-black)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![License](https://img.shields.io/badge/License-MIT-blue)

## 📋 Возможности

- 📝 **Массовая регистрация** аккаунтов Cursor AI
- 🔑 **Авторизация CLINE** через Microsoft OAuth (Outlook аккаунты)
- 🎫 **Извлечение токенов** CLINE для API доступа
- 💰 **Проверка баланса** кредитов аккаунта
- 🖥️ **VNC Viewer** - просмотр браузера прямо в панели
- 🎭 **Stealth режим** - обход обнаружения автоматизации
- 👤 **Генерация имён** - 100+ рандомных имён и фамилий
- 📊 **Прогресс в реалтайме** - логи, статистика, прогресс-бар
- 📧 **Авто-верификация email** - чтение кодов через IMAP
- 💾 **SQLite база данных** - хранение всех результатов
- 📤 **Экспорт** в CSV/TXT форматы
- 🔐 **Авторизация** для доступа к панели
- 🎨 **Готический UI** - стильный тёмный интерфейс

## 🚀 Быстрый старт

### Локальный запуск (Windows/Mac)

```bash
# 1. Клонирование репозитория
git clone https://github.com/Sereza111/Cursor_user.git
cd Cursor_user

# 2. Установка зависимостей
npm install

# 3. Настройка конфигурации
cp .env.example .env
# Отредактируйте .env файл

# 4. Запуск
npm start
```

Откройте в браузере: **http://localhost:3000**

Логин по умолчанию: `admin` / `admin123`

### Запуск на Linux сервере (с VNC)

```bash
# 1. Клонирование репозитория
git clone https://github.com/Sereza111/Cursor_user.git
cd Cursor_user

# 2. Установка зависимостей
npm install

# 3. Установка пакетов для VNC
apt install -y xvfb x11vnc fluxbox

# 4. Настройка конфигурации
cp .env.example .env
nano .env
# Установите HEADLESS=false для VNC

# 5. Запуск VNC окружения
./start-vnc.sh

# 6. Запуск панели
npm start
```

**Адреса:**
- Панель: **http://your-server:3000**
- VNC просмотр: **http://your-server:3000/vnc**

## 📦 Требования

- **Node.js** 18.0+ 
- **npm** 8.0+
- **Chrome/Chromium** (устанавливается автоматически с Puppeteer)
- ~500 MB свободного места

### Для VNC на Linux:
- **Xvfb** - виртуальный дисплей
- **x11vnc** - VNC сервер
- **fluxbox** - оконный менеджер (опционально)

## 🖥️ VNC - Просмотр браузера

Панель имеет **встроенный VNC Viewer**, позволяющий смотреть работу браузера прямо в веб-интерфейсе.

### Настройка на сервере

```bash
# 1. Установка пакетов
apt update && apt install -y xvfb x11vnc fluxbox

# 2. Запуск автоматическим скриптом
./start-vnc.sh

# 3. Или вручную:
# Запуск виртуального дисплея
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99

# Запуск оконного менеджера
fluxbox &

# Запуск VNC сервера
x11vnc -display :99 -forever -nopw -listen 0.0.0.0 -xkb -rfbport 5900 &
```

### Настройка в .env

```env
# Включить окно браузера (обязательно для VNC!)
HEADLESS=false

# VNC подключение
VNC_HOST=localhost
VNC_PORT=5900
VNC_PASSWORD=
```

### Просмотр

1. Откройте **http://your-server:3000/vnc**
2. Нажмите "Подключиться"
3. Смотрите работу браузера в реальном времени!

## ⚙️ Конфигурация (.env)

```env
# ==========================================
# Основные настройки
# ==========================================
PORT=3000
SESSION_SECRET=change-me-to-random-32-character-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_this_password

# ==========================================
# Puppeteer (браузер)
# ==========================================
# false = с окном (для VNC), true = без окна
HEADLESS=false
SLOW_MO=50
TIMEOUT=60000

# ==========================================
# Регистрация
# ==========================================
REGISTER_DELAY=10000
MAX_RETRIES=3

# ==========================================
# VNC
# ==========================================
VNC_HOST=localhost
VNC_PORT=5900
VNC_PASSWORD=

# ==========================================
# IMAP - Автоматическое чтение почты
# ==========================================
IMAP_HOST=imap.beget.com
IMAP_PORT=993
IMAP_TLS=true
MAIL_PASSWORD=your_email_password
MAIL_VERIFICATION_ENABLED=false
MAIL_WAIT_TIMEOUT=120000
MAIL_CHECK_INTERVAL=5000

# ==========================================
# Прокси (опционально)
# ==========================================
# PROXY_LIST=http://user:pass@proxy1.com:8080

# ==========================================
# FlareSolverr - Обход Cloudflare
# ==========================================
FLARESOLVERR_ENABLED=false
FLARESOLVERR_URL=http://localhost:8191/v1
```

## 📖 Использование

### Режим "Авторизация CLINE"

1. Войдите в панель
2. Введите Outlook аккаунты в формате `email:password`
3. Выберите режим **"🔐 Авторизация CLINE"**
4. Нажмите "Запустить"
5. Следите за процессом через VNC (/vnc)
6. Получите токены CLINE и баланс кредитов

**Результат:**
- Токен CLINE для API
- Баланс кредитов
- Тип аккаунта (Personal/Business)
- Имя пользователя

### Режим "Регистрация Cursor"

1. Введите email аккаунты `email:password`
2. Выберите **"📝 Регистрация"**
3. Запустите процесс
4. Панель автоматически:
   - Откроет страницу регистрации
   - Сгенерирует имя/фамилию
   - Заполнит форму
   - Пройдёт верификацию (если настроен IMAP)

### Экспорт результатов

- **CSV** - для Excel/Google Sheets
- **TXT** - простой текстовый формат

## 🔄 Token Rotator - Автоматическая ротация токенов

Отдельный скрипт для **автоматической замены токенов CLINE** в VS Code когда баланс заканчивается.

### Возможности

- ✅ **Проверка баланса** текущего токена через API CLINE
- ✅ **Автоматическая ротация** при балансе <= 0
- ✅ **Интеграция с базой данных** панели (берёт токены из db.sqlite)
- ✅ **Daemon режим** - фоновая проверка каждые N минут
- ✅ **Установка токена** напрямую в VS Code SecretStorage

### Установка

```bash
cd token-rotator
npm install
cp .env.example .env
# Отредактируйте .env
```

### Использование

```bash
# Разовая проверка и ротация
npm start

# Только проверка баланса
npm run check

# Запуск демона (автопроверка каждые 5 минут)
npm run daemon
```

### Конфигурация token-rotator/.env

```env
# URL панели регистрации
PANEL_URL=http://109.172.37.69:3000

# Логин/пароль панели
PANEL_USERNAME=admin
PANEL_PASSWORD=admin123

# Путь к базе данных панели
DB_PATH=../db.sqlite

# Минимальный баланс для триггера ротации
MIN_BALANCE=0.1

# Интервал проверки (мс), 300000 = 5 минут
CHECK_INTERVAL=300000
```

### Как это работает

1. **Проверяет баланс** текущего токена CLINE в VS Code
2. **Если баланс <= 0** → берёт новый токен из базы данных панели
3. **Устанавливает токен** в VS Code SecretStorage (через keytar)
4. **Помечает аккаунт** как использованный в БД
5. **Требуется перезапуск VS Code** для применения нового токена

> ⚠️ **Windows only** - работает через Windows Credential Manager

## 🛠️ Структура проекта

```
Cursor_user/
├── app.js              # Express сервер + роуты
├── database.js         # SQLite база данных
├── cursorRegister.js   # Регистрация Cursor (Puppeteer)
├── clineRegister.js    # Авторизация CLINE через Microsoft
├── nameGenerator.js    # Генератор имён и паролей
├── mailReader.js       # IMAP чтение кодов из почты
├── vncProxy.js         # WebSocket прокси для VNC
├── start-vnc.sh        # Скрипт запуска VNC
├── package.json        # Зависимости проекта
├── .env                # Конфигурация (не в git!)
├── .env.example        # Пример конфигурации
├── VNC_SETUP.md        # Подробная инструкция VNC
├── views/              # EJS шаблоны
│   ├── login.ejs       # Страница входа
│   ├── index.ejs       # Главная страница
│   ├── vnc.ejs         # VNC Viewer
│   ├── session.ejs     # Детали сессии
│   └── error.ejs       # Страница ошибок
├── public/             # Статические файлы
│   ├── css/style.css   # Готические стили
│   └── js/main.js      # Клиентский JavaScript
└── token-rotator/      # ⭐ Скрипт ротации токенов
    ├── rotator.js      # Основная логика
    ├── daemon.js       # Фоновый демон
    ├── package.json    # Зависимости
    ├── .env.example    # Пример конфигурации
    └── README.md       # Документация
```

## 🖥️ Хостинг на сервере (VPS/VDS)

### PM2 + VNC (рекомендуется)

```bash
# 1. Установка PM2
npm install -g pm2

# 2. Клонирование и настройка
git clone https://github.com/Sereza111/Cursor_user.git
cd Cursor_user
npm install

# 3. Установка VNC пакетов
apt install -y xvfb x11vnc fluxbox

# 4. Настройка .env
cp .env.example .env
nano .env
# Установите HEADLESS=false

# 5. Создание PM2 ecosystem
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'cursor-register',
    script: 'app.js',
    env: {
      NODE_ENV: 'production',
      DISPLAY: ':99'
    }
  }]
};
EOF

# 6. Запуск VNC
./start-vnc.sh

# 7. Запуск через PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Docker с VNC

```dockerfile
# Dockerfile
FROM node:18-slim

# Установка зависимостей для Puppeteer и VNC
RUN apt-get update && apt-get install -y \
    chromium \
    xvfb \
    x11vnc \
    fluxbox \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV DISPLAY=:99

# Скрипт запуска
COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000 5900

ENTRYPOINT ["/docker-entrypoint.sh"]
```

```bash
# docker-entrypoint.sh
#!/bin/bash
Xvfb :99 -screen 0 1920x1080x24 &
sleep 1
fluxbox &
x11vnc -display :99 -forever -nopw -listen 0.0.0.0 -xkb -rfbport 5900 &
node app.js
```

### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  cursor-register:
    build: .
    container_name: cursor-panel
    restart: unless-stopped
    ports:
      - "3000:3000"
      - "5900:5900"
    environment:
      - PORT=3000
      - SESSION_SECRET=${SESSION_SECRET}
      - ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - HEADLESS=false
      - VNC_HOST=localhost
      - VNC_PORT=5900
    volumes:
      - ./db.sqlite:/app/db.sqlite
      - ./exports:/app/exports
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Основной сайт
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket для VNC
    location /vnc-ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

## 🔧 Решение проблем

### VNC показывает чёрный экран

```bash
# Проверьте, запущен ли Xvfb
ps aux | grep Xvfb

# Перезапустите VNC окружение
pkill Xvfb
pkill x11vnc
pkill fluxbox
./start-vnc.sh
```

### Ошибка "Session closed" в Puppeteer

Убедитесь, что в `.env` установлено `HEADLESS=false` и VNC запущен.

### Браузер не появляется

```bash
# Проверьте переменную DISPLAY
echo $DISPLAY
# Должно быть :99

# Установите вручную
export DISPLAY=:99
```

### Puppeteer не запускается на Linux

```bash
# Установка зависимостей
apt-get install -y libgbm-dev libnss3 libatk-bridge2.0-0 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libasound2
```

### База данных повреждена

```bash
rm db.sqlite
node app.js  # Создаст новую БД
```

## ⚠️ Важные замечания

1. **Измените пароль!** Не используйте `admin123` в продакшене
2. **SESSION_SECRET** должен быть уникальным (32+ символов)
3. **VNC необходим** для CLINE авторизации (обход диалогов)
4. **Прокси рекомендуются** для массовых операций
5. **Outlook аккаунты** должны быть верифицированы

## 🛡️ FlareSolverr - Обход Cloudflare

```bash
# Запуск FlareSolverr
docker run -d \
  --name=flaresolverr \
  -p 8191:8191 \
  ghcr.io/flaresolverr/flaresolverr:latest
```

В `.env`:
```env
FLARESOLVERR_ENABLED=true
FLARESOLVERR_URL=http://localhost:8191/v1
```

## 📄 Лицензия

MIT License - свободное использование.

## 🤝 Контакты

- GitHub: [@Sereza111](https://github.com/Sereza111)

---

<p align="center">
  ⚜ Cursor Mass Register Panel ⚜
</p>
