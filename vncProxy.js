/**
 * VNC WebSocket Proxy для noVNC
 * Проксирует VNC соединение через WebSocket для работы в браузере
 */

const net = require('net');
const WebSocket = require('ws');

class VNCProxy {
    constructor(server) {
        this.wss = null;
        this.connections = new Map();
        this.server = server;
        
        // VNC настройки из .env
        this.vncHost = process.env.VNC_HOST || 'localhost';
        this.vncPort = parseInt(process.env.VNC_PORT) || 5900;
        this.vncPassword = process.env.VNC_PASSWORD || '';
    }
    
    /**
     * Запуск WebSocket сервера для VNC
     */
    start() {
        // Создаём WebSocket сервер на том же HTTP сервере
        this.wss = new WebSocket.Server({ 
            server: this.server,
            path: '/vnc-ws'
        });
        
        this.wss.on('connection', (ws, req) => {
            console.log('🖥️ VNC WebSocket: новое подключение');
            
            // Получаем параметры из query string
            const url = new URL(req.url, `http://${req.headers.host}`);
            const host = url.searchParams.get('host') || this.vncHost;
            const port = parseInt(url.searchParams.get('port')) || this.vncPort;
            
            // Создаём TCP соединение к VNC серверу
            const vncSocket = net.createConnection({
                host: host,
                port: port
            }, () => {
                console.log(`🖥️ VNC: подключено к ${host}:${port}`);
            });
            
            // Сохраняем связь
            const connectionId = Date.now().toString();
            this.connections.set(connectionId, { ws, vncSocket });
            
            // Прокси данных от VNC сервера к WebSocket
            vncSocket.on('data', (data) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(data);
                }
            });
            
            // Прокси данных от WebSocket к VNC серверу
            ws.on('message', (data) => {
                if (vncSocket.writable) {
                    // Конвертируем Buffer если нужно
                    if (Buffer.isBuffer(data)) {
                        vncSocket.write(data);
                    } else if (data instanceof ArrayBuffer) {
                        vncSocket.write(Buffer.from(data));
                    } else {
                        vncSocket.write(Buffer.from(data));
                    }
                }
            });
            
            // Обработка закрытия WebSocket
            ws.on('close', () => {
                console.log('🖥️ VNC WebSocket: отключение');
                vncSocket.end();
                this.connections.delete(connectionId);
            });
            
            ws.on('error', (err) => {
                console.error('🖥️ VNC WebSocket ошибка:', err.message);
                vncSocket.end();
                this.connections.delete(connectionId);
            });
            
            // Обработка закрытия VNC соединения
            vncSocket.on('close', () => {
                console.log('🖥️ VNC TCP: соединение закрыто');
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
                this.connections.delete(connectionId);
            });
            
            vncSocket.on('error', (err) => {
                console.error('🖥️ VNC TCP ошибка:', err.message);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close(1011, err.message);
                }
                this.connections.delete(connectionId);
            });
        });
        
        console.log('🖥️ VNC WebSocket прокси запущен на /vnc-ws');
    }
    
    /**
     * Получение статуса подключений
     */
    getStatus() {
        return {
            active: this.connections.size,
            vncHost: this.vncHost,
            vncPort: this.vncPort
        };
    }
    
    /**
     * Закрытие всех подключений
     */
    closeAll() {
        for (const [id, conn] of this.connections) {
            try {
                conn.ws.close();
                conn.vncSocket.end();
            } catch (e) {}
        }
        this.connections.clear();
    }
}

module.exports = VNCProxy;
