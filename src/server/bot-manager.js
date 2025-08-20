const io = require('socket.io-client');
const config = require('../../config');

class Bot {
    constructor(name, serverUrl = 'http://localhost:3000') {
        this.name = name;
        this.serverUrl = serverUrl;
        this.socket = null;
        this.isConnected = false;
        this.target = { x: 0, y: 0 };
        this.position = { x: 0, y: 0 };
        this.mass = 10;
        this.isAlive = false;
        
        // Comportamiento del bot
        this.behavior = {
            moveRandomly: true,
            eatFood: true,
            avoidPlayers: true,
            splitWhenSafe: false
        };
    }

    connect() {
        this.socket = io(this.serverUrl, {
            query: { type: 'player' },
            timeout: 20000,
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        this.socket.on('connect', () => {
            console.log(`[BOT] ${this.name} conectado`);
            this.isConnected = true;
            
            // Pequeño delay antes de enviar datos
            setTimeout(() => {
                if (this.isConnected) {
                    this.socket.emit('gotit', {
                        name: this.name,
                        screenWidth: 1920,
                        screenHeight: 1080
                    });
                }
            }, 100);
        });

        this.socket.on('welcome', (playerData, gameConfig) => {
            console.log(`[BOT] ${this.name} recibió bienvenida`);
            this.isAlive = true;
            this.position = { x: playerData.x, y: playerData.y };
            this.target = { x: playerData.x, y: playerData.y };
            
            // Iniciar heartbeat regular
            this.startHeartbeat();
        });

        this.socket.on('serverTellPlayerMove', (playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses) => {
            if (playerData && playerData.x !== undefined && playerData.y !== undefined) {
                this.position = { x: playerData.x, y: playerData.y };
                this.mass = playerData.massTotal || 10;
                
                // Tomar decisiones del bot
                this.makeDecisions(visiblePlayers, visibleFood, visibleMass, visibleViruses);
            }
        });

        this.socket.on('RIP', () => {
            console.log(`[BOT] ${this.name} murió`);
            this.isAlive = false;
            this.stopHeartbeat();
            
            // Respawn automático después de 3 segundos
            setTimeout(() => {
                if (this.isConnected && this.socket) {
                    try {
                        this.socket.emit('respawn');
                    } catch (error) {
                        console.error(`[BOT] ${this.name} error en respawn:`, error);
                    }
                }
            }, 3000);
        });

        this.socket.on('disconnect', (reason) => {
            console.log(`[BOT] ${this.name} desconectado: ${reason}`);
            this.isConnected = false;
            this.isAlive = false;
            this.stopHeartbeat();
        });

        this.socket.on('connect_error', (error) => {
            console.error(`[BOT] ${this.name} error de conexión:`, error);
        });

        this.socket.on('error', (error) => {
            console.error(`[BOT] ${this.name} error:`, error);
        });
    }

    startHeartbeat() {
        // Enviar heartbeat cada 50ms (20 veces por segundo)
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected && this.socket && this.isAlive) {
                try {
                    this.socket.emit('0', this.target);
                } catch (error) {
                    console.error(`[BOT] ${this.name} error en heartbeat:`, error);
                }
            }
        }, 50);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    makeDecisions(visiblePlayers, visibleFood, visibleMass, visibleViruses) {
        if (!this.isAlive || !this.isConnected) return;

        // Inicializar target si no existe
        if (!this.target) {
            this.target = { x: this.position.x, y: this.position.y };
        }

        // Encontrar la comida más cercana
        let closestFood = null;
        let closestDistance = Infinity;

        if (visibleFood && visibleFood.length > 0) {
            for (let food of visibleFood) {
                const distance = Math.sqrt(
                    Math.pow(food.x - this.position.x, 2) + 
                    Math.pow(food.y - this.position.y, 2)
                );
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestFood = food;
                }
            }
        }

        // Encontrar el jugador más cercano
        let closestPlayer = null;
        let closestPlayerDistance = Infinity;

        if (visiblePlayers && visiblePlayers.length > 0) {
            for (let player of visiblePlayers) {
                if (player.id !== this.socket.id) {
                    const distance = Math.sqrt(
                        Math.pow(player.x - this.position.x, 2) + 
                        Math.pow(player.y - this.position.y, 2)
                    );
                    if (distance < closestPlayerDistance) {
                        closestPlayerDistance = distance;
                        closestPlayer = player;
                    }
                }
            }
        }

        // Tomar decisiones basadas en el comportamiento
        if (this.behavior.avoidPlayers && closestPlayer && closestPlayerDistance < 200) {
            // Huir del jugador cercano
            const angle = Math.atan2(
                this.position.y - closestPlayer.y,
                this.position.x - closestPlayer.x
            );
            this.target = {
                x: this.position.x + Math.cos(angle) * 100,
                y: this.position.y + Math.sin(angle) * 100
            };
        } else if (this.behavior.eatFood && closestFood) {
            // Ir hacia la comida más cercana
            this.target = { x: closestFood.x, y: closestFood.y };
        } else if (this.behavior.moveRandomly) {
            // Movimiento aleatorio
            if (Math.random() < 0.005) { // 0.5% de probabilidad de cambiar dirección
                const angle = Math.random() * 2 * Math.PI;
                this.target = {
                    x: this.position.x + Math.cos(angle) * 300,
                    y: this.position.y + Math.sin(angle) * 300
                };
            }
        }

        // NO enviar movimiento aquí, el heartbeat se encarga de eso
    }

    disconnect() {
        this.stopHeartbeat();
        if (this.socket) {
            this.socket.disconnect();
        }
    }
}

class BotManager {
    constructor() {
        this.bots = [];
        this.botNames = [
            'AlphaBot', 'BetaBot', 'GammaBot', 'DeltaBot', 'EpsilonBot',
            'ZetaBot', 'EtaBot', 'ThetaBot', 'IotaBot', 'KappaBot',
            'LambdaBot', 'MuBot', 'NuBot', 'XiBot', 'OmicronBot',
            'PiBot', 'RhoBot', 'SigmaBot', 'TauBot', 'UpsilonBot'
        ];
    }

    createBot(name = null) {
        const botName = name || this.botNames[Math.floor(Math.random() * this.botNames.length)];
        const bot = new Bot(botName);
        this.bots.push(bot);
        return bot;
    }

    connectBot(bot) {
        bot.connect();
    }

    connectAllBots() {
        this.bots.forEach(bot => bot.connect());
    }

    disconnectBot(bot) {
        bot.disconnect();
        const index = this.bots.indexOf(bot);
        if (index > -1) {
            this.bots.splice(index, 1);
        }
    }

    disconnectAllBots() {
        this.bots.forEach(bot => bot.disconnect());
        this.bots = [];
    }

    getConnectedBots() {
        return this.bots.filter(bot => bot.isConnected);
    }

    getAliveBots() {
        return this.bots.filter(bot => bot.isAlive);
    }
}

module.exports = { Bot, BotManager };
