/*jslint bitwise: true, node: true */
'use strict';

// Cargar variables de entorno desde .env
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const SAT = require('sat');

const { RedZone } = require('./game-logic');
const loggingRepositry = require('./repositories/logging-repository');
const chatRepository = require('./repositories/chat-repository');
const authRepository = require('./repositories/auth-repository');
const { BombManager } = require('./map/bomb');
const config = require('../../config');
const util = require('./lib/util');
const mapUtils = require('./map/map');
const {getPosition} = require("./lib/entityUtils");

let map = new mapUtils.Map(config);
let redZone = new RedZone(config);
console.log(`[REDZONE] Zona roja inicializada con radio: ${redZone.radius.toFixed(0)}`);
console.log(`[REDZONE] Configuración: enabled=${config.redZone.enabled}, damagePerSecond=${config.redZone.damagePerSecond}`);

// Variables para el sistema de eventos globales
let speedEventActive = false;
let speedEventTimer = null;
let speedEventWarningTimer = null;
let speedEventCountdown = null;

// Variables para el sistema de eventos de bombas
let bombEventActive = false;
let bombEventTimer = null;
let bombEventWarningTimer = null;
let bombEventCountdown = null;
let bombManager = null;

// Inicializar el gestor de bombas (después de declarar bombManager)
if (config.globalEvents && config.globalEvents.bombEvent && config.globalEvents.bombEvent.enabled) {
    bombManager = new BombManager(config.globalEvents.bombEvent);
    console.log('[BOMB_EVENT] Gestor de bombas inicializado');
}

let sockets = {};
let spectators = [];
let playerUserIds = {}; // Mapeo de socket.id -> userId
const INIT_MASS_LOG = util.mathLog(config.defaultPlayerMass, config.slowBase);

let leaderboard = [];
let leaderboardChanged = false;

const Vector = SAT.Vector;

// Configuración de sesión
const authConfig = require('../../config/google-auth');
app.use(session(authConfig.session));

// Configuración de Passport
require('./passport-config');
app.use(passport.initialize());
app.use(passport.session());

app.use(express.json());
app.use(express.static(__dirname + '/../client'));

// Rutas de autenticación (solo Google OAuth)

app.post('/api/logout', async (req, res) => {
    try {
        const { sessionToken } = req.body;
        
        if (!sessionToken) {
            return res.status(400).json({ error: 'Token de sesión requerido' });
        }
        
        await authRepository.logoutUser(sessionToken);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Verificar configuración de Passport antes de definir rutas
console.log('[SERVER] Verificando estrategias de Passport antes de definir rutas:', Object.keys(passport._strategies));

// Rutas de Google OAuth
app.get('/auth/google', passport.authenticate('google', { 
    scope: ['profile', 'email'] 
}));

app.get('/auth/google/callback', 
    passport.authenticate('google', { 
        failureRedirect: '/?error=google_auth_failed'
    }), 
    (req, res) => {
        console.log('[GOOGLE_CALLBACK] Usuario autenticado exitosamente:', req.user.username);
        console.log('[GOOGLE_CALLBACK] Session ID:', req.sessionID);
        res.redirect('/?success=google_auth_success');
    }
);

// Ruta para verificar si el usuario está autenticado
app.get('/api/auth/status', (req, res) => {
    console.log('[AUTH_STATUS] Verificando autenticación - isAuthenticated():', req.isAuthenticated());
    console.log('[AUTH_STATUS] Session ID:', req.sessionID);
    console.log('[AUTH_STATUS] User:', req.user);
    
    if (req.isAuthenticated()) {
        res.json({ 
            authenticated: true, 
            user: {
                id: req.user.id,
                email: req.user.email,
                username: req.user.username,
                displayName: req.user.display_name,
                avatar: req.user.avatar,
                balance: req.user.balance
            }
        });
    } else {
        res.json({ authenticated: false });
    }
});

// Ruta para cerrar sesión de Google
app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return res.status(500).json({ error: 'Error al cerrar sesión' });
        }
        res.redirect('/?logout=success');
    });
});

app.get('/api/balance', async (req, res) => {
    try {
        const sessionToken = req.headers.authorization?.replace('Bearer ', '');
        
        if (!sessionToken) {
            return res.status(401).json({ error: 'Token de sesión requerido' });
        }
        
        const user = await authRepository.verifySession(sessionToken);
        const balance = await authRepository.getUserBalance(user.id);
        res.json({ balance: balance });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

// Ruta para hacer una apuesta
app.post('/api/bet', async (req, res) => {
    try {
        const { betAmount } = req.body;
        let user = null;
        
        // Verificar autenticación: Google OAuth o sessionToken tradicional
        if (req.isAuthenticated()) {
            // Usuario autenticado con Google OAuth
            user = req.user;
            console.log('[BET] Usuario Google OAuth:', user.username, 'Balance:', user.balance);
        } else {
            // Usuario con sessionToken tradicional
            const sessionToken = req.headers.authorization?.replace('Bearer ', '');
            if (!sessionToken) {
                return res.status(401).json({ error: 'Usuario no autenticado' });
            }
            
            user = await authRepository.verifySession(sessionToken);
            console.log('[BET] Usuario tradicional:', user.username, 'Balance:', user.balance);
        }
        
        if (!betAmount || ![1, 2, 4].includes(betAmount)) {
            return res.status(400).json({ error: 'Apuesta debe ser $1, $2 o $4' });
        }
        
        console.log('[BET] Procesando apuesta de $', betAmount, 'para usuario:', user.username);
        const newBalance = await authRepository.deductBet(user.id, betAmount);
        console.log('[BET] Balance después de descontar apuesta:', newBalance);
        
        res.json({ 
            success: true, 
            betAmount: betAmount,
            newBalance: newBalance 
        });
    } catch (error) {
        console.error('[BET] Error procesando apuesta:', error);
        res.status(400).json({ error: error.message });
    }
});

// Ruta para actualizar balance al salir del juego
app.post('/api/updateBalance', async (req, res) => {
    try {
        const { amount } = req.body;
        let user = null;
        
        // Verificar autenticación: Google OAuth o sessionToken tradicional
        if (req.isAuthenticated()) {
            // Usuario autenticado con Google OAuth
            user = req.user;
            console.log('[UPDATE_BALANCE] Usuario Google OAuth:', user.username, 'Ganancia:', amount);
        } else {
            // Usuario con sessionToken tradicional
            const sessionToken = req.headers.authorization?.replace('Bearer ', '');
            if (!sessionToken) {
                return res.status(401).json({ error: 'Usuario no autenticado' });
            }
            
            user = await authRepository.verifySession(sessionToken);
            console.log('[UPDATE_BALANCE] Usuario tradicional:', user.username, 'Ganancia:', amount);
        }
        
        const newBalance = await authRepository.addWinnings(user.id, amount);
        console.log('[UPDATE_BALANCE] Nuevo balance:', newBalance);
        
        res.json({ 
            success: true, 
            newBalance: newBalance 
        });
    } catch (error) {
        console.error('[UPDATE_BALANCE] Error actualizando balance:', error);
        res.status(400).json({ error: error.message });
    }
});

// Rutas para el sistema de crecimiento
app.get('/api/growth-config', (req, res) => {
    try {
        const responseConfig = {
            ...config.growthSystem,
            globalEvents: config.globalEvents || {
                speedEvent: {
                    enabled: true,
                    interval: 300000, 	// 5 minutos
                    duration: 120000, 	// 2 minutos
                    speedMultiplier: 2.0,
                    warningTime: 60000, // 1 minuto
                    countdownAlerts: true,
                    countdownInterval: 60000
                },
                bombEvent: {
                    enabled: true,
                    interval: 300000, 	// 5 minutos
                    duration: 120000, 	// 2 minutos
                    warningTime: 60000, // 1 minuto
                    countdownAlerts: true,
                    countdownInterval: 60000,
                    bombCount: 15,
                    bombSpeed: 3.0,
                    bombSize: 20,
                    bombColor: "#ff0000"
                }
            }
        };
        res.json(responseConfig);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener la configuración' });
    }
});

app.post('/api/growth-config', (req, res) => {
    try {
        const newConfig = req.body;
        
        // Validar la configuración
        if (newConfig.baseGrowthFactor < 0.1 || newConfig.baseGrowthFactor > 10) {
            return res.status(400).json({ error: 'Factor de crecimiento base debe estar entre 0.1 y 10' });
        }
        
        if (newConfig.smallPlayerBonus.enabled) {
            if (newConfig.smallPlayerBonus.massThreshold < 1 || newConfig.smallPlayerBonus.massThreshold > 1000) {
                return res.status(400).json({ error: 'Umbral de masa para jugadores pequeños debe estar entre 1 y 1000' });
            }
            if (newConfig.smallPlayerBonus.multiplier < 1 || newConfig.smallPlayerBonus.multiplier > 10) {
                return res.status(400).json({ error: 'Multiplicador para jugadores pequeños debe estar entre 1 y 10' });
            }
        }
        
        if (newConfig.largePlayerPenalty.enabled) {
            if (newConfig.largePlayerPenalty.massThreshold < 1 || newConfig.largePlayerPenalty.massThreshold > 1000) {
                return res.status(400).json({ error: 'Umbral de masa para jugadores grandes debe estar entre 1 y 1000' });
            }
            if (newConfig.largePlayerPenalty.multiplier < 0.1 || newConfig.largePlayerPenalty.multiplier > 1) {
                return res.status(400).json({ error: 'Multiplicador para jugadores grandes debe estar entre 0.1 y 1' });
            }
        }
        
        if (newConfig.maxGrowthLimit.enabled) {
            if (newConfig.maxGrowthLimit.maxMass < 1 || newConfig.maxGrowthLimit.maxMass > 10000) {
                return res.status(400).json({ error: 'Masa máxima debe estar entre 1 y 10000' });
            }
            if (newConfig.maxGrowthLimit.reductionPercent < 1 || newConfig.maxGrowthLimit.reductionPercent > 100) {
                return res.status(400).json({ error: 'Porcentaje de reducción debe estar entre 1 y 100' });
            }
        }
        
        if (newConfig.autoCashout.enabled) {
            if (newConfig.autoCashout.activationMass < 1 || newConfig.autoCashout.activationMass > 10000) {
                return res.status(400).json({ error: 'Masa de activación debe estar entre 1 y 10000' });
            }
            if (newConfig.autoCashout.delay < 1000 || newConfig.autoCashout.delay > 30000) {
                return res.status(400).json({ error: 'Delay debe estar entre 1000 y 30000 ms' });
            }
        }
        
        // Validar configuración de poderes si existe
        if (newConfig.powers) {
            if (newConfig.powers.speedBoost && (newConfig.powers.speedBoost.duration < 1000 || newConfig.powers.speedBoost.duration > 300000)) {
                return res.status(400).json({ error: 'Duración de Uvas de Velocidad debe estar entre 1 y 300 segundos' });
            }
                         if (newConfig.powers.massBoost && (newConfig.powers.massBoost.duration < 1000 || newConfig.powers.massBoost.duration > 300000)) {
                return res.status(400).json({ error: 'Duración de Manzana Dorada debe estar entre 1 y 300 segundos' });
            }
            if (newConfig.powers.shield && (newConfig.powers.shield.duration < 1000 || newConfig.powers.shield.duration > 300000)) {
                return res.status(400).json({ error: 'Duración de Escudo Protector debe estar entre 1 y 300 segundos' });
            }
        }

        // Validar configuración de eventos globales si existe
        if (newConfig.globalEvents) {
            // Validar evento de velocidad
            if (newConfig.globalEvents.speedEvent) {
                const speedEvent = newConfig.globalEvents.speedEvent;
                if (speedEvent.enabled) {
                    if (speedEvent.interval < 60000 || speedEvent.interval > 3600000) {
                        return res.status(400).json({ error: 'Intervalo del evento de velocidad debe estar entre 1 y 60 minutos' });
                    }
                    if (speedEvent.duration < 60000 || speedEvent.duration > 600000) {
                        return res.status(400).json({ error: 'Duración del evento de velocidad debe estar entre 1 y 10 minutos' });
                    }
                    if (speedEvent.speedMultiplier < 1.1 || speedEvent.speedMultiplier > 5) {
                        return res.status(400).json({ error: 'Multiplicador de velocidad debe estar entre 1.1 y 5' });
                    }
                    if (speedEvent.warningTime < 60000 || speedEvent.warningTime > 300000) {
                        return res.status(400).json({ error: 'Tiempo de advertencia debe estar entre 1 y 5 minutos' });
                    }
                }
            }

            // Validar evento de bombas
            if (newConfig.globalEvents.bombEvent) {
                const bombEvent = newConfig.globalEvents.bombEvent;
                if (bombEvent.enabled) {
                    if (bombEvent.interval < 60000 || bombEvent.interval > 3600000) {
                        return res.status(400).json({ error: 'Intervalo del evento de bombas debe estar entre 1 y 60 minutos' });
                    }
                    if (bombEvent.duration < 60000 || bombEvent.duration > 600000) {
                        return res.status(400).json({ error: 'Duración del evento de bombas debe estar entre 1 y 10 minutos' });
                    }
                    if (bombEvent.warningTime < 60000 || bombEvent.warningTime > 300000) {
                        return res.status(400).json({ error: 'Tiempo de advertencia debe estar entre 1 y 5 minutos' });
                    }
                    if (bombEvent.bombCount < 5 || bombEvent.bombCount > 50) {
                        return res.status(400).json({ error: 'Cantidad de bombas debe estar entre 5 y 50' });
                    }
                    if (bombEvent.bombSpeed < 0.5 || bombEvent.bombSpeed > 10) {
                        return res.status(400).json({ error: 'Velocidad de bombas debe estar entre 0.5 y 10' });
                    }
                    if (bombEvent.bombSize < 10 || bombEvent.bombSize > 50) {
                        return res.status(400).json({ error: 'Tamaño de bombas debe estar entre 10 y 50 píxeles' });
                    }
                }
            }
        }
        
        // Actualizar la configuración
        config.growthSystem = newConfig;
        
        // Actualizar configuración de eventos globales si existe
        if (newConfig.globalEvents) {
            config.globalEvents = newConfig.globalEvents;
            
            // Reinicializar el gestor de bombas si la configuración cambió
            if (config.globalEvents.bombEvent && config.globalEvents.bombEvent.enabled) {
                if (bombManager) {
                    bombManager = new BombManager(config.globalEvents.bombEvent);
                    console.log('[BOMB_EVENT] Gestor de bombas reinicializado con nueva configuración');
                }
            }
            
            // Reiniciar eventos si están activos
            if (speedEventActive) {
                console.log('[SPEED_EVENT] Configuración actualizada - evento activo se mantendrá hasta el próximo ciclo');
            }
            if (bombEventActive) {
                console.log('[BOMB_EVENT] Configuración actualizada - evento activo se mantendrá hasta el próximo ciclo');
            }
        }
        
        console.log('[GROWTH] Configuración actualizada:', newConfig);
        res.json({ success: true, message: 'Configuración actualizada correctamente' });
    } catch (error) {
        console.error('[GROWTH] Error actualizando configuración:', error);
        res.status(500).json({ error: 'Error al actualizar la configuración' });
    }
});

// Ruta para desconexión voluntaria con penalización
app.post('/api/voluntaryDisconnect', async (req, res) => {
    try {
        const sessionToken = req.headers.authorization?.replace('Bearer ', '');
        const { betAmount } = req.body;
        
        console.log('[API] /api/voluntaryDisconnect recibido');
        console.log('[API] Dinero en juego (betAmount):', betAmount);
        
        let user = null;
        
        // Verificar autenticación (soporta tanto sessionToken como Google OAuth)
        if (sessionToken) {
            // Autenticación tradicional
            user = await authRepository.verifySession(sessionToken);
        } else if (req.isAuthenticated()) {
            // Google OAuth
            user = req.user;
        } else {
            return res.status(401).json({ error: 'Autenticación requerida' });
        }
        console.log('[API] Usuario encontrado:', user.username, 'Balance actual:', user.balance);
        
        const originalBet = req.body.originalBetAmount || 1; 
        let returnedAmount = 0;
        let finalBalance = user.balance;

        console.log('[API] === LÓGICA DE CASHOUT SIMPLIFICADA ===');
        console.log('[API] Apuesta original:', originalBet);
        console.log('[API] Dinero en juego:', betAmount);

        // Lógica de cashout simplificada según tus reglas
        if (betAmount === originalBet) {
            // EMPATE: No se cambia el balance, pero se devuelve la apuesta original al jugador.
            console.log('[API] EMPATE - Balance sin cambios. Devolviendo apuesta original.');
            returnedAmount = originalBet;
            
        } else if (betAmount < originalBet) {
            // PÉRDIDA: Se devuelve solo lo que tiene en juego.
            console.log('[API] PÉRDIDA - Devolviendo solo lo que tiene en juego.');
            returnedAmount = betAmount;
            
        } else if (betAmount > originalBet) {
            // GANANCIA: Se aplica 10% de comisión y se devuelve el resto.
            console.log('[API] GANANCIA - Aplicando comisión del 10%.');
            const winnings = betAmount - originalBet;
            const commission = Math.round(winnings * 0.1 * 100) / 100;
            const netWinnings = winnings - commission;
            returnedAmount = originalBet + netWinnings;
            
            console.log(`[API] Ganancia neta: $${winnings} | Comisión (10%): $${commission} | Ganancia neta final: $${netWinnings}`);
        }
        
        if (returnedAmount > 0) {
            finalBalance = await authRepository.addWinnings(user.id, returnedAmount);
        }
        
        console.log('[API] Respuesta final - Devolviendo:', returnedAmount, 'Nuevo balance:', finalBalance);
        
        res.json({ 
            success: true, 
            returned: returnedAmount,
            newBalance: finalBalance 
        });
    } catch (error) {
        console.error('[API] Error en /api/voluntaryDisconnect:', error);
        res.status(400).json({ error: error.message });
    }
});



// Limpiar sesiones expiradas cada hora
setInterval(async () => {
    try {
        await authRepository.cleanupExpiredSessions();
    } catch (error) {
        console.error('Error limpiando sesiones expiradas:', error);
    }
}, 60 * 60 * 1000);

io.on('connection', function (socket) {
    let type = socket.handshake.query.type;
    console.log('User has connected: ', type);
    switch (type) {
        case 'player':
            addPlayer(socket);
            break;
        case 'spectator':
            addSpectator(socket);
            break;
        default:
            console.log('Unknown user type, not doing anything.');
    }
});

function generateSpawnpoint() {
    let radius = util.massToRadius(config.defaultPlayerMass);
    return getPosition(config.newPlayerInitialPosition === 'farthest', radius, map.players.data, redZone)
}


const addPlayer = (socket) => {
    var currentPlayer = new mapUtils.playerUtils.Player(socket.id);
    var playerUserId = null; // Para rastrear el usuario autenticado
    var playerBetAmount = 0; // Cantidad apostada por el jugador

    socket.on('gotit', function (clientPlayerData) {
        console.log('[INFO] Player ' + clientPlayerData.name + ' connecting!');
        currentPlayer.init(generateSpawnpoint(), config.defaultPlayerMass);

        if (map.players.findIndexByID(socket.id) > -1) {
            console.log('[INFO] Player ID is already connected, kicking.');
            socket.disconnect();
        } else if (!util.validNick(clientPlayerData.name)) {
            socket.emit('kick', 'Invalid username.');
            socket.disconnect();
        } else {
            console.log('[INFO] Player ' + clientPlayerData.name + ' connected!');
            sockets[socket.id] = socket;

            const sanitizedName = clientPlayerData.name.replace(/(<([^>]+)>)/ig, '');
            clientPlayerData.name = sanitizedName;

            // Guardar información del usuario y apuesta
            playerUserId = clientPlayerData.userId;
            playerUserIds[socket.id] = clientPlayerData.userId; // Guardar en el mapeo global
            playerBetAmount = clientPlayerData.betAmount || 0;

            // Agregar el dinero al jugador
            currentPlayer.gameMoney = playerBetAmount;
            currentPlayer.originalBetAmount = playerBetAmount; // Guardar apuesta original
            
            // Asignar el dinero a la primera célula también
            if (currentPlayer.cells.length > 0) {
                currentPlayer.cells[0].gameMoney = playerBetAmount;
                console.log(`[PLAYER_INIT] ${currentPlayer.name} inicializado con $${playerBetAmount} - Apuesta original: $${currentPlayer.originalBetAmount} - Asignado a primera célula`);
            } else {
                console.log(`[PLAYER_INIT] ${currentPlayer.name} inicializado con $${playerBetAmount} - Sin células para asignar`);
            }

            currentPlayer.clientProvidedData(clientPlayerData);
            
            map.players.pushNew(currentPlayer);
            
            // Enviar notificación de escudo protector al jugador
            socket.emit('shieldActivated', {
                duration: 15,
                message: '¡Escudo protector activado por 15 segundos!'
            });
            
            io.emit('playerJoin', { name: currentPlayer.name });
            console.log(`[BET] Player ${currentPlayer.name} joined with $${playerBetAmount}`);
            console.log('Total players: ' + map.players.data.length);
        }

    });

    socket.on('pingcheck', () => {
        socket.emit('pongcheck');
    });

    socket.on('windowResized', (data) => {
        currentPlayer.screenWidth = data.screenWidth;
        currentPlayer.screenHeight = data.screenHeight;
    });

    socket.on('respawn', () => {
        map.players.removePlayerByID(currentPlayer.id);
        socket.emit('welcome', currentPlayer, {
            width: config.gameWidth,
            height: config.gameHeight
        });
        console.log('[INFO] User ' + currentPlayer.name + ' has respawned');
    });

    socket.on('disconnect', () => {
        // Limpiar el mapeo de userId cuando el jugador se desconecta
        if (playerUserIds[socket.id]) {
            delete playerUserIds[socket.id];
        }

        map.players.removePlayerByID(currentPlayer.id);
        console.log('[INFO] User ' + currentPlayer.name + ' has disconnected');
        socket.broadcast.emit('playerDisconnect', { name: currentPlayer.name });
    });

    socket.on('playerChat', (data) => {
        var _sender = data.sender.replace(/(<([^>]+)>)/ig, '');
        var _message = data.message.replace(/(<([^>]+)>)/ig, '');

        if (config.logChat === 1) {
            console.log('[CHAT] [' + (new Date()).getHours() + ':' + (new Date()).getMinutes() + '] ' + _sender + ': ' + _message);
        }

        socket.broadcast.emit('serverSendPlayerChat', {
            sender: currentPlayer.name,
            message: _message.substring(0, 35)
        });

        chatRepository.logChatMessage(_sender, _message, currentPlayer.ipAddress)
            .catch((err) => console.error("Error when attempting to log chat message", err));
    });

    socket.on('pass', async (data) => {
        const password = data[0];
        if (password === config.adminPass) {
            console.log('[ADMIN] ' + currentPlayer.name + ' just logged in as an admin.');
            socket.emit('serverMSG', 'Welcome back ' + currentPlayer.name);
            socket.broadcast.emit('serverMSG', currentPlayer.name + ' just logged in as an admin.');
            currentPlayer.admin = true;
        } else {
            console.log('[ADMIN] ' + currentPlayer.name + ' attempted to log in with the incorrect password: ' + password);

            socket.emit('serverMSG', 'Password incorrect, attempt logged.');

            loggingRepositry.logFailedLoginAttempt(currentPlayer.name, currentPlayer.ipAddress)
                .catch((err) => console.error("Error when attempting to log failed login attempt", err));
        }
    });

    socket.on('kick', (data) => {
        if (!currentPlayer.admin) {
            socket.emit('serverMSG', 'You are not permitted to use this command.');
            return;
        }

        var reason = '';
        var worked = false;
        for (let playerIndex in map.players.data) {
            let player = map.players.data[playerIndex];
            if (player.name === data[0] && !player.admin && !worked) {
                if (data.length > 1) {
                    for (var f = 1; f < data.length; f++) {
                        if (f === data.length) {
                            reason = reason + data[f];
                        }
                        else {
                            reason = reason + data[f] + ' ';
                        }
                    }
                }
                if (reason !== '') {
                    console.log('[ADMIN] User ' + player.name + ' kicked successfully by ' + currentPlayer.name + ' for reason ' + reason);
                }
                else {
                    console.log('[ADMIN] User ' + player.name + ' kicked successfully by ' + currentPlayer.name);
                }
                socket.emit('serverMSG', 'User ' + player.name + ' was kicked by ' + currentPlayer.name);
                sockets[player.id].emit('kick', reason);
                sockets[player.id].disconnect();
                map.players.removePlayerByIndex(playerIndex);
                worked = true;
            }
        }
        if (!worked) {
            socket.emit('serverMSG', 'Could not locate user or user is an admin.');
        }
    });

    // Heartbeat function, update everytime.
    socket.on('0', (target) => {
        currentPlayer.lastHeartbeat = new Date().getTime();
        if (target.x !== currentPlayer.x || target.y !== currentPlayer.y) {
            currentPlayer.target = target;
        }
    });

    socket.on('1', function () {
        // Fire food.
        const minCellMass = config.defaultPlayerMass + config.fireFood;
        for (let i = 0; i < currentPlayer.cells.length; i++) {
            if (currentPlayer.cells[i].mass >= minCellMass) {
                currentPlayer.changeCellMass(i, -config.fireFood);
                map.massFood.addNew(currentPlayer, i, config.fireFood);
            }
        }
    });

    socket.on('2', () => {
        currentPlayer.userSplit(config.limitSplit, config.defaultPlayerMass);
    });

    // Manejar división por virus
    socket.on('virusSplit', () => {
        if (currentPlayer.gameMoney > 0) {
            // Dividir el dinero entre las células
            const cellCount = currentPlayer.cells.length;
            const moneyPerCell = Math.floor(currentPlayer.gameMoney / cellCount);
            const remainder = currentPlayer.gameMoney % cellCount;
            
            // Asignar dinero a cada célula
            for (let i = 0; i < currentPlayer.cells.length; i++) {
                if (!currentPlayer.cells[i].gameMoney) {
                    currentPlayer.cells[i].gameMoney = 0;
                }
                currentPlayer.cells[i].gameMoney = moneyPerCell + (i < remainder ? 1 : 0);
            }
            
            console.log(`[VIRUS] ${currentPlayer.name} dividió $${currentPlayer.gameMoney} entre ${cellCount} células`);
        }
    });
}

const addSpectator = (socket) => {
    socket.on('gotit', function () {
        sockets[socket.id] = socket;
        spectators.push(socket.id);
        io.emit('playerJoin', { name: '' });
    });

    socket.emit("welcome", {}, {
        width: config.gameWidth,
        height: config.gameHeight
    });
}

const tickPlayer = (currentPlayer) => {
    if (currentPlayer.lastHeartbeat < new Date().getTime() - config.maxHeartbeatInterval) {
        sockets[currentPlayer.id].emit('kick', 'Last heartbeat received over ' + config.maxHeartbeatInterval + ' ago.');
        sockets[currentPlayer.id].disconnect();
    }

    // Aplicar multiplicador de velocidad global si el evento está activo
    const globalSpeedMultiplier = speedEventActive ? config.globalEvents.speedEvent.speedMultiplier : 1.0;
    currentPlayer.move(config.slowBase, config.gameWidth, config.gameHeight, INIT_MASS_LOG, globalSpeedMultiplier, redZone);
    
    // Aplicar daño de la zona roja (solo si está habilitada)
    if (config.redZone.enabled) {
        const deltaTime = 1 / 60; // 60 FPS
        const tookDamage = redZone.applyDamage(currentPlayer, deltaTime);
        
        // Notificar al cliente si recibió daño
        if (tookDamage) {
            sockets[currentPlayer.id].emit('redZoneDamage');
        }
    }

    // Aplicar sistema de crecimiento dinámico
    applyGrowthSystem(currentPlayer);
    
    // Verificar colisiones con bombas si el evento está activo
    if (bombManager && bombEventActive) {
        const bombCollision = bombManager.checkCollision(currentPlayer);
        if (bombCollision) {
            // Dividir al jugador como si fuera un virus
            const cellIndexes = [bombCollision.playerIndex];
            currentPlayer.virusSplit(cellIndexes, config.limitSplit, config.defaultPlayerMass);
            
            // Notificar al cliente sobre la colisión con bomba
            if (sockets[currentPlayer.id]) {
                sockets[currentPlayer.id].emit('bombCollision', {
                    cellIndex: bombCollision.playerIndex
                });
            }
        }
    }

    const isEntityInsideCircle = (point, circle) => {
        return SAT.pointInCircle(new Vector(point.x, point.y), circle);
    };

    const canEatMass = (cell, cellCircle, cellIndex, mass) => {
        if (isEntityInsideCircle(mass, cellCircle)) {
            if (mass.id === currentPlayer.id && mass.speed > 0 && cellIndex === mass.num)
                return false;
            if (cell.mass > mass.mass * 1.1)
                return true;
        }

        return false;
    };

    const canEatVirus = (cell, cellCircle, virus) => {
        const isInside = isEntityInsideCircle(virus, cellCircle);
        const canEat = cell.mass > virus.mass && isInside;
        if (cell.mass > virus.mass && Math.hypot(cell.x - virus.x, cell.y - virus.y) < (cell.radius + virus.radius + 10)) {
            console.log(`[VIRUS_CHECK] ${cell.mass} > ${virus.mass} = ${cell.mass > virus.mass}, isInside = ${isInside}, canEat = ${canEat}`);
        }
        return canEat;
    }

    const cellsToSplit = [];
    for (let cellIndex = 0; cellIndex < currentPlayer.cells.length; cellIndex++) {
        const currentCell = currentPlayer.cells[cellIndex];

        const cellCircle = currentCell.toCircle();

        const eatenFoodIndexes = util.getIndexes(map.food.data, food => isEntityInsideCircle(food, cellCircle));
        const eatenMassIndexes = util.getIndexes(map.massFood.data, mass => canEatMass(currentCell, cellCircle, cellIndex, mass));
        const eatenVirusIndexes = util.getIndexes(map.viruses.data, virus => canEatVirus(currentCell, cellCircle, virus));
        const eatenPowerFoodIndexes = util.getIndexes(map.powerFood.data, powerFood => isEntityInsideCircle(powerFood, cellCircle));

        // Debug: verificar si hay virus cerca
        if (map.viruses.data.length > 0) {
            const nearbyViruses = map.viruses.data.filter(virus => {
                const distance = Math.hypot(currentCell.x - virus.x, currentCell.y - virus.y);
                return distance < (currentCell.radius + virus.radius + 50); // 50px de margen
            });
            if (nearbyViruses.length > 0) {
                console.log(`[VIRUS_DEBUG] ${currentPlayer.name} - Célula ${cellIndex} cerca de ${nearbyViruses.length} virus`);
                nearbyViruses.forEach(virus => {
                    const distance = Math.hypot(currentCell.x - virus.x, currentCell.y - virus.y);
                    const canTrigger = currentCell.mass > virus.mass ? "SÍ puede dividirse" : "NO puede dividirse";
                    console.log(`[VIRUS_DEBUG] Virus en (${virus.x.toFixed(0)}, ${virus.y.toFixed(0)}) - Distancia: ${distance.toFixed(0)} - Masa virus: ${virus.mass} - Masa célula: ${currentCell.mass} - ${canTrigger}`);
                });
            }
        }

        if (eatenVirusIndexes.length > 0) {
            console.log(`[VIRUS_DETECTION] ${currentPlayer.name} - Célula ${cellIndex} (masa: ${currentCell.mass}) chocó con virus`);
            cellsToSplit.push(cellIndex);
            map.viruses.delete(eatenVirusIndexes);
        }

        let massGained = eatenMassIndexes.reduce((acc, index) => acc + map.massFood.data[index].mass, 0);

        map.food.delete(eatenFoodIndexes);
        map.massFood.remove(eatenMassIndexes);
        massGained += (eatenFoodIndexes.length * config.foodMass);
        
        // Procesar frutas de poder
        if (eatenPowerFoodIndexes.length > 0) {
            for (let index of eatenPowerFoodIndexes) {
                const powerFood = map.powerFood.data[index];
                if (powerFood && powerFood.isPowerFood) {
                    // Activar el poder en la célula
                    currentCell.activatePower(powerFood.powerType, powerFood.duration, powerFood.multiplier);
                    
                    // Notificar al cliente sobre el poder activado
                    if (sockets[currentPlayer.id]) {
                        sockets[currentPlayer.id].emit('powerActivated', {
                            powerType: powerFood.powerType,
                            name: powerFood.name,
                            duration: powerFood.duration,
                            multiplier: powerFood.multiplier
                        });
                    }
                    
                    console.log(`[POWER] ${currentPlayer.name} comió ${powerFood.name} - ${powerFood.powerType} activado`);
                }
            }
            map.powerFood.delete(eatenPowerFoodIndexes);
        }
        
        // Aplicar multiplicadores de crecimiento
        massGained = applyGrowthMultipliers(currentPlayer, massGained);
        
        // Aplicar multiplicador de masa si está activo
        const massMultiplier = currentCell.getMassMultiplier();
        if (massMultiplier > 1) {
            const originalMassGained = massGained;
            massGained *= massMultiplier;
            console.log(`[POWER] ${currentPlayer.name} ganó masa con multiplicador x${massMultiplier}: ${originalMassGained} -> ${massGained}`);
        }
        
        currentPlayer.changeCellMass(cellIndex, massGained);
    }
    
    if (cellsToSplit.length > 0) {
        console.log(`[VIRUS_SPLIT_CALL] ${currentPlayer.name} - Células a dividir: [${cellsToSplit.join(', ')}]`);
    }
    
    currentPlayer.virusSplit(cellsToSplit, config.limitSplit, config.defaultPlayerMass);
    
    // Notificar al cliente sobre la colisión con virus DESPUÉS de la división
    if (cellsToSplit.length > 0) {
        console.log(`[VIRUS_CELLS_UPDATE] Player ID: ${currentPlayer.id}, Socket existe: ${!!sockets[currentPlayer.id]}`);
        
        // Marcar células como recién divididas para forzar actualización
        currentPlayer.cells.forEach((cell, index) => {
            cell._justDivided = true;
            console.log(`[VIRUS_CELLS_UPDATE] Célula ${index}: $${cell.gameMoney || 0} marcada como dividida`);
        });
        
        if (sockets[currentPlayer.id]) {
            // Enviar información actualizada de las células con el dinero dividido
            const cellsData = currentPlayer.cells.map((cell, index) => ({
                index: index,
                x: cell.x,
                y: cell.y,
                mass: cell.mass,
                radius: cell.radius,
                gameMoney: cell.gameMoney || 0
            }));
            
            sockets[currentPlayer.id].emit('virusCollision', {
                cells: cellsData,
                totalMoney: currentPlayer.getTotalMoney()
            });
            console.log(`[VIRUS_CELLS_UPDATE] Evento virusCollision enviado correctamente`);
        } else {
            console.log(`[VIRUS_CELLS_UPDATE] ERROR: No se encontró el socket para el jugador ${currentPlayer.id}`);
        }
    }
};

const tickGame = () => {
    map.players.data.forEach(tickPlayer);
    map.massFood.move(config.gameWidth, config.gameHeight);
    
    // Actualizar posición de las bombas si el evento está activo
    if (bombManager && bombEventActive) {
        bombManager.update(config.gameWidth, config.gameHeight);
    }

    map.players.handleCollisions(async function (gotEaten, eater) {
        const cellGotEaten = map.players.getCell(gotEaten.playerIndex, gotEaten.cellIndex);
        const eaterPlayer = map.players.data[eater.playerIndex];
        const eatenPlayer = map.players.data[gotEaten.playerIndex];

        // Verificar si la célula está protegida
        if (cellGotEaten.isCurrentlyProtected()) {
            console.log(`[PROTECTION] ${eatenPlayer.name} está protegido, no puede ser comido`);
            return; // No hacer nada si está protegido
        }

        // Verificar si la célula tiene escudo activo
        if (cellGotEaten.hasShield()) {
            console.log(`[SHIELD] ${eatenPlayer.name} tiene escudo activo, no puede ser comido`);
            return; // No hacer nada si tiene escudo
        }

        // Transferir dinero basado en la apuesta original (25% del monto inicial)
        const originalBet = eatenPlayer.originalBetAmount || 0;
        if (originalBet > 0) {
            // Verificar cuánto dinero ya se ha perdido y cuánto queda disponible para ganar
            const alreadyLost = eatenPlayer.moneyLostToOthers || 0;
            const maxAvailableToGain = originalBet - alreadyLost;
            
            // Calcular 25% de la apuesta original, pero limitado a lo que realmente queda disponible
            const idealGain = Math.round(originalBet * 0.25 * 100) / 100;
            const actualGain = Math.min(idealGain, maxAvailableToGain);
            
            if (actualGain > 0) {
                // Asignar el dinero ganado a la primera célula del jugador que come
                if (eaterPlayer.cells.length > 0) {
                    if (!eaterPlayer.cells[0].gameMoney) {
                        eaterPlayer.cells[0].gameMoney = 0;
                    }
                    eaterPlayer.cells[0].gameMoney += actualGain;
                }
                
                // Actualizar el registro de dinero perdido por el jugador comido
                eatenPlayer.moneyLostToOthers = (eatenPlayer.moneyLostToOthers || 0) + actualGain;
                
                console.log(`[BET] ${eaterPlayer.name} ate ${eatenPlayer.name} and gained $${actualGain}`);
                console.log(`[BET] ${eatenPlayer.name} total lost to others: $${eatenPlayer.moneyLostToOthers}/$${originalBet}`);
                
                // El jugador comido pierde el dinero ganado por el eater
                const totalPlayerMoney = eatenPlayer.getTotalMoney();
                const moneyLost = Math.min(actualGain, totalPlayerMoney); // No puede perder más de lo que tiene
                const remainingMoney = Math.max(0, totalPlayerMoney - moneyLost);
                
                // NUEVA LÓGICA: Si la célula comida ya fue dividida, su valor específico se pierde
                if (cellGotEaten.hasBeenSplit) {
                    console.log(`[BET] Célula dividida comida - valor específico perdido: $${cellGotEaten.gameMoney}`);
                    cellGotEaten.gameMoney = 0; // La célula dividida pierde su valor específico
                    
                    // ACTIVAR PROTECCIÓN EN LAS OTRAS CÉLULAS DEL JUGADOR
                    console.log(`[PROTECTION] Activando protección de 15 segundos en todas las células de ${eatenPlayer.name}`);
                    for (let cell of eatenPlayer.cells) {
                        if (cell !== cellGotEaten) { // No proteger la célula que fue comida
                            cell.activateProtection(15000); // 15 segundos de protección
                        }
                    }
                } else {
                    // Asignar el dinero restante a la célula que será dividida
                    cellGotEaten.gameMoney = remainingMoney;
                }
                console.log(`[BET] ${eatenPlayer.name} lost $${moneyLost}, remaining total money: $${remainingMoney}`);
                
                // Notificar al jugador que ganó dinero
                if (sockets[eaterPlayer.id]) {
                    sockets[eaterPlayer.id].emit('moneyGained', { amount: actualGain });
                }
                
                // Notificar al jugador que perdió dinero
                if (sockets[eatenPlayer.id]) {
                    sockets[eatenPlayer.id].emit('moneyLost', { amount: moneyLost });
                }
            } else {
                console.log(`[BET] ${eaterPlayer.name} ate ${eatenPlayer.name} but no money gained - player already lost all $${originalBet}`);
                // El jugador comido aún pierde masa pero no dinero
                if (cellGotEaten.hasBeenSplit) {
                    console.log(`[BET] Célula dividida comida sin ganancia - valor específico perdido: $${cellGotEaten.gameMoney}`);
                    cellGotEaten.gameMoney = 0; // La célula dividida pierde su valor específico
                    
                    // ACTIVAR PROTECCIÓN EN LAS OTRAS CÉLULAS DEL JUGADOR
                    console.log(`[PROTECTION] Activando protección de 15 segundos en todas las células de ${eatenPlayer.name} (sin ganancia)`);
                    for (let cell of eatenPlayer.cells) {
                        if (cell !== cellGotEaten) { // No proteger la célula que fue comida
                            cell.activateProtection(15000); // 15 segundos de protección
                        }
                    }
                } else {
                    cellGotEaten.gameMoney = eatenPlayer.getTotalMoney();
                }
            }
        }

        eaterPlayer.changeCellMass(eater.cellIndex, cellGotEaten.mass);

        // DEBUG: Mostrar el estado de todas las células antes de verificar GAME OVER
        console.log(`[DEBUG] Estado de células de ${eatenPlayer.name} antes de verificar GAME OVER:`);
        for (let i = 0; i < eatenPlayer.cells.length; i++) {
            const cell = eatenPlayer.cells[i];
            console.log(`[DEBUG] Célula ${i}: $${cell.gameMoney || 0} (dividida: ${cell.hasBeenSplit})`);
        }

        // Verificar si el jugador se quedó sin dinero (GAME OVER)
        const finalPlayerMoney = eatenPlayer.getTotalMoney();
        console.log(`[DEBUG] Dinero total calculado: $${finalPlayerMoney}`);
        
        // NUEVA LÓGICA: Verificar si el jugador tiene dinero real (no solo células divididas con $0)
        let hasRealMoney = false;
        let totalRealMoney = 0;
        
        for (let cell of eatenPlayer.cells) {
            if (cell.gameMoney > 0) {
                hasRealMoney = true;
                totalRealMoney += cell.gameMoney;
            }
        }
        
        console.log(`[DEBUG] Tiene dinero real: ${hasRealMoney}, dinero real total: $${totalRealMoney}`);
        
        // GAME OVER solo si no tiene dinero real O si el dinero real es menor a $0.05
        if (!hasRealMoney || totalRealMoney < 0.05) {
            // GAME OVER - El jugador perdió todo su dinero
            console.log(`[GAME_OVER] ${eatenPlayer.name} se quedó sin dinero ($${finalPlayerMoney}) - GAME OVER`);
            
            // Devolver cualquier dinero restante al balance del usuario
            if (finalPlayerMoney > 0) {
                const eatenPlayerUserId = playerUserIds[eatenPlayer.id];
                
                if (eatenPlayerUserId) {
                    try {
                        const newBalance = await authRepository.addWinnings(eatenPlayerUserId, finalPlayerMoney);
                        console.log(`[GAME_OVER] Devueltos $${finalPlayerMoney} al balance de ${eatenPlayer.name}. Nuevo balance: $${newBalance}`);
                    } catch (error) {
                        console.error(`[GAME_OVER] Error devolviendo dinero a ${eatenPlayer.name}:`, error);
                    }
                } else {
                    console.log(`[GAME_OVER] No se pudo encontrar userId para ${eatenPlayer.name} (${eatenPlayer.id})`);
                }
            }
            
            // Notificar al jugador que perdió
            if (sockets[eatenPlayer.id]) {
                sockets[eatenPlayer.id].emit('gameOver', {
                    message: '¡Perdiste! Te quedaste sin dinero. Regresando al lobby...',
                    finalMoney: finalPlayerMoney
                });
            }
            
            // Notificar a todos los jugadores
            io.emit('playerDied', { name: eatenPlayer.name });
            
            // Limpiar el mapeo de userId
            if (playerUserIds[eatenPlayer.id]) {
                delete playerUserIds[eatenPlayer.id];
            }
            
            // Remover al jugador del juego
            map.players.removePlayerByIndex(gotEaten.playerIndex);
            return; // Salir de la función sin dividir al jugador
        }

        // NUEVO SISTEMA: Dividir el jugador comido en lugar de eliminarlo
        const playerSurvived = eatenPlayer.splitWhenEaten(gotEaten.cellIndex, config.defaultPlayerMass);
        
        if (playerSurvived) {
            // El jugador sobrevivió, notificar al cliente
            console.log(`[SURVIVAL] ${eatenPlayer.name} sobrevivió siendo dividido en 4 partes`);
            
            if (sockets[eatenPlayer.id]) {
                // Enviar información de las nuevas células con protección
                const cellsData = eatenPlayer.cells.map((cell, index) => ({
                    index: index,
                    x: cell.x,
                    y: cell.y,
                    mass: cell.mass,
                    radius: cell.radius,
                    gameMoney: cell.gameMoney || 0,
                    isProtected: cell.isCurrentlyProtected(),
                    protectionTimeLeft: cell.getProtectionTimeLeft()
                }));
                
                sockets[eatenPlayer.id].emit('playerSurvived', {
                    cells: cellsData,
                    totalMoney: eatenPlayer.getTotalMoney(),
                    message: '¡Sobreviviste! Tienes 15 segundos de protección para escapar.'
                });
            }
            
            // Notificar a todos los jugadores
            io.emit('playerSurvived', { 
                name: eatenPlayer.name,
                message: `${eatenPlayer.name} sobrevivió siendo dividido en 4 partes!`
            });
        } else {
            // El jugador murió completamente
            let playerGotEaten = map.players.data[gotEaten.playerIndex];
            io.emit('playerDied', { name: playerGotEaten.name });
            sockets[playerGotEaten.id].emit('RIP');
            map.players.removePlayerByIndex(gotEaten.playerIndex);
        }
    });

};

const calculateLeaderboard = () => {
    const topPlayers = map.players.getTopPlayers();

    if (leaderboard.length !== topPlayers.length) {
        leaderboard = topPlayers;
        leaderboardChanged = true;
    } else {
        for (let i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].id !== topPlayers[i].id) {
                leaderboard = topPlayers;
                leaderboardChanged = true;
                break;
            }
        }
    }
}

const gameloop = () => {
    if (map.players.data.length > 0) {
        calculateLeaderboard();
        map.players.shrinkCells(config.massLossRate, config.defaultPlayerMass, config.minMassLoss);
        
        // Actualizar la zona roja basada en el número de jugadores (solo si está habilitada)
        if (config.redZone.enabled) {
            const playerCount = map.players.data.length;
            redZone.update(playerCount);
            
            // Log solo cuando cambia el número de jugadores
            if (redZone.lastPlayerCount !== playerCount) {
                console.log(`[REDZONE] Jugadores: ${playerCount} | Radio: ${redZone.radius.toFixed(0)}`);
                redZone.lastPlayerCount = playerCount;
            }
        }
    }

    map.balanceMass(config.foodMass, config.gameMass, config.maxFood, config.maxVirus);
};

const sendUpdates = () => {
    spectators.forEach(updateSpectator);
    map.enumerateWhatPlayersSee(function (playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses, visiblePowerFood) {
        // Obtener bombas visibles si el evento está activo
        let visibleBombs = [];
        if (bombManager && bombEventActive) {
            visibleBombs = bombManager.getBombs();
        }
        
        sockets[playerData.id].emit('serverTellPlayerMove', playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses, visiblePowerFood, visibleBombs);
        
        // Enviar información de la zona roja (solo si está habilitada)
        if (config.redZone.enabled) {
            sockets[playerData.id].emit('redZoneUpdate', redZone.getZoneInfo());
        }
        
        if (leaderboardChanged) {
            sendLeaderboard(sockets[playerData.id]);
        }
    });

    leaderboardChanged = false;
};

const sendLeaderboard = (socket) => {
    socket.emit('leaderboard', {
        players: map.players.data.length,
        leaderboard
    });
}
const updateSpectator = (socketID) => {
    let playerData = {
        x: config.gameWidth / 2,
        y: config.gameHeight / 2,
        cells: [],
        massTotal: 0,
        hue: 100,
        id: socketID,
        name: ''
    };
    // Obtener bombas visibles si el evento está activo
    let visibleBombs = [];
    if (bombManager && bombEventActive) {
        visibleBombs = bombManager.getBombs();
    }
    
    sockets[socketID].emit('serverTellPlayerMove', playerData, map.players.data, map.food.data, map.massFood.data, map.viruses.data, visibleBombs);
    if (leaderboardChanged) {
        sendLeaderboard(sockets[socketID]);
    }
}

// Funciones del sistema de crecimiento
function applyGrowthSystem(currentPlayer) {
    const growthConfig = config.growthSystem;
    
    // Verificar límite máximo de crecimiento
    if (growthConfig.maxGrowthLimit.enabled) {
        const totalMass = currentPlayer.massTotal;
        if (totalMass >= growthConfig.maxGrowthLimit.maxMass) {
            // Aplicar reducción de masa
            const reductionAmount = totalMass * (growthConfig.maxGrowthLimit.reductionPercent / 100);
            currentPlayer.changeCellMass(0, -reductionAmount);
            
            // Verificar cash out automático
            if (growthConfig.autoCashout.enabled && totalMass >= growthConfig.autoCashout.activationMass) {
                triggerAutoCashout(currentPlayer);
            }
        }
    }
}

function applyGrowthMultipliers(currentPlayer, massGained) {
    const growthConfig = config.growthSystem;
    let finalMassGained = massGained * growthConfig.baseGrowthFactor;
    
    const totalMass = currentPlayer.massTotal;
    
    // Bonus para jugadores pequeños
    if (growthConfig.smallPlayerBonus.enabled && totalMass < growthConfig.smallPlayerBonus.massThreshold) {
        finalMassGained *= growthConfig.smallPlayerBonus.multiplier;
        // Comentado para evitar spam en logs
        // console.log(`[GROWTH] ${currentPlayer.name} (${totalMass} mass) - Bonus aplicado: x${growthConfig.smallPlayerBonus.multiplier}`);
    }
    
    // Penalización para jugadores grandes
    if (growthConfig.largePlayerPenalty.enabled && totalMass > growthConfig.largePlayerPenalty.massThreshold) {
        finalMassGained *= growthConfig.largePlayerPenalty.multiplier;
        // Comentado para evitar spam en logs
        // console.log(`[GROWTH] ${currentPlayer.name} (${totalMass} mass) - Penalización aplicada: x${growthConfig.largePlayerPenalty.multiplier}`);
    }
    
    return Math.round(finalMassGained);
}

function triggerAutoCashout(currentPlayer) {
    const growthConfig = config.growthSystem;
    
    // Evitar múltiples cash outs automáticos
    if (currentPlayer.autoCashoutTriggered) return;
    
    currentPlayer.autoCashoutTriggered = true;
    
    console.log(`[AUTO-CASHOUT] ${currentPlayer.name} alcanzó masa de activación (${currentPlayer.massTotal})`);
    
    // Notificar al cliente sobre el cash out automático
    if (sockets[currentPlayer.id]) {
        sockets[currentPlayer.id].emit('autoCashoutWarning', {
            delay: growthConfig.autoCashout.delay,
            mass: currentPlayer.massTotal
        });
    }
    
    // Programar el cash out automático
    setTimeout(() => {
        if (sockets[currentPlayer.id] && currentPlayer.gameMoney > 0) {
            console.log(`[AUTO-CASHOUT] Ejecutando cash out automático para ${currentPlayer.name}`);
            
            // Forzar desconexión voluntaria para procesar el cash out
            currentPlayer.voluntaryExit = true;
            sockets[currentPlayer.id].emit('forceCashout');
        }
    }, growthConfig.autoCashout.delay);
}

// Funciones del sistema de eventos globales
function startSpeedEvent() {
    if (speedEventActive) return;
    
    speedEventActive = true;
    const eventConfig = config.globalEvents.speedEvent;
    
    console.log('[SPEED_EVENT] Evento de velocidad activado - Velocidad x' + eventConfig.speedMultiplier);
    
    // Notificar a todos los clientes que el evento está activo
    io.emit('speedEventStart', {
        duration: eventConfig.duration,
        speedMultiplier: eventConfig.speedMultiplier
    });
    
    // Programar el fin del evento
    speedEventTimer = setTimeout(() => {
        endSpeedEvent();
    }, eventConfig.duration);
    
    // Iniciar contador regresivo
    startSpeedEventCountdown();
}

function endSpeedEvent() {
    if (!speedEventActive) return;
    
    speedEventActive = false;
    console.log('[SPEED_EVENT] Evento de velocidad finalizado');
    
    // Notificar a todos los clientes que el evento terminó
    io.emit('speedEventEnd');
    
    // Limpiar timers
    if (speedEventTimer) {
        clearTimeout(speedEventTimer);
        speedEventTimer = null;
    }
    if (speedEventCountdown) {
        clearInterval(speedEventCountdown);
        speedEventCountdown = null;
    }
    
    // Programar el próximo evento de bombas después de que termine este
    console.log('[SPEED_EVENT] Programando próximo evento de bombas...');
    scheduleBombEvent();
}

function startSpeedEventCountdown() {
    const eventConfig = config.globalEvents.speedEvent;
    let timeLeft = Math.floor(eventConfig.duration / 1000);
    
    speedEventCountdown = setInterval(() => {
        timeLeft--;
        
        // Enviar actualización del contador cada segundo
        io.emit('speedEventCountdown', { timeLeft });
        
        if (timeLeft <= 0) {
            clearInterval(speedEventCountdown);
            speedEventCountdown = null;
        }
    }, 1000);
}

function scheduleSpeedEvent() {
    const eventConfig = config.globalEvents.speedEvent;
    
    if (!eventConfig.enabled) return;
    
    console.log('[SPEED_EVENT] Programando próximo evento de velocidad en ' + (eventConfig.interval / 1000 / 60) + ' minutos (5 alertas de cuenta regresiva: 1, 2, 3, 4, 5 minutos antes)');
    
    // Programar alertas de cuenta regresiva cada minuto
    if (eventConfig.countdownAlerts) {
        // Para 5 minutos, necesitamos 5 alertas (1, 2, 3, 4, 5 minutos antes del evento)
        for (let i = 1; i <= 5; i++) {
            const minutesLeft = i; // 1, 2, 3, 4, 5 minutos
            const alertTime = eventConfig.interval - (minutesLeft * eventConfig.countdownInterval);
            
            setTimeout(() => {
                if (!speedEventActive) {
                    console.log(`[SPEED_EVENT] Alerta: Evento de velocidad en ${minutesLeft} minutos`);
                    io.emit('speedEventCountdownAlert', {
                        minutesLeft: minutesLeft,
                        timeUntilEvent: minutesLeft * 60
                    });
                }
            }, alertTime);
        }
    }
    
    // Programar advertencia final (1 minuto antes)
    speedEventWarningTimer = setTimeout(() => {
        if (!speedEventActive) {
            console.log('[SPEED_EVENT] Advertencia final: Evento de velocidad en 1 minuto');
            io.emit('speedEventWarning', {
                timeUntilEvent: eventConfig.warningTime / 1000
            });
            
            // Programar el evento después de la advertencia
            setTimeout(() => {
                if (!speedEventActive) {
                    startSpeedEvent();
                }
            }, eventConfig.warningTime);
        }
    }, eventConfig.interval - eventConfig.warningTime);
    
    // NO programar el próximo evento aquí, se programará cuando termine el evento actual
}

// Iniciar el sistema de eventos si está habilitado
if (config.globalEvents && config.globalEvents.speedEvent && config.globalEvents.speedEvent.enabled) {
    scheduleSpeedEvent();
}

// Funciones del sistema de eventos de bombas
function startBombEvent() {
    if (bombEventActive) return;
    
    bombEventActive = true;
    const eventConfig = config.globalEvents.bombEvent;
    
    console.log('[BOMB_EVENT] Evento de bombas activado');
    
    // Activar las bombas
    if (bombManager) {
        bombManager.activate(config.gameWidth, config.gameHeight);
    }
    
    // Notificar a todos los clientes que el evento está activo
    io.emit('bombEventStart', {
        duration: eventConfig.duration,
        bombCount: eventConfig.bombCount
    });
    
    // Programar el fin del evento
    bombEventTimer = setTimeout(() => {
        endBombEvent();
    }, eventConfig.duration);
    
    // Iniciar contador regresivo
    startBombEventCountdown();
}

function endBombEvent() {
    if (!bombEventActive) return;
    
    bombEventActive = false;
    console.log('[BOMB_EVENT] Evento de bombas finalizado');
    
    // Desactivar las bombas
    if (bombManager) {
        bombManager.deactivate();
    }
    
    // Notificar a todos los clientes que el evento terminó
    io.emit('bombEventEnd');
    
    // Limpiar timers
    if (bombEventTimer) {
        clearTimeout(bombEventTimer);
        bombEventTimer = null;
    }
    if (bombEventCountdown) {
        clearInterval(bombEventCountdown);
        bombEventCountdown = null;
    }
    
    // Programar el próximo evento de velocidad después de que termine este
    console.log('[BOMB_EVENT] Programando próximo evento de velocidad...');
    scheduleSpeedEvent();
}

function startBombEventCountdown() {
    const eventConfig = config.globalEvents.bombEvent;
    let timeLeft = Math.floor(eventConfig.duration / 1000);
    
    bombEventCountdown = setInterval(() => {
        timeLeft--;
        
        // Enviar actualización del contador cada segundo
        io.emit('bombEventCountdown', { timeLeft });
        
        if (timeLeft <= 0) {
            clearInterval(bombEventCountdown);
            bombEventCountdown = null;
        }
    }, 1000);
}

function scheduleBombEvent() {
    const eventConfig = config.globalEvents.bombEvent;
    
    if (!eventConfig.enabled) return;
    
    console.log('[BOMB_EVENT] Programando próximo evento de bombas en ' + (eventConfig.interval / 1000 / 60) + ' minutos (5 alertas de cuenta regresiva: 1, 2, 3, 4, 5 minutos antes)');
    
    // Programar alertas de cuenta regresiva cada minuto
    if (eventConfig.countdownAlerts) {
        // Para 5 minutos, necesitamos 5 alertas (1, 2, 3, 4, 5 minutos antes del evento)
        for (let i = 1; i <= 5; i++) {
            const minutesLeft = i; // 1, 2, 3, 4, 5 minutos
            const alertTime = eventConfig.interval - (minutesLeft * eventConfig.countdownInterval);
            
            setTimeout(() => {
                if (!bombEventActive) {
                    console.log(`[BOMB_EVENT] Alerta: Evento de bombas en ${minutesLeft} minutos`);
                    io.emit('bombEventCountdownAlert', {
                        minutesLeft: minutesLeft,
                        timeUntilEvent: minutesLeft * 60
                    });
                }
            }, alertTime);
        }
    }
    
    // Programar advertencia final (1 minuto antes)
    bombEventWarningTimer = setTimeout(() => {
        if (!bombEventActive) {
            console.log('[BOMB_EVENT] Advertencia final: Evento de bombas en 1 minuto');
            io.emit('bombEventWarning', {
                timeUntilEvent: eventConfig.warningTime / 1000
            });
            
            // Programar el evento después de la advertencia
            setTimeout(() => {
                if (!bombEventActive) {
                    startBombEvent();
                }
            }, eventConfig.warningTime);
        }
         }, eventConfig.interval - eventConfig.warningTime);
    
    // NO programar el próximo evento aquí, se programará cuando termine el evento actual
}

setInterval(tickGame, 1000 / 60);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / config.networkUpdateFactor);

// Don't touch, IP configurations.
var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || config.host;
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || config.port;
http.listen(serverport, ipaddress, () => console.log('[DEBUG] Listening on ' + ipaddress + ':' + serverport));
