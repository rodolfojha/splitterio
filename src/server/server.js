/*jslint bitwise: true, node: true */
'use strict';

// Cargar variables de entorno desde .env
require('dotenv').config();

const tokenStore = require("./tokenStore"); //TOKEN JWT

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const app = express();
const http = require('http').Server(app);
const io = require("socket.io")(http, {
  pingInterval: 10000, // cada cuánto envía ping
  pingTimeout: 60000,  // 2 minutos de espera antes de desconectar
  cors: {
    origin: ["https://splittaio.com", "https://www.splittaio.com", "https://usa.backspitta.xyz"],  // frontend permitido
    methods: ["GET", "POST"],         // métodos permitidos
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  }
});
const SAT = require('sat');

const { RedZone } = require('./game-logic');
const loggingRepositry = require('./repositories/logging-repository');
const chatRepository = require('./repositories/chat-repository');
const AuthRepository = require('./repositories/auth-repository');
const authRepository = new AuthRepository();
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
let playersStatsInGame = {}; //TODO guardar IP para comprobaciones de mas seguridad(si se accede de otra IP con mismo id etc etc desconectar)
const INIT_MASS_LOG = util.mathLog(config.defaultPlayerMass, config.slowBase);

let leaderboard = [];
let leaderboardChanged = false;

// Variables para estadísticas en tiempo real
let globalWinnings = 0;
let totalBetsPlaced = 0;
let statsUpdateInterval = null;

// Función para emitir estadísticas en tiempo real
function emitStats() {
    const connectedPlayers = Object.keys(sockets).length;
    const stats = {
        playersOnline: connectedPlayers,
        globalWinnings: Number(globalWinnings || 0).toFixed(2)
    };
    io.emit('statsUpdate', stats);
}

// Función para obtener estadísticas actuales
function getCurrentStats() {
    const connectedPlayers = Object.keys(sockets).length;
    return {
        playersOnline: connectedPlayers,
        globalWinnings: Number(globalWinnings || 0).toFixed(2)
    };
}

//Refrescar nuevo token
async function refreshToken() {
    try {
        const response = await fetch("https://api.nowpayments.io/v1/auth", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: process.env.NOWPAYMENTS_EMAIL,
                password: process.env.NOWPAYMENTS_PASSWORD
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log("✅ Token recibido:", data.token);

        // Guardamos el token en memoria con expiración de 280 segundos
        const EXPIRATION_SECONDS = 280;
        tokenStore.setToken(data.token, EXPIRATION_SECONDS);
        console.log(`✅ Token renovado y válido por ${EXPIRATION_SECONDS} segundos`);

        return data.token;

    } catch (error) {
        console.error("❌ Error al renovar token:", error.message);
        return null;
    }
}


// Función que siempre devuelve un token válido
async function getValidToken() {
    if (!tokenStore.getToken() || tokenStore.isExpired()) {
        return await refreshToken();
    }
    return tokenStore.getToken();
}

// Función para actualizar estadísticas globales en la base de datos
async function updateGlobalStats(winningsToAdd = 0, betsToAdd = 0, gamesToAdd = 0) {
    try {
        const connection = await db.getConnection();
        await connection.execute(`
            UPDATE global_stats SET 
            total_winnings = total_winnings + ?, 
            total_bets_placed = total_bets_placed + ?, 
            total_games_played = total_games_played + ?,
            last_updated = CURRENT_TIMESTAMP 
            WHERE id = 1
        `, [winningsToAdd, betsToAdd, gamesToAdd]);
        connection.release();
        
        console.log(`[GLOBAL_STATS] Estadísticas globales actualizadas: +$${winningsToAdd} ganancias, +$${betsToAdd} apuestas, +${gamesToAdd} partidas`);
    } catch (err) {
        console.error('[GLOBAL_STATS] Error actualizando estadísticas globales:', err);
        throw err;
    }
}

// Función para actualizar leaderboard de un jugador
async function updatePlayerLeaderboard(userId, username, gameResult) {
    try {
        console.log(`[LEADERBOARD] Actualizando para ${username}:`, gameResult);
        const connection = await db.getConnection();
        
        // Primero, verificar si el jugador ya existe en el leaderboard
        const [rows] = await connection.execute(`SELECT * FROM player_leaderboard WHERE user_id = ?`, [userId]);
        
        if (rows.length > 0) {
            // Actualizar jugador existente
            const row = rows[0];
            const currentWinnings = Number(row.total_winnings) || 0;
            const currentGames = Number(row.total_games_played) || 0;
            const currentGamesWon = Number(row.total_games_won) || 0;
            const currentGamesLost = Number(row.total_games_lost) || 0;
            const currentGamesTied = Number(row.total_games_tied) || 0;
            const currentBiggestWin = Number(row.biggest_win) || 0;
            const currentTotalBets = Number(row.total_bets_placed) || 0;
            
            const newTotalWinnings = currentWinnings + (gameResult.winnings || 0);
            const newTotalGames = currentGames + 1;
            const newGamesWon = currentGamesWon + (gameResult.resultType === 'win' ? 1 : 0);
            const newGamesLost = currentGamesLost + (gameResult.resultType === 'loss' ? 1 : 0);
            const newGamesTied = currentGamesTied + (gameResult.resultType === 'tie' ? 1 : 0);
            const newBiggestWin = Math.max(currentBiggestWin, gameResult.winnings || 0);
            const newTotalBets = currentTotalBets + (gameResult.betAmount || 0);
            const newWinRate = newGamesWon / newTotalGames * 100;

            await connection.execute(`UPDATE player_leaderboard SET 
                    total_winnings = ?, 
                    total_games_played = ?,
                    total_games_won = ?,
                    total_games_lost = ?,
                    total_games_tied = ?,
                    biggest_win = ?,
                    total_bets_placed = ?,
                    win_rate = ?,
                    last_updated = CURRENT_TIMESTAMP 
                    WHERE user_id = ?`, 
                    [newTotalWinnings, newTotalGames, newGamesWon, newGamesLost, newGamesTied, 
                     newBiggestWin, newTotalBets, newWinRate, userId]);
            
            console.log(`[LEADERBOARD] Jugador ${username} actualizado: $${newTotalWinnings} total (antes: $${currentWinnings}, ganancia: $${gameResult.winnings || 0}), ${newWinRate.toFixed(1)}% win rate`);
        } else {
            // Crear nuevo jugador en el leaderboard
            const winRate = gameResult.resultType === 'win' ? 100 : 0;
            await connection.execute(`INSERT INTO player_leaderboard 
                    (user_id, username, total_winnings, total_games_played, total_games_won, 
                     total_games_lost, total_games_tied, biggest_win, total_bets_placed, win_rate) 
                    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`, 
                    [userId, username, gameResult.winnings || 0, 
                     gameResult.resultType === 'win' ? 1 : 0,
                     gameResult.resultType === 'loss' ? 1 : 0,
                     gameResult.resultType === 'tie' ? 1 : 0,
                     gameResult.winnings || 0, gameResult.betAmount || 0, winRate]);
            
            console.log(`[LEADERBOARD] Nuevo jugador ${username} agregado al leaderboard con $${gameResult.winnings || 0} ganancias`);
        }
        
        connection.release();
    } catch (err) {
        console.error('[LEADERBOARD] Error actualizando leaderboard:', err);
        throw err;
    }
}

// Función para obtener el top 5 del leaderboard
async function getTopLeaderboard() {
    try {
        const connection = await db.getConnection();
        const [rows] = await connection.execute(`
            SELECT username, total_winnings, total_games_played, total_games_won, 
                   total_games_lost, total_games_tied, biggest_win, win_rate 
            FROM player_leaderboard 
            ORDER BY total_winnings DESC 
            LIMIT 5
        `);
        connection.release();
        return rows;
    } catch (err) {
        console.error('[LEADERBOARD] Error obteniendo top 5:', err);
        throw err;
    }
}

// Función para cargar estadísticas globales desde la base de datos
async function loadGlobalStatsFromDB() {
    try {
        const connection = await db.getConnection();
        const [rows] = await connection.execute(`SELECT total_winnings, total_bets_placed, total_games_played FROM global_stats WHERE id = 1`);
        connection.release();
        
        if (rows.length > 0) {
            const row = rows[0];
            globalWinnings = Number(row.total_winnings) || 0;
            totalBetsPlaced = Number(row.total_bets_placed) || 0;
            console.log(`[GLOBAL_STATS] Estadísticas cargadas: $${globalWinnings} ganancias, $${totalBetsPlaced} apuestas, ${row.total_games_played} partidas`);
        } else {
            console.log('[GLOBAL_STATS] No se encontraron estadísticas, usando valores por defecto');
        }
    } catch (err) {
        console.error('[GLOBAL_STATS] Error cargando estadísticas:', err);
    }
}

// Iniciar el intervalo de actualización de estadísticas
function startStatsUpdate() {
    if (statsUpdateInterval) {
        clearInterval(statsUpdateInterval);
    }
    statsUpdateInterval = setInterval(emitStats, 2000); // Actualizar cada 2 segundos
    emitStats(); // Emitir inmediatamente
}

const Vector = SAT.Vector;

// Configuración CORS para permitir conexiones desde el frontend
const cors = require('cors');
app.use(cors({
    origin: ["https://splittaio.com", "https://www.splittaio.com", "https://usa.backspitta.xyz"],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

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
        
        if (!betAmount || ![2, 5, 20].includes(betAmount)) {
            return res.status(400).json({ error: 'Apuesta debe ser $2, $5 o $20' });
        }
        if(![2].includes(betAmount)){
            return res.status(400).json({ error: 'Actualmente ese servidor no está disponible' });
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

// ===== NUEVA IMPLEMENTACIÓN DE PAGOS CON NOWPAYMENTS =====

// Endpoint para obtener monedas disponibles
app.get('/api/currencies', async (req, res) => {
    try {
        const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
        const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';

        const response = await fetch(`${NOWPAYMENTS_API_URL}/currencies?fixed_rate=true`, {
            method: 'GET',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY
            }
        });

        const data = await response.json();

        // Reenvía la respuesta tal cual a tu frontend
        res.status(response.status).json(data);

    } catch (error) {
        console.error('[NOWPAYMENTS] Error en currencies:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

//Endpoint estimate withdraw
app.get('/api/estimate-withdraw', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
        const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';
        
        const { amount, crypto = 'btc' } = req.query;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Monto inválido' });
        }

        console.log(`[NOWPAYMENTS] Obteniendo estimación para ${req.user.username}: $${amount} USD -> ${crypto.toUpperCase()}`);

        // Configuración de NOWPayments

        if (!NOWPAYMENTS_API_KEY) {
            console.error('[NOWPAYMENTS] NOWPAYMENTS_API_KEY no está configurada en las variables de entorno');
            return res.status(500).json({ error: 'Configuración de pagos no disponible' });
        }


        let estimateResponse = await fetch(`${NOWPAYMENTS_API_URL}/estimate?amount=${amount}&currency_from=usdtmatic&currency_to=${crypto}`, {
            method: 'GET',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY
            }
        });
        
        let estimateData = await estimateResponse.json();
        let amount_crypto = estimateData.estimated_amount;
        
        if (!estimateResponse.ok) {
            console.error('[NOWPAYMENTS] Error obteniendo estimación:', estimateData);
            return res.status(500).json({ error: 'Error obteniendo estimación de pago inicial' });
        }

        estimateResponse = await fetch(`${NOWPAYMENTS_API_URL}/payout/fee?currency=${crypto}&amount=${amount_crypto}`, {
            method: 'GET',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY
            }
        });
        
        estimateData = await estimateResponse.json();
        
        if (!estimateResponse.ok) {
            console.error('[NOWPAYMENTS] Error obteniendo estimación:', estimateData);
            return res.status(500).json({ error: 'Error obteniendo estimación de pago' });
        }
        
        if(crypto.toLowerCase()=="usdtmatic"){
            estimateData.fee = estimateData.fee + amount_crypto*0.005;
        }else{
            estimateData.fee = estimateData.fee + amount_crypto*0.01;
        }
        let amount_f = amount_crypto-estimateData.fee;
        
        res.json({
            success: true,
            estimated_amount: amount_f,
            rate: `${amount_crypto / amount} ${crypto.toUpperCase()}`,
            currency_from: "USD",
            currency_to: estimateData.currency,
            fee: estimateData.fee
        });

    } catch (error) {
        console.error('[NOWPAYMENTS] Error en estimate:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para obtener estimación de pago
app.get('/api/estimate', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        const { amount, crypto = 'btc' } = req.query;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Monto inválido' });
        }

        // Para USDT no necesitamos estimación ya que es 1:1
        if (crypto.toLowerCase().includes('usdt')) {
            return res.json({
                success: true,
                estimated_amount: amount,
                rate: `1 ${crypto.toUpperCase()}`,
                currency_from: 'usd',
                currency_to: crypto
            });
        }

        console.log(`[NOWPAYMENTS] Obteniendo estimación para ${req.user.username}: $${amount} USD -> ${crypto.toUpperCase()}`);

        // Configuración de NOWPayments
        const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
        const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';

        if (!NOWPAYMENTS_API_KEY) {
            console.error('[NOWPAYMENTS] NOWPAYMENTS_API_KEY no está configurada en las variables de entorno');
            return res.status(500).json({ error: 'Configuración de pagos no disponible' });
        }

        // Obtener estimación
        const estimateResponse = await fetch(`${NOWPAYMENTS_API_URL}/estimate?amount=${amount}&currency_from=usd&currency_to=${crypto}`, {
            method: 'GET',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY
            }
        });
        
        const estimateData = await estimateResponse.json();
        console.log('[NOWPAYMENTS] Estimación recibida:', estimateData);
        
        if (!estimateResponse.ok) {
            console.error('[NOWPAYMENTS] Error obteniendo estimación:', estimateData);
            return res.status(500).json({ error: 'Error obteniendo estimación de pago' });
        }

        res.json({
            success: true,
            estimated_amount: estimateData.estimated_amount,
            rate: `${estimateData.estimated_amount / amount} ${crypto.toUpperCase()}`,
            currency_from: estimateData.currency_from,
            currency_to: estimateData.currency_to
        });

    } catch (error) {
        console.error('[NOWPAYMENTS] Error en estimate:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para crear pago
app.post('/api/create-payment', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        const { amount, crypto = 'btc' } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Monto inválido' });
        }

        console.log(`[NOWPAYMENTS] Creando pago para ${req.user.username}: $${amount} USD -> ${crypto.toUpperCase()}`);

        // Configuración de NOWPayments
        const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
        const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';

        if (!NOWPAYMENTS_API_KEY) {
            console.error('[NOWPAYMENTS] NOWPAYMENTS_API_KEY no está configurada en las variables de entorno');
            return res.status(500).json({ error: 'Configuración de pagos no disponible' });
        }

        // Verificar estado de la API
        try {
            const statusResponse = await fetch(`${NOWPAYMENTS_API_URL}/status`, {
                method: 'GET',
                headers: {
                    'x-api-key': NOWPAYMENTS_API_KEY
                }
            });
            
            const statusData = await statusResponse.json();
            console.log('[NOWPAYMENTS] API Status:', statusData);
            
            if (!statusResponse.ok) {
                console.error('[NOWPAYMENTS] Error verificando API:', statusData);
                return res.status(500).json({ error: 'Error verificando API de NOWPayments' });
            }
        } catch (error) {
            console.error('[NOWPAYMENTS] Error verificando API:', error);
        }

        // Determinar la moneda de precio basada en la criptomoneda seleccionada
        let priceCurrency = 'usdtmatic';
        let adjustedAmount = amount;
        let fixedRate = false;
        let feePaidByUser = false;

        const c = crypto.toLowerCase();

        // Configuración especial para USDTMATIC
        if (c === 'usdtmatic') {
            adjustedAmount = Math.max(amount, 2)*1.005; 
            fixedRate = false;
            feePaidByUser = false;
        }
        // Configuración especial para USDTERC20
        else if ((c.includes("usdt") || c.includes("usdc") || c.includes("fdusd")) && (c.includes("bsc") || c.includes("sol"))) { //TODO HACER QUE SE CALCULE
            adjustedAmount = Math.max(amount, 5)*1.015;
        }
        else {
            adjustedAmount = Math.max(amount, 13.5); // Mínimo $5 USDT para otros
            fixedRate = true;
            feePaidByUser = true;
        }
        
        // Crear el pago usando la API de NOWPayments
        const paymentData = {
            price_amount: adjustedAmount,
            price_currency: priceCurrency,
            pay_currency: crypto,
            order_id: `splitta_${req.user.id}_${Date.now()}`,
            order_description: `Recarga de balance para ${req.user.username}`,
            ipn_callback_url: `${req.protocol}://${req.get('host')}/api/payment-webhook`,
            is_fixed_rate: fixedRate,
            is_fee_paid_by_user: feePaidByUser
        };


        console.log(`[NOWPAYMENTS] Configuración de pago - Monto original: $${amount} USD, Monto ajustado: $${adjustedAmount} ${priceCurrency.toUpperCase()}, Cripto: ${crypto.toUpperCase()}`);
        console.log('[NOWPAYMENTS] Datos del pago:', paymentData);

        const response = await fetch(`${NOWPAYMENTS_API_URL}/payment`, {
            method: 'POST',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(paymentData)
        });

        const paymentResponse = await response.json();

        if (!response.ok) {
            console.error('[NOWPAYMENTS] Error creando pago:', paymentResponse);
            return res.status(500).json({ error: 'Error al crear el pago' });
        }
        
        console.log(`[NOWPAYMENTS] Pago creado exitosamente - ID: ${paymentResponse.payment_id}`);

        // Generar QR code para la dirección de pago
        const qrCodeData = `${crypto}:${paymentResponse.pay_address}?amount=${paymentResponse.pay_amount}`;

        // Guardar el pago en la base de datos
        const connection = await db.getConnection();
        await connection.execute(`INSERT INTO payments (
            user_id, payment_id, amount, currency, pay_currency, 
            pay_amount, pay_address, order_id, status, qr_code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            req.user.id,
            paymentResponse.payment_id,
            amount,
            'USD',
            crypto,
            paymentResponse.pay_amount,
            paymentResponse.pay_address,
            paymentData.order_id,
            'waiting',
            qrCodeData,
        new Date().toISOString().slice(0, 19).replace('T', ' ')
        ]);
        connection.release();
        console.log(`[NOWPAYMENTS] Pago guardado en BD`);

        res.json({
            success: true,
            payment: {
                id: paymentResponse.payment_id,
                payAddress: paymentResponse.pay_address,
                payAmount: paymentResponse.pay_amount,
                payCurrency: paymentResponse.pay_currency,
                priceAmount: paymentResponse.price_amount,
                priceCurrency: paymentResponse.price_currency,
                orderId: paymentResponse.order_id,
                paymentStatus: paymentResponse.payment_status,
                qrCode: qrCodeData
            }
        });

    } catch (error) {
        console.error('[NOWPAYMENTS] Error en create-payment:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para verificar el estado de un pago
app.get('/api/payment-status', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        const { payment_id } = req.query;
        
        if (!payment_id) {
            return res.status(400).json({ error: 'Payment ID requerido' });
        }

        console.log(`[NOWPAYMENTS] Verificando estado del pago: ${payment_id}`);

        // Configuración de NOWPayments
        const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
        const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';

        // Verificar estado del pago
        const statusResponse = await fetch(`${NOWPAYMENTS_API_URL}/payment/${payment_id}`, {
            method: 'GET',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY
            }
        });
        
        const statusData = await statusResponse.json();
        console.log('[NOWPAYMENTS] Estado del pago:', statusData);
        
        if (!statusResponse.ok) {
            console.error('[NOWPAYMENTS] Error verificando estado:', statusData);
            return res.status(500).json({ error: 'Error verificando estado del pago' });
        }

        res.json({
            success: true,
            status: statusData.payment_status,
            payment_id: statusData.payment_id,
            amount: statusData.pay_amount,
            currency: statusData.pay_currency
        });

    } catch (error) {
        console.error('[NOWPAYMENTS] Error en payment-status:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para obtener pagos del usuario
app.get('/api/user-payments', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        console.log(`[NOWPAYMENTS] Obteniendo pagos para usuario: ${req.user.username}`);

        // Obtener pagos del usuario desde la base de datos
        const connection = await db.getConnection();
        const [payments] = await connection.execute(`SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`, [req.user.id]);
        connection.release();

        console.log(`[NOWPAYMENTS] Pagos encontrados: ${payments.length}`);

        res.json({
            success: true,
            payments: payments.map(payment => ({
                id: payment.payment_id,
                amount: payment.amount,
                currency: payment.currency,
                payCurrency: payment.pay_currency,
                payAmount: payment.pay_amount,
                payAddress: payment.pay_address,
                status: payment.status,
                orderId: payment.order_id,
                createdAt: payment.created_at,
                updatedAt: payment.updated_at
            }))
        });

    } catch (error) {
        console.error('[NOWPAYMENTS] Error en user-payments:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Webhook para recibir notificaciones de pago
app.post('/api/payment-webhook', async (req, res) => {
    try {
        const { 
            payment_id, 
            payment_status, 
            pay_amount, 
            pay_currency, 
            order_id,
            price_amount,
            price_currency,
            actually_paid,  
            actually_paid_at_fiat
        } = req.body;
        
        console.log(`[NOWPAYMENTS] Webhook recibido - Payment ID: ${payment_id}, Status: ${payment_status}`);

        // Verificar que el pago existe en nuestra BD
        const connection = await db.getConnection();
        const [payments] = await connection.execute(`SELECT * FROM payments WHERE payment_id = ?`, [payment_id]);
        
        if (payments.length === 0) {
            console.error('[NOWPAYMENTS] Pago no encontrado en BD:', payment_id);
            connection.release();
            return res.status(404).send('Payment not found');
        }

        const payment = payments[0];

        // Actualizar estado del pago
        await connection.execute(`UPDATE payments SET 
            status = ?, 
            pay_amount = ?, 
            updated_at = ? 
            WHERE payment_id = ?`, 
            [payment_status, actually_paid || pay_amount, new Date().toISOString().slice(0, 19).replace('T', ' '), payment_id]);

        // Si el pago está confirmado o finalizado, agregar fondos al usuario
        if (payment_status === 'confirmed' || payment_status === 'finished' || payment_status === 'sending') {
            try {
                // Usar el monto realmente pagado en USD
                const amountToAdd = actually_paid_at_fiat || price_amount || payment.amount;
                const newBalance = await authRepository.addWinnings(payment.user_id, amountToAdd);
                console.log(`[NOWPAYMENTS] ✅ Fondos agregados para usuario ${payment.user_id}: $${amountToAdd} USD, nuevo balance: $${newBalance}`);
                
                //TODO enviar saldo
                
                
                // Enviar notificación al usuario (si está conectado via WebSocket)
                // Esto se puede implementar más adelante con WebSockets
                console.log(`[NOWPAYMENTS] 🎉 Pago completado exitosamente para usuario ${payment.user_id}`);
            } catch (error) {
                console.error('[NOWPAYMENTS] ❌ Error agregando fondos:', error);
            }
        } else if (payment_status === 'failed' || payment_status === 'expired') {
            console.log(`[NOWPAYMENTS] ❌ Pago fallido/expirado para usuario ${payment.user_id}: ${payment_status}`);
        } else {
            console.log(`[NOWPAYMENTS] ⏳ Pago en progreso para usuario ${payment.user_id}: ${payment_status}`);
        }

        connection.release();
        res.status(200).send('OK');

    } catch (error) {
        console.error('[NOWPAYMENTS] Error en webhook:', error);
        res.status(500).send('Error');
    }
});

// Endpoint para obtener historial de partidas
app.get('/api/game-history', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }
        
        const limit = parseInt(req.query.limit) || 50;
        const history = await getUserGameHistory(req.user.id, limit);
        
        // Calcular estadísticas
        const stats = {
            totalGames: history.length,
            wins: history.filter(g => g.result_type === 'win').length,
            losses: history.filter(g => g.result_type === 'loss').length,
            ties: history.filter(g => g.result_type === 'tie').length,
            totalBet: history.reduce((sum, g) => sum + (g.bet_amount || 0), 0),
            totalReturned: history.reduce((sum, g) => sum + (g.returned_amount || 0), 0),
            totalCommission: history.reduce((sum, g) => sum + (g.commission_applied || 0), 0),
            avgDuration: history.length > 0 ? Math.round(history.reduce((sum, g) => sum + (g.duration_seconds || 0), 0) / history.length) : 0,
            maxMass: Math.max(...history.map(g => g.max_mass_reached || 0), 0)
        };
        
        console.log(`[GAME_HISTORY] Enviando historial para ${req.user.username}: ${history.length} partidas`);
        
        res.json({
            success: true,
            history: history,
            stats: stats
        });
    } catch (error) {
        console.error('[GAME_HISTORY] Error obteniendo historial:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

//TODO revisar para que el dinero solo se sume con datos guardados en el backend(NO FRONTEND)
app.post('/api/voluntaryDisconnect', async (req, res) => {
    try {
        const sessionToken = req.headers.authorization?.replace('Bearer ', '');
        const { duration } = req.body; //TODO usar userID para obtener datos
        let userID = req.body.userId;
        console.log(req.body);
        console.log('[API] /api/voluntaryDisconnect recibido');
        
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

        let datosUsuarioDesconectado = playersStatsInGame[userID];
        if(!datosUsuarioDesconectado){
            return res.status(401).json({ error: 'Usuario no está en partida' });
        }
        console.log('[API] Usuario encontrado:', user.username, 'Balance actual:', user.balance);
        
        let originalBet = datosUsuarioDesconectado['bet']; //TODO quitar basura etc
        let betAmount = datosUsuarioDesconectado['actualMoney'];
        let maxMass = datosUsuarioDesconectado['actualMass'];
        let disconnectReason = datosUsuarioDesconectado['status'];
        if((!["playing","eaten", "voluntaryDisconnect"].includes(disconnectReason))){
            return res.status(401).json({ error: 'Status no reconocido' }); //Por si intenta hacer una petición mientras está en partida
        }
        if("playing" == disconnectReason){
            disconnectReason = "voluntaryDisconnect";
        }
        delete playersStatsInGame[userID]; //Eliminar de dict usuario para evitar ps multipeticiones etc
        //TODO NO SE SUMA EL DINERO BIEN
        let returnedAmount = 0;
        let finalBalance = user.balance;
        let resultType, commissionApplied = 0;

        console.log(user.id);
        console.log(userID);

        console.log('[API] === LÓGICA DE CASHOUT SIMPLIFICADA ===');
        console.log('[API] Apuesta original:', originalBet);
        console.log('[API] Dinero en juego:', betAmount);
        console.log('[API] Razón de desconexión:', disconnectReason);

        // Lógica de cashout simplificada según tus reglas
        if (disconnectReason === 'eaten') {
            // JUGADOR COMIDO: Pérdida total, no se devuelve nada
            console.log('[API] JUGADOR COMIDO - Pérdida total, no se devuelve nada.');
            resultType = 'loss';
            returnedAmount = 0;
            
        } else if (betAmount === originalBet) {
            // EMPATE: Se devuelve la apuesta original al jugador.
            console.log('[API] EMPATE - Devolviendo apuesta original.');
            resultType = 'tie';
            returnedAmount = originalBet;
            
        } else if (betAmount < originalBet) {
            // PÉRDIDA: Se devuelve solo lo que tiene en juego.
            console.log('[API] PÉRDIDA - Devolviendo solo lo que tiene en juego.');
            resultType = 'loss';
            returnedAmount = betAmount;
            
        } else if (betAmount > originalBet) {
            // GANANCIA: Se aplica 10% de comisión y se devuelve el resto.
            console.log('[API] GANANCIA - Aplicando comisión del 10%.');
            resultType = 'win';
            commissionApplied = Math.round(betAmount * 0.1 * 100) / 100;
            const netWinnings = betAmount - commissionApplied;
            returnedAmount = (originalBet > netWinnings)?betAmount:netWinnings; // Mínimo entre originalBet y netWinnings
            winnings += returnedAmount - (betAmount - originalBet);
            
            // Actualizar estadísticas globales
            globalWinnings += winnings; //TODO hacer que se guarde en BD
            
            // Actualizar estadísticas en la base de datos
            updateGlobalStats(winnings, 0, 1)
                .then(() => {
                    // Actualizar leaderboard del jugador
                    const gameResult = {
                        winnings: winnings,
                        resultType: 'win',
                        betAmount: originalBet
                    };
                    return updatePlayerLeaderboard(user.id, user.username, gameResult);
                })
                .catch(err => {
                    console.error('[API] Error actualizando estadísticas:', err);
                });
            
            console.log(`[API] Ganancia neta: $${winnings} | Comisión (10%): $${commissionApplied} | Ganancia neta final: $${netWinnings}`);
        }
        
        if (resultType === 'tie') {
            // En empate, devolver la apuesta original al balance
            
            finalBalance = await authRepository.addWinnings(user.id, originalBet);
            console.log('[API] Empate - Apuesta devuelta al balance:', finalBalance);
        } else if (disconnectReason === 'eaten') {
            // Si el jugador fue comido, mantener el balance actual (ya se descontó al iniciar)
            finalBalance = user.balance;
            console.log('[API] Jugador comido - Balance mantenido:', finalBalance);
        } else if (returnedAmount > 0) {
            // Para ganancias y pérdidas, agregar la cantidad devuelta
            finalBalance = await authRepository.addWinnings(user.id, returnedAmount);
        }
        
        // Registrar en el historial (buscar la partida activa más reciente)
        try {
            const connection = await db.getConnection();
            const [rows] = await connection.execute(`
                SELECT id FROM game_history 
                WHERE user_id = ? AND result_type IS NULL 
                ORDER BY start_time DESC LIMIT 1
            `, [user.id]);
            connection.release();
            
            const gameRow = rows.length > 0 ? rows[0] : null;
            
            if (gameRow) {
                console.log(`[API] Encontrada partida activa - ID: ${gameRow.id}`);
                const finalDisconnectReason = disconnectReason || 'manual_cashout';
                
                // Si el jugador fue comido, el dinero final debe ser 0
                const finalAmount = (disconnectReason === 'eaten') ? 0 : betAmount;
                
                await recordGameEnd(gameRow.id, finalAmount, resultType, commissionApplied, finalDisconnectReason, maxMass || 0);
                console.log(`[API] Partida registrada en historial - ID: ${gameRow.id}, Resultado: ${resultType}, Razón: ${finalDisconnectReason}, Masa: ${maxMass}, Duración: ${duration}, Dinero final: ${finalAmount}`);
        
        // Emitir estadísticas actualizadas
        emitStats();
            } else {
                console.log(`[API] No se encontró partida activa para el usuario ${user.id}`);
            }
        } catch (error) {
            console.error('[API] Error registrando en historial:', error);
        }
        
        console.log('[API] Respuesta final - Devolviendo:', returnedAmount, 'Nuevo balance:', finalBalance);
        
        // ALERTA GLOBAL: Notificar a todos los jugadores sobre el cashout usando el mismo sistema que combatAlert
        if (disconnectReason !== 'eaten') { // Solo para cashouts manuales, no para jugadores comidos
            // Buscar el jugador en el mapa para obtener su posición
            const playerInGame = map.players.data.find(p => p.name === user.username);
            if (playerInGame) {
                io.emit('combatAlert', {
                    eaterName: user.username,
                    eatenName: 'CASHOUT',
                    eaterId: playerInGame.id, // ID del jugador para seguimiento en tiempo real
                    message: `¡${user.username} hizo cashout con $${betAmount}! ${resultType === 'win' ? '¡GANÓ!' : resultType === 'tie' ? 'EMPATÓ' : 'PERDIÓ'}`
                });
                
                console.log(`[CASHOUT_ALERT] Alerta global enviada: ${user.username} (ID: ${playerInGame.id}) hizo cashout con $${betAmount}`);
            }
        }
        
        // Actualizar estadísticas en la base de datos para todas las partidas
        const gameResult = {
            winnings: resultType === 'win' ? (betAmount - originalBet) : 0,
            resultType: resultType,
            betAmount: originalBet
        };
        
        // Solo actualizar estadísticas globales si no se actualizaron antes (para ganancias)
        if (resultType !== 'win') {
            updateGlobalStats(0, 0, 1)
                .then(() => {
                    return updatePlayerLeaderboard(user.id, user.username, gameResult);
                })
                .catch(err => {
                    console.error('[API] Error actualizando estadísticas:', err);
                });
        } else {
            // Para ganancias, ya se actualizó arriba, solo actualizar leaderboard
            updatePlayerLeaderboard(user.id, user.username, gameResult)
                .catch(err => {
                    console.error('[API] Error actualizando leaderboard:', err);
                });
        }
        
        // Emitir estadísticas actualizadas
        emitStats();
        
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
    console.log(socket.handshake.query);
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
        console.log('[SKIN_DEBUG] Datos recibidos del cliente:', JSON.stringify(clientPlayerData, null, 2));
        console.log('[DEBUG] Socket ID:', socket.id, 'Player data:', clientPlayerData);
        
        if (map.players.findIndexByID(socket.id) > -1 || playersStatsInGame[clientPlayerData.userId]) {
            console.log('[INFO] Player ID is already connected, kicking.');
            socket.emit('kick', 'Player alredy connected.');
            console.log(clientPlayerData);
            authRepository.addWinnings(clientPlayerData.userId, clientPlayerData.betAmount);
            socket.disconnect();
        } else if (!util.validNick(clientPlayerData.name)) {
            console.log(`[VALIDATION_ERROR] Nombre inválido: "${clientPlayerData.name}" - Longitud: ${clientPlayerData.name.length}`);
            socket.emit('kick', 'Invalid username.');
            authRepository.addWinnings(clientPlayerData.userId, currentPlayer.betAmount);
            socket.disconnect();
        } else {
            console.log('[INFO] Player ' + clientPlayerData.name + ' connected!');
            console.log('[DEBUG] Bot check - userId:', clientPlayerData.userId, 'betAmount:', clientPlayerData.betAmount);
            sockets[socket.id] = socket;

            const sanitizedName = clientPlayerData.name.replace(/(<([^>]+)>)/ig, '');
            clientPlayerData.name = sanitizedName;

            // Guardar información del usuario y apuesta ANTES de inicializar
            playerUserId = clientPlayerData.userId;
            playerUserIds[socket.id] = clientPlayerData.userId; // Guardar en el mapeo global

            playersStatsInGame[clientPlayerData.userId] = {
                "bet": clientPlayerData.betAmount,
                "actualMoney": clientPlayerData.betAmount,
                "status": "playing",
                "actualMass": 0,
            };
            playerBetAmount = clientPlayerData.betAmount || 0;
            
            // Registrar inicio de partida si hay apuesta
            if (playerBetAmount > 0 && playerUserId) {
                recordGameStart(playerUserId, clientPlayerData.name, playerBetAmount)
                    .then(gameId => {
                        currentPlayer.gameHistoryId = gameId; // Guardar ID para uso posterior
                        console.log(`[GAME_HISTORY] Partida registrada con ID: ${gameId}`);
                    })
                    .catch(err => {
                        console.error('[GAME_HISTORY] Error registrando partida:', err);
                    });
            }

            // Agregar el dinero al jugador ANTES de inicializar
            currentPlayer.gameMoney = playerBetAmount;
            currentPlayer.originalBetAmount = playerBetAmount; // Guardar apuesta original
            
            // AHORA inicializar el jugador con el dinero ya asignado
            currentPlayer.init(generateSpawnpoint(), config.defaultPlayerMass, clientPlayerData.userId);
            
            // Verificar que el dinero se asignó correctamente a la primera célula
            if (currentPlayer.cells.length > 0) {
                console.log(`[PLAYER_INIT] ${currentPlayer.name} inicializado con $${playerBetAmount} - Apuesta original: $${currentPlayer.originalBetAmount} - Primera célula tiene $${currentPlayer.cells[0].gameMoney}`);
            } else {
                console.log(`[PLAYER_INIT] ${currentPlayer.name} inicializado con $${playerBetAmount} - Sin células para asignar`);
            }

            currentPlayer.clientProvidedData(clientPlayerData);
            
            // Aplicar la skin si se proporcionó en los datos del cliente
            if (clientPlayerData.skinHue !== undefined) {
                console.log(`[SKIN_INIT] ${currentPlayer.name} conectando con skin: ${clientPlayerData.skinName} (Hue: ${clientPlayerData.skinHue}, ID: ${clientPlayerData.skinId})`);
                currentPlayer.hue = clientPlayerData.skinHue;
                currentPlayer.skinId = clientPlayerData.skinId; // Guardar el ID de la skin
                
                // Actualizar el hue y skinId de todas las células del jugador
                for (let cell of currentPlayer.cells) {
                    cell.hue = clientPlayerData.skinHue;
                    cell.skinId = clientPlayerData.skinId;
                }
                
                console.log(`[SKIN_INIT] Skin aplicada - currentPlayer.skinId: ${currentPlayer.skinId}, primera célula skinId: ${currentPlayer.cells[0]?.skinId}`);
            } else {
                console.log(`[SKIN_INIT] No se proporcionó información de skin para ${currentPlayer.name}`);
            }
            
            console.log('[DEBUG] About to add player to map:', currentPlayer.name);
            map.players.pushNew(currentPlayer);
            console.log('[DEBUG] Player added to map successfully');
            
            io.emit('playerJoin', { name: currentPlayer.name });
            console.log(`[BET] Player ${currentPlayer.name} joined with $${playerBetAmount}`);
            
            // Actualizar estadísticas globales
            if (playerBetAmount > 0) {
                totalBetsPlaced += playerBetAmount;
                globalWinnings += playerBetAmount;
            }
            
            // Emitir estadísticas actualizadas
            emitStats();
            console.log('Total players: ' + map.players.data.length);
        }

    });

    socket.on('pingcheck', () => {
        socket.emit('pongcheck');
    });

    socket.on('ping', () => {
        socket.emit('pong');
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



    socket.on('disconnect', async () => {
        console.log(`[DISCONNECT_START] ${currentPlayer.name} se desconectó. Razón: ${socket.disconnected ? 'socket.disconnected' : 'unknown'}`);
        console.log(`[DISCONNECT_START] Player data: userId=${playerUserId}, betAmount=${playerBetAmount}, originalBet=${currentPlayer.originalBetAmount}`);
        console.log(`[DISCONNECT_START] Voluntary exit: ${currentPlayer.voluntaryExit}, Was eaten: ${currentPlayer.wasEaten}`);
        
        // Solo procesar cashout automático si NO es una desconexión voluntaria
        // y el jugador tenía una apuesta activa y NO fue comido
        if (playerUserId && playerBetAmount > 0 && currentPlayer.originalBetAmount > 0 && 
            !currentPlayer.voluntaryExit && !currentPlayer.wasEaten) {
            try {
                const currentMoney = currentPlayer.getTotalMoney() || playerBetAmount;
                const maxMass = currentPlayer.massTotal || 0;

                if(sockets[socket.id]) sockets[currentPlayer.id].emit('kick', 'Desconexión inesperada.');
                console.log(`[DISCONNECT] Procesando cashout automático para ${currentPlayer.name} (desconexión no voluntaria)`);
                
                await processAutoCashout(
                    playerUserId,
                    currentPlayer.name,
                    currentMoney,
                    currentPlayer.originalBetAmount,
                    'disconnect',
                    maxMass
                );
            } catch (error) {
                console.error('[DISCONNECT] Error procesando cashout automático:', error);
            }
        } else if (currentPlayer.wasEaten) {
            console.log(`[DISCONNECT] ${currentPlayer.name} fue comido - no procesando cashout automático`);
        } else if (currentPlayer.voluntaryExit) {
            console.log(`[DISCONNECT] ${currentPlayer.name} se desconectó voluntariamente - no procesando cashout automático`);
        } else {
            console.log(`[DISCONNECT] ${currentPlayer.name} se desconectó sin apuesta activa`);
        }
        
        // Limpiar el mapeo de userId cuando el jugador se desconecta
        if (playerUserIds[socket.id]) {
            delete playerUserIds[socket.id];
        }

        map.players.removePlayerByID(currentPlayer.id);
        console.log('[INFO] User ' + currentPlayer.name + ' has disconnected');
        socket.broadcast.emit('playerDisconnect', { name: currentPlayer.name });
        
        // Actualizar estadísticas después de la desconexión
        emitStats();
        if(sockets[socket.id]) delete sockets[currentPlayer.id];
        if(playersStatsInGame[currentPlayer.userId]){
            let userID = currentPlayer.userId;
            let datosUsuarioDesconectado = playersStatsInGame[userID];
            delete playersStatsInGame[userID]; 
        }
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

    // Manejar desconexión voluntaria //TODO por?
    socket.on('voluntaryDisconnect', () => {
        console.log(`[VOLUNTARY_DISCONNECT] ${currentPlayer.name} notificó desconexión voluntaria`);
        currentPlayer.voluntaryExit = true;
    });

    // Manejar actualización de skin del jugador
    socket.on('updateSkin', (skinData) => {
        console.log(`[SKIN] ${currentPlayer.name} cambió a skin: ${skinData.skinName} (Hue: ${skinData.skinHue}, ID: ${skinData.skinId})`);
        
        // Actualizar el hue y skinId del jugador
        currentPlayer.hue = skinData.skinHue;
        currentPlayer.skinId = skinData.skinId;
        
        // Actualizar el hue y skinId de todas las células del jugador
        for (let cell of currentPlayer.cells) {
            cell.hue = skinData.skinHue;
            cell.skinId = skinData.skinId;
        }
        
        // Notificar a otros jugadores sobre el cambio de skin
        socket.broadcast.emit('playerSkinChanged', {
            playerId: currentPlayer.id,
            playerName: currentPlayer.name,
            skinName: skinData.skinName,
            hue: skinData.skinHue,
            skinId: skinData.skinId
        });
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
        console.log(`[FIREFOOD_START] ${currentPlayer.name} recibió evento fire food`);
        
        try {
            // Fire food con validación mejorada
            const minCellMass = config.defaultPlayerMass + config.fireFood;
            let cellsWithEnoughMass = 0;
            let totalMassBefore = currentPlayer.massTotal;
            
            console.log(`[FIREFOOD] ${currentPlayer.name} intentando disparar comida. Masa total: ${totalMassBefore}, Masa mínima requerida: ${minCellMass}`);
            
            // Verificar si el jugador tiene células válidas
            if (!currentPlayer.cells || currentPlayer.cells.length === 0) {
                console.log(`[FIREFOOD_ERROR] ${currentPlayer.name} no tiene células válidas`);
                return;
            }
            
            for (let i = 0; i < currentPlayer.cells.length; i++) {
                if (currentPlayer.cells[i].mass >= minCellMass) {
                    cellsWithEnoughMass++;
                    currentPlayer.changeCellMass(i, -config.fireFood);
                    map.massFood.addNew(currentPlayer, i, config.fireFood);
                    console.log(`[FIREFOOD] ${currentPlayer.name} disparó comida desde célula ${i}. Masa antes: ${currentPlayer.cells[i].mass + config.fireFood}, después: ${currentPlayer.cells[i].mass}`);
                }
            }
            
            if (cellsWithEnoughMass === 0) {
                console.log(`[FIREFOOD_WARNING] ${currentPlayer.name} no tiene células con masa suficiente (${minCellMass}+) para disparar comida`);
            } else {
                console.log(`[FIREFOOD_SUCCESS] ${currentPlayer.name} disparó comida desde ${cellsWithEnoughMass} célula(s)`);
            }
            
            console.log(`[FIREFOOD_END] ${currentPlayer.name} completó evento fire food exitosamente`);
        } catch (error) {
            console.error(`[FIREFOOD_ERROR] Error procesando fire food para ${currentPlayer.name}:`, error);
        }
    });

    socket.on('2', () => {
        currentPlayer.userSplit(config.limitSplit, config.defaultPlayerMass);
    });

    // Manejar división específica para cashout (4 partes)
    socket.on('split', (data) => {
        if (data && data.cellIndex !== undefined && data.pieces) {
            console.log(`[CASHOUT_SPLIT] ${currentPlayer.name} dividiendo célula ${data.cellIndex} en ${data.pieces} partes`);
            currentPlayer.splitCell(data.cellIndex, data.pieces, config.defaultPlayerMass);
        }
    });

    // Manejar inicio de cashout
    socket.on('cashoutStarted', (data) => {
        console.log(`[CASHOUT_STARTED] ${currentPlayer.name} inició cashout con $${data.betAmount}`);
        
        // Enviar alerta global usando el sistema combatAlert
        io.emit('combatAlert', {
            eaterName: currentPlayer.name,
            eatenName: 'CASHOUT',
            eaterId: currentPlayer.id,
            message: `¡${currentPlayer.name} inició cashout con $${data.betAmount}!`
        });
        
        console.log(`[CASHOUT_ALERT] Alerta global enviada: ${currentPlayer.name} (ID: ${currentPlayer.id}) inició cashout`);
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
                playersStatsInGame[clientPlayerData.userId]['actualMoney'] = moneyPerCell + (i < remainder ? 1 : 0);
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
        
        // Emitir estadísticas actuales al espectador
        emitStats();
    });

    socket.emit("welcome", currentPlayer, {
        width: config.gameWidth,
        height: config.gameHeight
    });
}

const tickPlayer = (currentPlayer) => {
    if(!sockets[currentPlayer.id]){
        console.log("QUE VAINA PASÓ?");
    }
    if (currentPlayer.lastHeartbeat < new Date().getTime() - config.maxHeartbeatInterval) {
        console.log(currentPlayer.id);
        if(sockets[currentPlayer.id]) sockets[currentPlayer.id].disconnect();
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
                    // Activar el poder en TODAS las células del jugador
                    for (let i = 0; i < currentPlayer.cells.length; i++) {
                        currentPlayer.cells[i].activatePower(powerFood.powerType, powerFood.duration, powerFood.multiplier);
                    }
                    
                    // Notificar al cliente sobre el poder activado
                    if (sockets[currentPlayer.id]) {
                        sockets[currentPlayer.id].emit('powerActivated', {
                            powerType: powerFood.powerType,
                            name: powerFood.name,
                            duration: powerFood.duration,
                            multiplier: powerFood.multiplier
                        });
                    }
                    
                    console.log(`[POWER] ${currentPlayer.name} comió ${powerFood.name} - ${powerFood.powerType} activado en todas las ${currentPlayer.cells.length} células`);
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
    // Limpiar sockets desconectados
    Object.keys(sockets).forEach(socketId => {
            //console.log(socketId);
        if ((!sockets[socketId] || !sockets[socketId].connected)) {
            console.log(socketId);
            // Remover de espectadores si está ahí
            const spectatorIndex = spectators.indexOf(socketId);
            if (spectatorIndex > -1) {
                spectators.splice(spectatorIndex, 1);
            }
        }
    });
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

        console.log(`[COMBAT] ${eaterPlayer.name} se come la célula ${gotEaten.cellIndex} de ${eatenPlayer.name}`);
        
        // Obtener dinero de la célula específica comida
        const cellMoney = cellGotEaten.gameMoney || 0;
        const cellMass = cellGotEaten.mass;
        
        // Transferir la masa de la célula comida a la célula que come
        eaterPlayer.changeCellMass(eater.cellIndex, cellMass);
        
        // Transferir el dinero de la célula comida a la célula que come
        if (cellMoney > 0) {
            const eaterCell = map.players.getCell(eater.playerIndex, eater.cellIndex);
            if (!eaterCell.gameMoney) {
                eaterCell.gameMoney = 0;
            }
            eaterCell.gameMoney += cellMoney;   
            playersStatsInGame[eaterPlayer.userId]['actualMoney'] += cellMoney;

            console.log(`[COMBAT_MONEY] Célula de ${eaterPlayer.name} recibió $${cellMoney} de la célula de ${eatenPlayer.name}`);
        }

        // DIVIDIR LA CÉLULA QUE COME en 4 partes
        console.log(`[COMBAT_DIVISION] Dividiendo célula de ${eaterPlayer.name} en 4 partes después de comer`);
        eaterPlayer.splitCell(eater.cellIndex, 4, config.defaultPlayerMass);
        
        // Notificar al jugador que come sobre la división
        if (sockets[eaterPlayer.id]) {
            const cellsData = eaterPlayer.cells.map((cell, index) => ({
                index: index,
                x: cell.x,
                y: cell.y,
                mass: cell.mass,
                radius: cell.radius,
                gameMoney: cell.gameMoney || 0
            }));
            
            sockets[eaterPlayer.id].emit('combatDivision', {
                cells: cellsData,
                totalMoney: eaterPlayer.getTotalMoney(),
                message: `¡Comiste una célula de ${eatenPlayer.name}! Tu célula se dividió en 4 partes.`
            });
        }
        
        // REMOVER SOLO LA CÉLULA ESPECÍFICA COMIDA (NO TODO EL JUGADOR)
        console.log(`[COMBAT] Removiendo célula ${gotEaten.cellIndex} de ${eatenPlayer.name} (tenía ${eatenPlayer.cells.length} células)`);
        eatenPlayer.removeCell(gotEaten.cellIndex);
        
        // VERIFICAR SI EL JUGADOR AÚN TIENE CÉLULAS
        if (eatenPlayer.cells.length === 0) {
            // Solo si NO tiene más células, eliminar al jugador
            console.log(`[COMBAT_GAME_OVER] ${eatenPlayer.name} perdió todas sus células - GAME OVER`);
            
            // Marcar al jugador como comido para evitar auto-cashout
            eatenPlayer.wasEaten = true;
            
            // GAME OVER para el jugador que perdió todas sus células
            if (sockets[eatenPlayer.id]) {
                playersStatsInGame[eatenPlayer.userId]['status'] = "eaten";
                playersStatsInGame[eatenPlayer.userId]['actualMoney'] = 0;
                sockets[eatenPlayer.id].emit('gameOver', {
                    message: '¡Perdiste! Te comieron todas tus células.',
                    finalMoney: 0 
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
        } else {
            // El jugador aún tiene células, solo perdió una
            console.log(`[COMBAT] ${eatenPlayer.name} perdió una célula, le quedan ${eatenPlayer.cells.length} células`);
            
            // Notificar al jugador que perdió una célula
            if (sockets[eatenPlayer.id]) {
                sockets[eatenPlayer.id].emit('cellLost', {
                    message: `Perdiste una célula. Te quedan ${eatenPlayer.cells.length} células.`,
                    remainingCells: eatenPlayer.cells.length,
                    totalMoney: eatenPlayer.getTotalMoney()
                });
            }
        }
        
        // ALERTA GLOBAL: Notificar a todos los jugadores sobre el combate
        // Enviar solo el ID del jugador para seguimiento en tiempo real
        io.emit('combatAlert', {
            eaterName: eaterPlayer.name,
            eatenName: eatenPlayer.name,
            eaterId: eaterPlayer.id, // ID del jugador para seguimiento en tiempo real
            message: `¡${eaterPlayer.name} se comió a ${eatenPlayer.name} y se dividió en 4 partes!`
        });
        
        console.log(`[COMBAT_ALERT] Alerta global enviada: ${eaterPlayer.name} (ID: ${eaterPlayer.id}) se comió a ${eatenPlayer.name}`);
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
    // Debug: Log cada 1000 updates para no saturar
    if (Math.random() < 0.001) {
        console.log('[SEND_UPDATES_DEBUG] Ejecutando sendUpdates');
    }
    // console.log('[SEND_UPDATES] Iniciando envío de actualizaciones...');
    spectators.forEach(updateSpectator);
    map.enumerateWhatPlayersSee(function (playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses, visiblePowerFood) {
        // Debug: Log cada 1000 enumerations para no saturar
        if (Math.random() < 0.001) {
            console.log(`[ENUMERATE_DEBUG] Enumerando para ${playerData.name}`);
        }
        // Obtener bombas visibles si el evento está activo
        let visibleBombs = [];
        if (bombManager && bombEventActive) {
            visibleBombs = bombManager.getBombs();
        }
        
        
        // Debug del servidor para ver qué jugadores se están enviando
        // console.log(`[SERVER_DEBUG] Enviando update a ${playerData.name} - Jugadores visibles: ${visiblePlayers.length}`);
        
        // Enviar información de todos los jugadores para el radar (no solo los visibles)
        const allPlayersData = map.players.data.map(player => {
            const playerData = {
                x: player.x,
                y: player.y,
                cells: player.cells.map(cell => ({
                    x: cell.x,
                    y: cell.y,
                    mass: cell.mass,
                    radius: cell.radius,
                    speed: cell.speed,
                    gameMoney: cell.gameMoney || 0,
                    isProtected: cell.isCurrentlyProtected(),
                    protectionTimeLeft: cell.getProtectionTimeLeft(),
                    hasShield: cell.hasShield()
                })),
                massTotal: Math.round(player.massTotal),
                hue: player.hue,
                id: player.id,
                name: player.name,
                gameMoney: player.getTotalMoney() || 0
            };
            
                            // console.log(`[RADAR_SERVER] Jugador ${player.name} en (${player.x}, ${player.y}) con ${player.cells.length} células`);
            return playerData;
        });
        
        // console.log(`[RADAR_SERVER] Enviando datos de ${allPlayersData.length} jugadores a ${playerData.name}`);
        
        // Debug: Log cada 1000 sends para no saturar
        if (Math.random() < 0.001) {
            console.log(`[SEND_DEBUG] Enviando serverTellPlayerMove a ${playerData.name}`);
        }
        sockets[playerData.id].emit('serverTellPlayerMove', playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses, visiblePowerFood, visibleBombs);
        
        // Enviar información de todos los jugadores para el radar
        // console.log(`[RADAR_SERVER] Enviando evento radarData a ${playerData.name}`);
        sockets[playerData.id].emit('radarData', allPlayersData);
        
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
    
    sockets[socketID].emit('serverTellPlayerMove', playerData, map.players.data, map.food.data, map.massFood.data, map.viruses.data, visibleBombs, null);
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
            playersStatsInGame[currentPlayer.id]['status'] = "autoCashout";
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

// Importar base de datos para historial de partidas
const db = require('./sql');

// Función para registrar el inicio de una partida
async function recordGameStart(userId, username, betAmount) {
    try {
        const startTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const connection = await db.getConnection();
        const [result] = await connection.execute(`INSERT INTO game_history (user_id, username, bet_amount, final_amount, start_time) 
                VALUES (?, ?, ?, ?, ?)`, 
                [userId, username, betAmount, betAmount, startTime]);
        connection.release();
        
        console.log(`[GAME_HISTORY] Partida iniciada para ${username} - ID: ${result.insertId}`);
        return result.insertId;
    } catch (err) {
        console.error('[GAME_HISTORY] Error registrando inicio de partida:', err);
        throw err;
    }
}

// Función para registrar el final de una partida (cashout)
async function recordGameEnd(gameId, finalAmount, resultType, commissionApplied, disconnectReason = 'manual_cashout', maxMass = 0) {
    const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        
        // Primero obtener la información de la partida para calcular duración
        const connection = await db.getConnection();
        const [rows] = await connection.execute(`SELECT start_time, bet_amount FROM game_history WHERE id = ?`, [gameId]);
        
        if (rows.length === 0) {
            console.error('[GAME_HISTORY] No se encontró la partida con ID:', gameId);
            connection.release();
            throw new Error('Partida no encontrada');
        }
        
        const row = rows[0];
        const startTime = new Date(row.start_time);
        const durationSeconds = Math.floor((new Date(endTime) - startTime) / 1000);
        const returnedAmount = finalAmount - commissionApplied;
        
        // Actualizar el registro con el final de la partida
        await connection.execute(`UPDATE game_history 
                SET final_amount = ?, returned_amount = ?, result_type = ?, 
                    commission_applied = ?, end_time = ?, duration_seconds = ?, 
                    max_mass_reached = ?, disconnect_reason = ?
                WHERE id = ?`, 
                [finalAmount, returnedAmount, resultType, commissionApplied, endTime, 
                 durationSeconds, maxMass, disconnectReason, gameId]);
        
        connection.release();
        
        console.log(`[GAME_HISTORY] Partida finalizada - ID: ${gameId}, Resultado: ${resultType}, Duración: ${durationSeconds}s`);
        return {
            gameId,
            resultType,
            finalAmount,
            returnedAmount,
            durationSeconds,
            disconnectReason
        };
}

// Función para obtener el historial de un usuario
async function getUserGameHistory(userId, limit = 50) {
    try {
        const connection = await db.getConnection();
        const [rows] = await connection.execute(`
            SELECT * FROM game_history 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ${parseInt(limit)}
        `, [userId]);
        connection.release();
        return rows;
    } catch (err) {
        console.error('[GAME_HISTORY] Error obteniendo historial:', err);
        throw err;
    }
}

// Función para procesar cashout automático en desconexión
async function processAutoCashout(userId, username, currentBetAmount, originalBetAmount, disconnectReason = 'disconnect', maxMass = 0) {
    try {
        console.log(`[AUTO_CASHOUT] Procesando cashout automático para ${username}`);
        console.log(`[AUTO_CASHOUT] Apuesta original: $${originalBetAmount}, Cantidad actual: $${currentBetAmount}`);
        
        let resultType, returnedAmount, commissionApplied = 0;
        
        // Aplicar la misma lógica que el cashout manual
        if (disconnectReason === 'eaten') {
            // JUGADOR COMIDO: Pérdida total, no se devuelve nada
            resultType = 'loss';
            returnedAmount = 0;
            console.log('[AUTO_CASHOUT] JUGADOR COMIDO - Pérdida total, no se devuelve nada');
        } else if (currentBetAmount === originalBetAmount) {
            // EMPATE
            resultType = 'tie';
            returnedAmount = originalBetAmount;
            console.log('[AUTO_CASHOUT] EMPATE - Devolviendo apuesta original');
        } else if (currentBetAmount < originalBetAmount) {
            // PÉRDIDA
            resultType = 'loss';
            returnedAmount = currentBetAmount;
            console.log('[AUTO_CASHOUT] PÉRDIDA - Devolviendo cantidad actual');
        } else {
            // GANANCIA
            resultType = 'win';
            const winnings = currentBetAmount - originalBetAmount;
            commissionApplied = winnings * 0.10; // 10% de comisión
            returnedAmount = currentBetAmount - commissionApplied;
            
            // Actualizar estadísticas globales
            globalWinnings += winnings;
            
            // Actualizar estadísticas en la base de datos
            updateGlobalStats(winnings, 0, 1)
                .then(() => {
                    // Actualizar leaderboard del jugador
                    const gameResult = {
                        winnings: winnings,
                        resultType: 'win',
                        betAmount: originalBetAmount
                    };
                    return updatePlayerLeaderboard(userId, username, gameResult);
                })
                .catch(err => {
                    console.error('[AUTO_CASHOUT] Error actualizando estadísticas:', err);
                });
            
            console.log('[AUTO_CASHOUT] GANANCIA - Aplicando comisión del 10%');
        }
        
        // Actualizar balance del usuario
        let newBalance;
        if (disconnectReason === 'eaten') {
            // Si el jugador fue comido, mantener el balance actual (ya se descontó al iniciar)
            newBalance = await authRepository.getUserBalance(userId);
            console.log('[AUTO_CASHOUT] Jugador comido - Balance mantenido:', newBalance);
        } else if (resultType === 'tie') {
            // En empate, devolver la apuesta original al balance
            newBalance = await authRepository.addWinnings(userId, originalBetAmount);
            console.log('[AUTO_CASHOUT] Empate - Apuesta devuelta al balance:', newBalance);
        } else {
            newBalance = await authRepository.addWinnings(userId, returnedAmount);
        }
        
        // Registrar en el historial (buscar la partida activa más reciente)
        try {
            const connection = await db.getConnection();
            const [rows] = await connection.execute(`
                SELECT id FROM game_history 
                WHERE user_id = ? AND result_type IS NULL 
                ORDER BY start_time DESC LIMIT 1
            `, [userId]);
            connection.release();
            
            if (rows.length > 0) {
                await recordGameEnd(rows[0].id, currentBetAmount, resultType, commissionApplied, disconnectReason, maxMass);
            }
        } catch (err) {
            console.error('[AUTO_CASHOUT] Error buscando partida activa:', err);
        }
        
        console.log(`[AUTO_CASHOUT] Cashout automático completado para ${username}`);
        console.log(`[AUTO_CASHOUT] Resultado: ${resultType}, Devuelto: $${returnedAmount}, Nuevo balance: $${newBalance}`);
        
        // Actualizar estadísticas en la base de datos para todas las partidas
        const gameResult = {
            winnings: resultType === 'win' ? (currentBetAmount - originalBetAmount) : 0,
            resultType: resultType,
            betAmount: originalBetAmount
        };
        
        // Solo actualizar estadísticas globales si no se actualizaron antes (para ganancias)
        if (resultType !== 'win') {
            updateGlobalStats(0, 0, 1)
                .then(() => {
                    return updatePlayerLeaderboard(userId, username, gameResult);
                })
                .catch(err => {
                    console.error('[AUTO_CASHOUT] Error actualizando estadísticas:', err);
                });
        } else {
            // Para ganancias, ya se actualizó arriba, solo actualizar leaderboard
            updatePlayerLeaderboard(userId, username, gameResult)
                .catch(err => {
                    console.error('[AUTO_CASHOUT] Error actualizando leaderboard:', err);
                });
        }
        
        // Emitir estadísticas actualizadas
        emitStats();
        
        return {
            resultType,
            returnedAmount,
            commissionApplied,
            newBalance
        };
        
    } catch (error) {
        console.error('[AUTO_CASHOUT] Error procesando cashout automático:', error);
        throw error;
    }
}



setInterval(tickGame, 1000 / 60);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / config.networkUpdateFactor);

// Don't touch, IP configurations.
var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || config.host;
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || config.port;
http.listen(serverport, ipaddress, async () => {
    console.log('[DEBUG] Listening on ' + ipaddress + ':' + serverport);
    
    // Cargar estadísticas globales desde la base de datos
    try {
        await loadGlobalStatsFromDB();
    } catch (error) {
        console.error('[GLOBAL_STATS] Error cargando estadísticas iniciales:', error);
    }
    
    // Iniciar el sistema de estadísticas en tiempo real
    startStatsUpdate();
    console.log('[STATS] Sistema de estadísticas en tiempo real iniciado');
});

// Endpoint para mostrar la página de pagos pendientes
app.get('/my-payments', (req, res) => {
    if (!req.user) {
        return res.redirect('/?error=login_required');
    }
    
    // Servir una página para mostrar pagos pendientes
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>My Payments - Splitta.io</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.tailwindcss.com"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        </head>
        <body class="bg-gradient-to-br from-blue-600 to-purple-700 min-h-screen">
            <div class="container mx-auto px-4 py-8">
                <div class="max-w-4xl mx-auto">
                    <div class="bg-white rounded-lg shadow-lg p-6 mb-6">
                        <div class="flex justify-between items-center mb-6">
                            <h1 class="text-3xl font-bold text-gray-800">💰 My Payments</h1>
                            <div class="flex space-x-4">
                                <a href="/add-funds" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors">
                                    ➕ New Payment
                                </a>
                                <a href="/" class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition-colors">
                                    🎮 Back to Game
                                </a>
                            </div>
                        </div>
                        
                        <div id="paymentsList" class="space-y-4">
                            <div class="text-center py-8">
                                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                                <p class="mt-2 text-gray-600">Loading payments...</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <script>
                // Función para obtener el estado del pago
                async function checkPaymentStatus(paymentId) {
                    try {
                        const response = await fetch(\`/api/payment-status?payment_id=\${paymentId}\`, {
                            method: 'GET',
                            credentials: 'include'
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            return data.status;
                        } else {
                            return 'error';
                        }
                    } catch (error) {
                        console.error('Error checking payment status:', error);
                        return 'error';
                    }
                }
                
                // Función para actualizar el estado de un pago
                async function updatePaymentStatus(paymentId, statusElement) {
                    const originalText = statusElement.textContent;
                    statusElement.textContent = 'Checking...';
                    statusElement.className = 'px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800';
                    
                    try {
                        const newStatus = await checkPaymentStatus(paymentId);
                        
                        // Actualizar el estado en la base de datos
                        await fetch('/api/update-payment-status', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ payment_id: paymentId, status: newStatus }),
                            credentials: 'include'
                        });
                        
                        // Actualizar la UI
                        statusElement.textContent = newStatus;
                        
                        if (newStatus === 'finished') {
                            statusElement.className = 'px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800';
                            // Recargar la página después de 2 segundos si el pago está completado
                            setTimeout(() => {
                                window.location.reload();
                            }, 2000);
                        } else if (newStatus === 'waiting' || newStatus === 'confirming') {
                            statusElement.className = 'px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800';
                        } else if (newStatus === 'failed' || newStatus === 'expired') {
                            statusElement.className = 'px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800';
                        } else {
                            statusElement.className = 'px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-800';
                        }
                    } catch (error) {
                        statusElement.textContent = originalText;
                        statusElement.className = 'px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800';
                    }
                }
                
                // Función para generar QR code
                function generateQRCode(container, data) {
                    container.innerHTML = '';
                    new QRCode(container, {
                        text: data,
                        width: 120,
                        height: 120,
                        colorDark: "#000000",
                        colorLight: "#ffffff",
                        correctLevel: QRCode.CorrectLevel.H
                    });
                }
                
                // Función para formatear fecha
                function formatDate(dateString) {
                    const date = new Date(dateString);
                    return date.toLocaleString();
                }
                
                // Función para obtener el color del estado
                function getStatusColor(status) {
                    switch (status) {
                        case 'finished':
                            return 'bg-green-100 text-green-800';
                        case 'waiting':
                        case 'confirming':
                            return 'bg-yellow-100 text-yellow-800';
                        case 'failed':
                        case 'expired':
                            return 'bg-red-100 text-red-800';
                        default:
                            return 'bg-gray-100 text-gray-800';
                    }
                }
                
                // Función para obtener el icono del estado
                function getStatusIcon(status) {
                    switch (status) {
                        case 'finished':
                            return '✅';
                        case 'waiting':
                            return '⏳';
                        case 'confirming':
                            return '🔄';
                        case 'failed':
                            return '❌';
                        case 'expired':
                            return '⏰';
                        default:
                            return '❓';
                    }
                }
                
                // Cargar pagos del usuario
                async function loadPayments() {
                    try {
                        const response = await fetch('/api/user-payments', {
                            method: 'GET',
                            credentials: 'include'
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            const paymentsList = document.getElementById('paymentsList');
                            
                            if (data.payments.length === 0) {
                                paymentsList.innerHTML = \`
                                    <div class="text-center py-8">
                                        <div class="text-6xl mb-4">💳</div>
                                        <h3 class="text-xl font-semibold text-gray-800 mb-2">No payments found</h3>
                                        <p class="text-gray-600 mb-4">You haven't made any payments yet.</p>
                                        <a href="/add-funds" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors">
                                            Make Your First Payment
                                        </a>
                                    </div>
                                \`;
                                return;
                            }
                            
                            paymentsList.innerHTML = data.payments.map(payment => \`
                                <div class="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                                    <div class="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 class="text-lg font-semibold text-gray-800">
                                                Payment #\${payment.id}
                                            </h3>
                                            <p class="text-sm text-gray-600">
                                                Created: \${formatDate(payment.createdAt)}
                                            </p>
                                        </div>
                                        <div class="flex items-center space-x-2">
                                            <span class="px-2 py-1 rounded text-xs font-medium \${getStatusColor(payment.status)}">
                                                \${getStatusIcon(payment.status)} \${payment.status}
                                            </span>
                                            <button onclick="updatePaymentStatus('\${payment.id}', this.previousElementSibling)" 
                                                    class="text-blue-600 hover:text-blue-800 text-sm">
                                                🔄
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <h4 class="font-semibold text-gray-700 mb-2">Payment Details</h4>
                                            <div class="space-y-1 text-sm">
                                                <p><strong>Amount:</strong> $\${payment.amount} USD</p>
                                                <p><strong>Crypto:</strong> \${payment.payCurrency.toUpperCase()}</p>
                                                <p><strong>Pay Amount:</strong> \${payment.payAmount} \${payment.payCurrency.toUpperCase()}</p>
                                                <p><strong>Address:</strong> <code class="bg-gray-100 px-1 rounded text-xs">\${payment.payAddress}</code></p>
                                            </div>
                                        </div>
                                        
                                        <div>
                                            <h4 class="font-semibold text-gray-700 mb-2">QR Code</h4>
                                            <div id="qr-\${payment.id}" class="flex justify-center"></div>
                                        </div>
                                    </div>
                                    
                                    <div class="mt-4 pt-4 border-t border-gray-200">
                                        <p class="text-xs text-gray-600">
                                            <strong>Order ID:</strong> \${payment.orderId}
                                        </p>
                                        <div class="mt-2">
                                            <button onclick="testPayment('\${payment.id}')" class="bg-purple-600 text-white px-3 py-1 rounded text-xs hover:bg-purple-700 transition-colors">
                                                🧪 Test Payment
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            \`).join('');
                            
                            // Generar QR codes para cada pago
                            data.payments.forEach(payment => {
                                const qrContainer = document.getElementById(\`qr-\${payment.id}\`);
                                if (qrContainer && payment.payAddress) {
                                    const qrData = \`\${payment.payCurrency}:\${payment.payAddress}?amount=\${payment.payAmount}\`;
                                    generateQRCode(qrContainer, qrData);
                                }
                            });
                        } else {
                            document.getElementById('paymentsList').innerHTML = \`
                                <div class="text-center py-8">
                                    <div class="text-6xl mb-4">❌</div>
                                    <h3 class="text-xl font-semibold text-gray-800 mb-2">Error loading payments</h3>
                                    <p class="text-gray-600">\${data.error}</p>
                                </div>
                            \`;
                        }
                    } catch (error) {
                        console.error('Error loading payments:', error);
                        document.getElementById('paymentsList').innerHTML = \`
                            <div class="text-center py-8">
                                <div class="text-6xl mb-4">❌</div>
                                <h3 class="text-xl font-semibold text-gray-800 mb-2">Error loading payments</h3>
                                <p class="text-gray-600">Please try again later.</p>
                            </div>
                        \`;
                    }
                }
                
                // Función para probar pago
                async function testPayment(paymentId) {
                    if (!confirm('¿Quieres simular que este pago se completó? Esto agregará los fondos a tu balance.')) {
                        return;
                    }
                    
                    try {
                        const response = await fetch('/api/test-payment', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ payment_id: paymentId })
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            alert('✅ Pago simulado completado!\\nNuevo balance: $' + data.newBalance + ' USD\\n\\nSerás redirigido al juego.');
                            setTimeout(() => {
                                window.location.href = '/?payment=success';
                            }, 2000);
                        } else {
                            alert('❌ Error: ' + data.error);
                        }
                    } catch (error) {
                        console.error('Error testing payment:', error);
                        alert('❌ Error al simular pago');
                    }
                }
                
                // Cargar pagos al cargar la página
                loadPayments();
            </script>
        </body>
        </html>
    `);
});

// Endpoint para pruebas - Simular pago completo
app.post('/api/test-payment', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        const { payment_id } = req.body;
        if (!payment_id) {
            return res.status(400).json({ error: 'Payment ID requerido' });
        }

        console.log(`[TEST] Simulando pago completado para: ${payment_id}`);

        // Simular pago completado
        const connection = await db.getConnection();
        const [updateResult] = await connection.execute(`UPDATE payments SET status = 'finished', updated_at = ? WHERE payment_id = ? AND user_id = ?`, 
            [new Date().toISOString().slice(0, 19).replace('T', ' '), payment_id, req.user.id]);
        
        if (updateResult.affectedRows === 0) {
            connection.release();
            return res.status(404).json({ error: 'Pago no encontrado' });
        }

        // Obtener el pago para agregar fondos
        const [payments] = await connection.execute(`SELECT * FROM payments WHERE payment_id = ?`, [payment_id]);
        connection.release();

        if (payments.length === 0) {
            console.error('[TEST] Error obteniendo pago');
            return res.status(500).json({ error: 'Error obteniendo pago' });
        }

        const payment = payments[0];

        try {
            // Agregar fondos al usuario
            const newBalance = await authRepository.addWinnings(req.user.id, payment.amount);
            console.log(`[TEST] ✅ Fondos agregados para usuario ${req.user.id}: $${payment.amount} USD, nuevo balance: $${newBalance}`);
            
            res.json({ 
                success: true, 
                message: 'Pago simulado completado exitosamente',
                newBalance: newBalance
            });
        } catch (error) {
            console.error('[TEST] Error agregando fondos:', error);
            res.status(500).json({ error: 'Error agregando fondos' });
        }

    } catch (error) {
        console.error('[TEST] Error en test-payment:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para actualizar el estado de un pago
app.post('/api/update-payment-status', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        const { payment_id, status } = req.body;
        
        if (!payment_id || !status) {
            return res.status(400).json({ error: 'Payment ID y status requeridos' });
        }

        console.log(`[NOWPAYMENTS] Actualizando estado del pago ${payment_id} a ${status}`);

        // Actualizar el estado en la base de datos
        const connection = await db.getConnection();
        const [result] = await connection.execute(`UPDATE payments SET status = ?, updated_at = ? WHERE payment_id = ? AND user_id = ?`, 
            [status, new Date().toISOString().slice(0, 19).replace('T', ' '), payment_id, req.user.id]);
        connection.release();

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Pago no encontrado' });
        }

        console.log(`[NOWPAYMENTS] Estado actualizado para pago ${payment_id}`);
        res.json({ success: true, message: 'Estado actualizado correctamente' });

    } catch (error) {
        console.error('[NOWPAYMENTS] Error en update-payment-status:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ===== IMPLEMENTACIÓN DE RETIROS CON NOWPAYMENTS =====

// Endpoint para obtener el mínimo de retiro
app.get('/api/withdrawal-minimum', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        const { crypto } = req.query;
        if (!crypto) {
            return res.status(400).json({ error: 'Criptomoneda requerida' });
        }

        console.log(`[WITHDRAWAL] Obteniendo mínimo de retiro para ${req.user.username}: ${crypto.toUpperCase()}`);

        // Configuración de NOWPayments
        const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
        const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';

        // Obtener el mínimo de retiro para la criptomoneda
        const minResponse = await fetch(`${NOWPAYMENTS_API_URL}/min-amount/${crypto}`, {
            method: 'GET',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY
            }
        });

        const minData = await minResponse.json();

        if (!minResponse.ok) {
            console.error('[WITHDRAWAL] Error obteniendo mínimo:', minData);
            return res.status(500).json({ error: 'Error obteniendo mínimo de retiro' });
        }

        console.log('[WITHDRAWAL] Mínimo de retiro:', minData);
        res.json(minData);

    } catch (error) {
        console.error('[WITHDRAWAL] Error en withdrawal-minimum:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para crear un retiro
app.post('/api/create-withdrawal', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        const { amount, crypto, wallet_address } = req.body;
        
        if (!amount || !crypto || !wallet_address) {
            return res.status(400).json({ error: 'Monto, criptomoneda y dirección de wallet requeridos' });
        }

        // Validar que el usuario tenga suficiente balance
        if (req.user.balance < amount) {
            return res.status(400).json({ error: 'Balance insuficiente' });
        }

        // Validar monto mínimo (por ejemplo, $10 USD)
        if (amount < 10) {
            return res.status(400).json({ error: 'Monto mínimo de retiro es $10 USD' });
        }

        console.log(`[WITHDRAWAL] Creando retiro para ${req.user.username}: $${amount} USD -> ${crypto.toUpperCase()}`);

        // Configuración de NOWPayments
        const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
        const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';

        // Verificar que la API esté disponible
        const statusResponse = await fetch(`${NOWPAYMENTS_API_URL}/status`, {
            method: 'GET',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY
            }
        });

        const statusData = await statusResponse.json();

        if (!statusResponse.ok) {
            console.error('[WITHDRAWAL] Error verificando API:', statusData);
            return res.status(500).json({ error: 'Error verificando API de NOWPayments' });
        }

        console.log('[WITHDRAWAL] API Status:', statusData);

        // Obtener estimación del monto en criptomoneda
        const estimateResponse = await fetch(`${NOWPAYMENTS_API_URL}/estimate?amount=${amount}&currency_from=usd&currency_to=${crypto}`, {
            method: 'GET',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY
            }
        });

        const estimateData = await estimateResponse.json();

        if (!estimateResponse.ok) {
            console.error('[WITHDRAWAL] Error obteniendo estimación:', estimateData);
            return res.status(500).json({ error: 'Error obteniendo estimación' });
        }

        console.log('[WITHDRAWAL] Estimación recibida:', estimateData);

        const cryptoAmount = estimateData.estimated_amount;

        // Crear el retiro usando la API de NOWPayments
        const withdrawalData = {
            amount: cryptoAmount,
            currency_from: crypto,
            currency_to: crypto,
            address: wallet_address,
            extra_id: req.user.id.toString(), // ID del usuario como referencia
            ipn_callback_url: `${req.protocol}://${req.get('host')}/api/withdrawal-webhook`
        };

        console.log('[WITHDRAWAL] Datos del retiro:', withdrawalData);

        const response = await fetch(`${NOWPAYMENTS_API_URL}/payout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': NOWPAYMENTS_API_KEY
            },
            body: JSON.stringify(withdrawalData)
        });

        const withdrawalResponse = await response.json();

        if (!response.ok) {
            console.error('[WITHDRAWAL] Error creando retiro:', withdrawalResponse);
            return res.status(500).json({ error: 'Error creando retiro' });
        }

        console.log(`[WITHDRAWAL] Retiro creado exitosamente - ID: ${withdrawalResponse.payout_id}`);

        // Generar ID único para el retiro
        const withdrawalId = `W${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Guardar el retiro en la base de datos
        const connection = await db.getConnection();
        await connection.execute(`INSERT INTO withdrawals (user_id, withdrawal_id, payout_id, amount, crypto_currency, crypto_amount, wallet_address, status, created_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`, 
            [req.user.id, withdrawalId, withdrawalResponse.payout_id, amount, crypto, cryptoAmount, wallet_address, new Date().toISOString().slice(0, 19).replace('T', ' ')]);

        console.log(`[WITHDRAWAL] Retiro guardado en BD`);

        // Descontar el monto del balance del usuario
        const newBalance = req.user.balance - amount;
        
        await connection.execute(`UPDATE users SET balance = ? WHERE id = ?`, [newBalance, req.user.id]);
        connection.release();

        console.log(`[WITHDRAWAL] Balance actualizado para usuario ${req.user.id}: $${newBalance}`);

        res.json({
            success: true,
            withdrawal_id: withdrawalId,
            payout_id: withdrawalResponse.payout_id,
            amount: amount,
            crypto_amount: cryptoAmount,
            crypto_currency: crypto,
            wallet_address: wallet_address,
            new_balance: newBalance,
            message: 'Retiro creado exitosamente'
        });

    } catch (error) {
        console.error('[WITHDRAWAL] Error en create-withdrawal:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para verificar el estado de un retiro
app.get('/api/withdrawal-status', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        const { withdrawal_id } = req.query;
        if (!withdrawal_id) {
            return res.status(400).json({ error: 'Withdrawal ID requerido' });
        }

        console.log(`[WITHDRAWAL] Verificando estado del retiro: ${withdrawal_id}`);

        // Obtener el retiro de la base de datos
        const connection = await db.getConnection();
        const [withdrawals] = await connection.execute(`SELECT * FROM withdrawals WHERE withdrawal_id = ? AND user_id = ?`, 
            [withdrawal_id, req.user.id]);
        connection.release();

        if (withdrawals.length === 0) {
            return res.status(404).json({ error: 'Retiro no encontrado' });
        }

        const withdrawal = withdrawals[0];
        console.log('[WITHDRAWAL] Estado del retiro:', withdrawal);
        res.json({
            success: true,
            withdrawal: withdrawal
        });

    } catch (error) {
        console.error('[WITHDRAWAL] Error en withdrawal-status:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para obtener estadísticas en tiempo real
app.get('/api/stats', (req, res) => {
    try {
        const stats = getCurrentStats();
        res.json({
            success: true,
            stats: stats
        });
    } catch (error) {
        console.error('[STATS] Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }
});

// Endpoint para obtener el leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const leaderboard = await getTopLeaderboard();
        res.json({
            success: true,
            leaderboard: leaderboard
        });
    } catch (error) {
        console.error('[LEADERBOARD] Error obteniendo leaderboard:', error);
        res.status(500).json({ error: 'Error obteniendo leaderboard' });
    }
});

// Endpoint para obtener el historial de retiros del usuario
app.get('/api/user-withdrawals', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        console.log(`[WITHDRAWAL] Obteniendo retiros para usuario: ${req.user.username}`);

        const connection = await db.getConnection();
        const [withdrawals] = await connection.execute(`SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC`, 
            [req.user.id]);
        connection.release();

        console.log(`[WITHDRAWAL] Retiros encontrados: ${withdrawals.length}`);

        res.json({
            success: true,
            withdrawals: withdrawals
        });

    } catch (error) {
        console.error('[WITHDRAWAL] Error en user-withdrawals:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Webhook para recibir notificaciones de retiros de NOWPayments
app.post('/api/withdrawal-webhook', async (req, res) => {
    try {
        const { payout_id, payment_status, pay_address, pay_amount, pay_currency, transaction_hash } = req.body;

        console.log(`[WITHDRAWAL_WEBHOOK] Webhook recibido - Payout ID: ${payout_id}, Status: ${payment_status}`);

        // Buscar el retiro en la base de datos
        const connection = await db.getConnection();
        const [withdrawals] = await connection.execute(`SELECT * FROM withdrawals WHERE payout_id = ?`, [payout_id]);
        
        if (withdrawals.length === 0) {
            console.error('[WITHDRAWAL_WEBHOOK] Retiro no encontrado en BD:', payout_id);
            connection.release();
            return res.status(404).send('Retiro no encontrado');
        }

        const withdrawal = withdrawals[0];

        // Actualizar el estado del retiro
        let newStatus = 'pending';
        if (payment_status === 'finished') {
            newStatus = 'completed';
        } else if (payment_status === 'failed' || payment_status === 'expired') {
            newStatus = 'failed';
        } else if (payment_status === 'confirming') {
            newStatus = 'processing';
        }

        await connection.execute(`UPDATE withdrawals SET status = ?, transaction_hash = ?, updated_at = ? WHERE payout_id = ?`, 
            [newStatus, transaction_hash || null, new Date().toISOString().slice(0, 19).replace('T', ' '), payout_id]);

        if (newStatus === 'completed') {
            console.log(`[WITHDRAWAL_WEBHOOK] ✅ Retiro completado exitosamente para usuario ${withdrawal.user_id}`);
        } else if (newStatus === 'failed') {
            console.log(`[WITHDRAWAL_WEBHOOK] ❌ Retiro fallido para usuario ${withdrawal.user_id}: ${payment_status}`);
        } else {
            console.log(`[WITHDRAWAL_WEBHOOK] ⏳ Retiro en progreso para usuario ${withdrawal.user_id}: ${payment_status}`);
        }

        connection.release();
        res.status(200).send('OK');

    } catch (error) {
        console.error('[WITHDRAWAL_WEBHOOK] Error en webhook:', error);
        res.status(500).send('Error');
    }
});
