# 🖥️ Настройка VNC для отладки капчи

Если Cloudflare Turnstile капча не решается автоматически, вы можете решать её вручную через VNC.

## 📋 Требования

- VPS с Ubuntu/Debian
- Минимум 1GB RAM (рекомендуется 2GB)
- VNC клиент (TightVNC, RealVNC, или встроенный в Windows)

---

## 🚀 Быстрая установка (один скрипт)

Запустите на сервере:

```bash
# Установка всего необходимого
apt update && apt install -y xvfb x11vnc fluxbox

# Создание systemd сервиса для Xvfb
cat > /etc/systemd/system/xvfb.service << 'EOF'
[Unit]
Description=X Virtual Frame Buffer
After=network.target

[Service]
ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Создание systemd сервиса для x11vnc
cat > /etc/systemd/system/x11vnc.service << 'EOF'
[Unit]
Description=VNC Server
After=xvfb.service
Requires=xvfb.service

[Service]
Environment=DISPLAY=:99
ExecStart=/usr/bin/x11vnc -display :99 -forever -nopw -listen 0.0.0.0 -xkb -shared
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Запуск сервисов
systemctl daemon-reload
systemctl enable --now xvfb
systemctl enable --now x11vnc

# Проверка
systemctl status x11vnc
```

---

## 🔧 Настройка приложения

1. Отредактируйте `.env` на сервере:

```bash
cd /var/www/cursor
nano .env
```

2. Измените настройки:

```env
# Показывать окно браузера
HEADLESS=false

# Включить режим ожидания капчи
CAPTCHA_WAIT_MODE=true

# Таймаут ожидания (5 минут)
CAPTCHA_WAIT_TIMEOUT=300
```

3. Добавьте переменную DISPLAY в PM2:

```bash
# Остановите приложение
pm2 stop cursor-register

# Запустите с DISPLAY
DISPLAY=:99 pm2 start app.js --name cursor-register

# Сохраните конфигурацию
pm2 save
```

Или добавьте в ecosystem.config.js:

```javascript
module.exports = {
  apps: [{
    name: 'cursor-register',
    script: 'app.js',
    env: {
      NODE_ENV: 'production',
      DISPLAY: ':99'
    }
  }]
}
```

---

## 🔌 Подключение через VNC

### Windows (встроенный клиент)

1. Откройте **Удалённый рабочий стол** (mstsc.exe не подходит!)
2. Скачайте [TightVNC Viewer](https://www.tightvnc.com/download.php)
3. Подключитесь к `ВАШ_IP:5900`

### macOS

```bash
open vnc://ВАШ_IP:5900
```

### Linux

```bash
vncviewer ВАШ_IP:5900
```

---

## 🌐 Альтернатива: noVNC (через браузер)

Если не хотите устанавливать VNC клиент:

```bash
# Установка noVNC
apt install -y novnc websockify

# Запуск
websockify -D --web=/usr/share/novnc/ 6080 localhost:5900

# Теперь доступ через браузер:
# http://ВАШ_IP:6080/vnc.html
```

---

## 🔄 Процесс решения капчи

1. Запустите регистрацию через веб-панель
2. Смотрите логи:
   ```bash
   pm2 logs cursor-register
   ```
3. Когда увидите:
   ```
   🔒 Обнаружена Cloudflare Turnstile капча!
   ⏳ CAPTCHA_WAIT_MODE включён - ожидаем ручное решение
   🖥️ Подключитесь через VNC и решите капчу вручную!
   ```
4. Подключитесь через VNC
5. Кликните на чекбокс "Verify you are human"
6. Дождитесь сообщения в логах:
   ```
   ✅ Капча решена! Продолжаем...
   ```

---

## 🛡️ Безопасность

**ВАЖНО:** VNC без пароля небезопасен!

Добавьте пароль:

```bash
# Остановите x11vnc
systemctl stop x11vnc

# Создайте пароль
x11vnc -storepasswd /root/.vnc/passwd

# Измените сервис
nano /etc/systemd/system/x11vnc.service
```

Замените `-nopw` на `-rfbauth /root/.vnc/passwd`:

```
ExecStart=/usr/bin/x11vnc -display :99 -forever -rfbauth /root/.vnc/passwd -listen 0.0.0.0 -xkb -shared
```

```bash
systemctl daemon-reload
systemctl start x11vnc
```

Или ограничьте доступ через firewall:

```bash
# Только с вашего IP
ufw allow from ВАШ_HOME_IP to any port 5900
```

---

## 🐛 Проблемы и решения

### Браузер не открывается

```bash
# Проверьте Xvfb
systemctl status xvfb
DISPLAY=:99 xdpyinfo

# Перезапустите
systemctl restart xvfb x11vnc
```

### Чёрный экран в VNC

```bash
# Запустите оконный менеджер
DISPLAY=:99 fluxbox &
```

### Ошибка "cannot open display"

```bash
# Убедитесь что DISPLAY установлен
export DISPLAY=:99

# Проверьте
echo $DISPLAY
```

---

## 📝 Полезные команды

```bash
# Статус сервисов
systemctl status xvfb x11vnc

# Логи
journalctl -u xvfb -f
journalctl -u x11vnc -f

# Скриншот текущего экрана
DISPLAY=:99 import -window root screenshot.png

# Список окон
DISPLAY=:99 wmctrl -l

# Закрыть все браузеры
DISPLAY=:99 pkill chrome
DISPLAY=:99 pkill chromium
```

---

## 💡 Советы

1. **Используйте резидентные прокси** - они реже получают капчу
2. **FlareSolverr** может помочь обойти капчу автоматически
3. **Не запускайте много аккаунтов одновременно** - повышает шанс капчи
4. **Меняйте IP** между регистрациями если возможно
