# ⚜ Cursor Mass Register Panel

Веб-панель для массовой регистрации и проверки аккаунтов Cursor AI с готическим интерфейсом.

![Gothic Theme](https://img.shields.io/badge/Theme-Gothic-black)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![License](https://img.shields.io/badge/License-MIT-blue)

## 📋 Возможности

- 📝 **Массовая регистрация** аккаунтов Cursor AI
- 🔑 **Вход и проверка** статуса Pro Trial (7 дней)
- 🎭 **Stealth режим** - обход обнаружения автоматизации через Puppeteer
- 👤 **Генерация имён** - 100+ рандомных имён и фамилий
- 📊 **Прогресс в реалтайме** - логи, статистика, прогресс-бар
- 💾 **SQLite база данных** - хранение всех результатов
- 📤 **Экспорт** в CSV/TXT форматы
- 🔐 **Авторизация** для доступа к панели
- 🎨 **Готический UI** - стильный тёмный интерфейс

## 🚀 Быстрый старт

### Локальный запуск

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

## 📦 Требования

- **Node.js** 18.0+ 
- **npm** 8.0+
- **Chrome/Chromium** (устанавливается автоматически с Puppeteer)
- ~500 MB свободного места

## ⚙️ Конфигурация (.env)

```env
# Порт сервера
PORT=3000

# Секретный ключ для сессий (ОБЯЗАТЕЛЬНО измените!)
SESSION_SECRET=ваш-супер-секретный-ключ-32-символа

# Логин/пароль для входа в панель
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ваш_надежный_пароль

# Режим браузера (true = без GUI, false = с окном)
HEADLESS=true

# Задержка между действиями (мс)
SLOW_MO=50

# Задержка между регистрациями (мс)
REGISTER_DELAY=10000

# Максимум попыток при ошибке
MAX_RETRIES=3

# Таймаут операций (мс)
TIMEOUT=60000

# Прокси (опционально)
# PROXY_LIST=http://user:pass@proxy1.com:8080,http://proxy2.com:3128
```

## 🖥️ Хостинг на сервере (VPS/VDS)

### Вариант 1: PM2 (рекомендуется)

```bash
# 1. Установка PM2 глобально
npm install -g pm2

# 2. Клонирование и настройка
git clone https://github.com/Sereza111/Cursor_user.git
cd Cursor_user
npm install

# 3. Настройка .env
nano .env
# Измените SESSION_SECRET и ADMIN_PASSWORD!

# 4. Запуск через PM2
pm2 start app.js --name cursor-register

# 5. Автозапуск при перезагрузке сервера
pm2 startup
pm2 save

# Полезные команды PM2:
pm2 logs cursor-register    # Просмотр логов
pm2 restart cursor-register # Перезапуск
pm2 stop cursor-register    # Остановка
pm2 status                  # Статус всех процессов
```

### Вариант 2: Docker

```dockerfile
# Dockerfile
FROM node:18-slim

# Установка зависимостей для Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
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

EXPOSE 3000

CMD ["node", "app.js"]
```

```bash
# Сборка и запуск Docker
docker build -t cursor-register .
docker run -d -p 3000:3000 --name cursor-panel \
  -e SESSION_SECRET=your-secret-key \
  -e ADMIN_PASSWORD=your-password \
  -v $(pwd)/db.sqlite:/app/db.sqlite \
  cursor-register
```

### Вариант 3: Docker Compose

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
    environment:
      - PORT=3000
      - SESSION_SECRET=${SESSION_SECRET}
      - ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - HEADLESS=true
    volumes:
      - ./db.sqlite:/app/db.sqlite
      - ./exports:/app/exports
```

```bash
# Запуск
docker-compose up -d

# Просмотр логов
docker-compose logs -f
```

### Вариант 4: Systemd Service

```bash
# /etc/systemd/system/cursor-register.service
[Unit]
Description=Cursor Mass Register Panel
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/cursor-register
ExecStart=/usr/bin/node app.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
# Активация и запуск
sudo systemctl daemon-reload
sudo systemctl enable cursor-register
sudo systemctl start cursor-register

# Статус
sudo systemctl status cursor-register
```

### Настройка Nginx (reverse proxy)

```bash
# Создание файла конфигурации nginx
sudo nano /etc/nginx/sites-available/cursor-register
```

Вставьте следующий конфиг:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
```

```bash
# Активация сайта
sudo ln -s /etc/nginx/sites-available/cursor-register /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# SSL сертификат (опционально)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 📖 Использование

1. **Войдите** в панель (admin/admin123 по умолчанию)
2. **Введите аккаунты** в формате `email:password` (каждый с новой строки)
3. **Выберите режим**:
   - 📝 **Регистрация** - создание новых аккаунтов
   - 🔑 **Вход + Проверка Trial** - проверка существующих аккаунтов
4. **Нажмите "Запустить"** и следите за прогрессом
5. **Экспортируйте результаты** в CSV или TXT

## 🛠️ Структура проекта

```
Cursor_user/
├── app.js              # Главный сервер Express
├── database.js         # Модуль SQLite базы данных
├── cursorRegister.js   # Модуль автоматизации Puppeteer
├── nameGenerator.js    # Генератор имён и паролей
├── package.json        # Зависимости проекта
├── .env                # Конфигурация (не в git!)
├── views/              # EJS шаблоны
│   ├── login.ejs       # Страница входа
│   ├── index.ejs       # Главная страница
│   ├── session.ejs     # Детали сессии
│   └── error.ejs       # Страница ошибок
└── public/             # Статические файлы
    ├── css/style.css   # Готические стили
    └── js/main.js      # Клиентский JavaScript
```

## ⚠️ Важные замечания

1. **Измените пароль!** Не используйте `admin123` в продакшене
2. **SESSION_SECRET** должен быть уникальным и длинным (32+ символов)
3. **CAPTCHA** - Cloudflare Turnstile может блокировать автоматизацию
4. **Прокси** рекомендуются для массовой регистрации
5. **Rate Limits** - не запускайте слишком много аккаунтов подряд

## 🔧 Решение проблем

### Puppeteer не запускается
```bash
# Ubuntu/Debian - установка зависимостей
sudo apt-get install -y libgbm-dev libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2

# Или использовать system Chrome
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
```

### Ошибка "Cannot find module"
```bash
rm -rf node_modules package-lock.json
npm install
```

### База данных повреждена
```bash
rm db.sqlite
node app.js  # Создаст новую БД
```

## 🛡️ FlareSolverr - Обход Cloudflare

Если вы сталкиваетесь с Cloudflare Turnstile CAPTCHA, используйте **FlareSolverr** для обхода защиты.

### Установка FlareSolverr

#### Вариант 1: Docker (рекомендуется)

```bash
# Запуск FlareSolverr в Docker
docker run -d \
  --name=flaresolverr \
  -p 8191:8191 \
  -e LOG_LEVEL=info \
  --restart unless-stopped \
  ghcr.io/flaresolverr/flaresolverr:latest
```

#### Вариант 2: Docker Compose

Добавьте в ваш `docker-compose.yml`:

```yaml
version: '3.8'

services:
  cursor-register:
    build: .
    container_name: cursor-panel
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - SESSION_SECRET=${SESSION_SECRET}
      - ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - HEADLESS=true
      - FLARESOLVERR_ENABLED=true
      - FLARESOLVERR_URL=http://flaresolverr:8191/v1
    volumes:
      - ./db.sqlite:/app/db.sqlite
      - ./exports:/app/exports
    depends_on:
      - flaresolverr

  flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    container_name: flaresolverr
    restart: unless-stopped
    environment:
      - LOG_LEVEL=info
      - LOG_HTML=false
      - CAPTCHA_SOLVER=none
      - TZ=Europe/Moscow
    ports:
      - "8191:8191"
```

```bash
# Запуск
docker-compose up -d

# Проверка статуса FlareSolverr
curl http://localhost:8191/v1 -X POST \
  -H "Content-Type: application/json" \
  -d '{"cmd": "sessions.list"}'
```

### Настройка в .env

```env
# Включить FlareSolverr
FLARESOLVERR_ENABLED=true

# URL сервера FlareSolverr
# Локально: http://localhost:8191/v1
# Docker: http://flaresolverr:8191/v1
# Удалённо: http://YOUR_SERVER_IP:8191/v1
FLARESOLVERR_URL=http://localhost:8191/v1
```

### Как это работает

1. **FlareSolverr** получает запрос на URL страницы регистрации
2. Использует **undetectable browser** для прохождения Cloudflare
3. Возвращает **куки сессии** и **User-Agent**
4. Puppeteer использует эти куки для доступа к странице
5. Cloudflare видит "легитимную" сессию и пропускает

### Ограничения

- FlareSolverr решает **Cloudflare JS Challenge**, но не **Turnstile виджет** внутри формы
- Для Turnstile внутри формы нужен платный сервис (2Captcha, CapSolver)
- Рекомендуется использовать **резидентные прокси** для лучших результатов

## 📄 Лицензия

MIT License - свободное использование.

## 🤝 Контакты

- GitHub: [@Sereza111](https://github.com/Sereza111)

---

<p align="center">
  ⚜ Cursor Mass Register Panel ⚜
</p>
