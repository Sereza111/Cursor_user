#!/bin/bash
# Скрипт запуска Xvfb + x11vnc для Puppeteer
# Запуск: chmod +x start-vnc.sh && ./start-vnc.sh

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   🖥️  VNC Server Setup for Puppeteer${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"

# Проверка root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${YELLOW}⚠️  Рекомендуется запускать от root для установки пакетов${NC}"
fi

# Параметры
DISPLAY_NUM=${DISPLAY_NUM:-99}
VNC_PORT=${VNC_PORT:-5900}
SCREEN_RES=${SCREEN_RES:-1920x1080x24}

echo -e "\n${YELLOW}📋 Конфигурация:${NC}"
echo "   Display: :$DISPLAY_NUM"
echo "   VNC Port: $VNC_PORT"
echo "   Resolution: $SCREEN_RES"

# Установка зависимостей если нужно
install_deps() {
    echo -e "\n${YELLOW}📦 Проверка и установка зависимостей...${NC}"
    
    # Определяем пакетный менеджер
    if command -v apt-get &> /dev/null; then
        PKG_MANAGER="apt-get"
        PKG_INSTALL="apt-get install -y"
        PKG_UPDATE="apt-get update"
    elif command -v yum &> /dev/null; then
        PKG_MANAGER="yum"
        PKG_INSTALL="yum install -y"
        PKG_UPDATE="yum update -y"
    elif command -v dnf &> /dev/null; then
        PKG_MANAGER="dnf"
        PKG_INSTALL="dnf install -y"
        PKG_UPDATE=""
    else
        echo -e "${RED}❌ Неизвестный пакетный менеджер${NC}"
        return 1
    fi
    
    # Обновляем репозитории
    if [ -n "$PKG_UPDATE" ]; then
        echo "   Обновление репозиториев..."
        $PKG_UPDATE > /dev/null 2>&1
    fi
    
    # Проверяем и устанавливаем Xvfb
    if ! command -v Xvfb &> /dev/null; then
        echo "   Установка Xvfb..."
        $PKG_INSTALL xvfb > /dev/null 2>&1 || $PKG_INSTALL xorg-x11-server-Xvfb > /dev/null 2>&1
    else
        echo -e "   ${GREEN}✓${NC} Xvfb установлен"
    fi
    
    # Проверяем и устанавливаем x11vnc
    if ! command -v x11vnc &> /dev/null; then
        echo "   Установка x11vnc..."
        $PKG_INSTALL x11vnc > /dev/null 2>&1
    else
        echo -e "   ${GREEN}✓${NC} x11vnc установлен"
    fi
    
    # Опционально: fluxbox для оконного менеджера
    if ! command -v fluxbox &> /dev/null; then
        echo "   Установка fluxbox (опционально)..."
        $PKG_INSTALL fluxbox > /dev/null 2>&1 || true
    else
        echo -e "   ${GREEN}✓${NC} fluxbox установлен"
    fi
    
    # Проверка Chrome/Chromium
    if command -v google-chrome &> /dev/null || command -v chromium-browser &> /dev/null || command -v chromium &> /dev/null; then
        echo -e "   ${GREEN}✓${NC} Chrome/Chromium установлен"
    else
        echo -e "   ${YELLOW}⚠️${NC} Chrome не найден. Устанавливаем Chromium..."
        $PKG_INSTALL chromium-browser > /dev/null 2>&1 || $PKG_INSTALL chromium > /dev/null 2>&1 || true
    fi
}

# Остановка существующих процессов
stop_existing() {
    echo -e "\n${YELLOW}🛑 Остановка существующих процессов...${NC}"
    
    # Убиваем существующие Xvfb на этом дисплее
    pkill -f "Xvfb :$DISPLAY_NUM" 2>/dev/null || true
    
    # Убиваем x11vnc
    pkill -f "x11vnc.*:$DISPLAY_NUM" 2>/dev/null || true
    
    # Убиваем fluxbox
    pkill -f "fluxbox" 2>/dev/null || true
    
    # Ждём завершения
    sleep 2
    
    # Удаляем lock файлы
    rm -f /tmp/.X$DISPLAY_NUM-lock 2>/dev/null || true
    rm -f /tmp/.X11-unix/X$DISPLAY_NUM 2>/dev/null || true
    
    echo -e "   ${GREEN}✓${NC} Процессы остановлены"
}

# Запуск Xvfb
start_xvfb() {
    echo -e "\n${YELLOW}🖥️  Запуск Xvfb...${NC}"
    
    # Запускаем Xvfb
    Xvfb :$DISPLAY_NUM -screen 0 $SCREEN_RES -ac +extension GLX +render -noreset &
    XVFB_PID=$!
    
    # Ждём запуска
    sleep 2
    
    # Проверяем
    if kill -0 $XVFB_PID 2>/dev/null; then
        echo -e "   ${GREEN}✓${NC} Xvfb запущен (PID: $XVFB_PID)"
        export DISPLAY=:$DISPLAY_NUM
        echo "   DISPLAY=:$DISPLAY_NUM"
    else
        echo -e "   ${RED}❌${NC} Ошибка запуска Xvfb"
        return 1
    fi
}

# Запуск оконного менеджера
start_wm() {
    echo -e "\n${YELLOW}🪟 Запуск оконного менеджера...${NC}"
    
    export DISPLAY=:$DISPLAY_NUM
    
    if command -v fluxbox &> /dev/null; then
        fluxbox &
        WM_PID=$!
        sleep 1
        if kill -0 $WM_PID 2>/dev/null; then
            echo -e "   ${GREEN}✓${NC} Fluxbox запущен (PID: $WM_PID)"
        fi
    else
        echo -e "   ${YELLOW}⚠️${NC} Fluxbox не установлен, пропускаем"
    fi
}

# Запуск x11vnc
start_vnc() {
    echo -e "\n${YELLOW}📡 Запуск x11vnc...${NC}"
    
    # Параметры x11vnc
    VNC_OPTS="-display :$DISPLAY_NUM"
    VNC_OPTS="$VNC_OPTS -forever"        # Не выходить после отключения клиента
    VNC_OPTS="$VNC_OPTS -shared"         # Разрешить несколько подключений
    VNC_OPTS="$VNC_OPTS -nopw"           # Без пароля (или -passwd FILE для пароля)
    VNC_OPTS="$VNC_OPTS -listen 0.0.0.0" # Слушать на всех интерфейсах
    VNC_OPTS="$VNC_OPTS -xkb"            # Использовать XKB для клавиатуры
    VNC_OPTS="$VNC_OPTS -rfbport $VNC_PORT"
    VNC_OPTS="$VNC_OPTS -bg"             # Запуск в фоне
    VNC_OPTS="$VNC_OPTS -o /tmp/x11vnc.log"
    
    # Если нужен пароль
    if [ -n "$VNC_PASSWORD" ]; then
        echo "$VNC_PASSWORD" > /tmp/.vncpasswd
        VNC_OPTS="$VNC_OPTS -passwdfile /tmp/.vncpasswd"
        echo "   Используется пароль из переменной VNC_PASSWORD"
    fi
    
    # Запускаем
    x11vnc $VNC_OPTS
    
    # Ждём и проверяем
    sleep 2
    
    if netstat -tlnp 2>/dev/null | grep -q ":$VNC_PORT" || ss -tlnp 2>/dev/null | grep -q ":$VNC_PORT"; then
        echo -e "   ${GREEN}✓${NC} x11vnc запущен на порту $VNC_PORT"
        
        # Показываем статус
        echo -e "\n${GREEN}═══════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}   ✅ VNC сервер успешно запущен!${NC}"
        echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
        echo ""
        echo -e "   ${YELLOW}Подключение:${NC}"
        echo "   • VNC: localhost:$VNC_PORT"
        echo "   • WebSocket: ws://localhost:3000/vnc-ws"
        echo "   • Web UI: http://localhost:3000/vnc"
        echo ""
        echo -e "   ${YELLOW}Для Puppeteer в .env:${NC}"
        echo "   VNC_HOST=localhost"
        echo "   VNC_PORT=$VNC_PORT"
        echo "   HEADLESS=false"
        echo ""
        echo -e "   ${YELLOW}Экспорт DISPLAY:${NC}"
        echo "   export DISPLAY=:$DISPLAY_NUM"
        echo ""
    else
        echo -e "   ${RED}❌${NC} Ошибка запуска x11vnc"
        cat /tmp/x11vnc.log 2>/dev/null || true
        return 1
    fi
}

# Проверка статуса
check_status() {
    echo -e "\n${YELLOW}📊 Проверка статуса...${NC}"
    
    # Xvfb
    if pgrep -f "Xvfb :$DISPLAY_NUM" > /dev/null; then
        echo -e "   Xvfb: ${GREEN}работает${NC}"
    else
        echo -e "   Xvfb: ${RED}не запущен${NC}"
    fi
    
    # x11vnc
    if pgrep -f "x11vnc" > /dev/null; then
        echo -e "   x11vnc: ${GREEN}работает${NC}"
    else
        echo -e "   x11vnc: ${RED}не запущен${NC}"
    fi
    
    # VNC порт
    if netstat -tlnp 2>/dev/null | grep -q ":$VNC_PORT" || ss -tlnp 2>/dev/null | grep -q ":$VNC_PORT"; then
        echo -e "   Порт $VNC_PORT: ${GREEN}открыт${NC}"
    else
        echo -e "   Порт $VNC_PORT: ${RED}закрыт${NC}"
    fi
}

# Основная логика
case "${1:-start}" in
    start)
        install_deps
        stop_existing
        start_xvfb
        start_wm
        start_vnc
        ;;
    stop)
        stop_existing
        echo -e "${GREEN}✓ VNC сервер остановлен${NC}"
        ;;
    restart)
        $0 stop
        sleep 1
        $0 start
        ;;
    status)
        check_status
        ;;
    *)
        echo "Использование: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
