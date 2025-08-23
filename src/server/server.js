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

// Endpoint para mostrar la página de Add Funds
app.get('/add-funds', (req, res) => {
    if (!req.user) {
        return res.redirect('/?error=login_required');
    }
    
    // Servir una página con selección de criptomonedas
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Add Funds - Splitta.io</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.tailwindcss.com"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        </head>
        <body class="bg-gray-900 text-gray-100 min-h-screen flex items-center justify-center">
          <div class="bg-gray-800 rounded-2xl shadow-2xl p-8 max-w-4xl w-full mx-4 flex flex-col md:flex-row gap-6">
            
            <!-- Sección principal (formulario) -->
            <div class="flex-1">
              <h1 class="text-3xl font-bold text-center mb-8">💰 Add Funds</h1>

              <form id="paymentForm" class="space-y-6">
                <div>
                  <label class="block text-sm font-medium mb-2 text-gray-300" id="amountLabel">Amount (USD)</label>
                  <input type="number" id="amount" min="10" step="0.01" value="10"
                    class="w-full p-4 bg-gray-700 border border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-100 placeholder-gray-400 transition">
                </div>

                <div>
                  <label class="block text-sm font-medium mb-2 text-gray-300">Select Cryptocurrency</label>
                  <select id="cryptoSelect"
                    class="w-full p-4 bg-gray-700 border border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-100">
                    <option value="">Loading cryptocurrencies...</option>
                  </select>
                </div>

                <div id="estimateInfo" class="hidden p-4 bg-gray-700 border border-gray-600 rounded-xl">
                  <div class="text-sm text-gray-200 space-y-1">
                    <div class="flex justify-between">
                      <span>You'll receive:</span>
                      <span id="estimatedAmount" class="font-medium text-blue-400">0.0000</span>
                    </div>
                    <div class="flex justify-between text-gray-400">
                      <span>Rate:</span>
                      <span id="exchangeRate">1 USD = 0.0000</span>
                    </div>
                  </div>
                </div>

                <button type="submit" id="submitBtn"
                  class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 rounded-xl shadow-md hover:shadow-lg transition">
                  Process Payment
                </button>
              </form>

              <a href="/" class="block text-center mt-6 text-blue-400 hover:text-blue-300 hover:underline transition">
                ← Back to Game
              </a>
            </div>

            <!-- Sección de Payment Info (ahora a la derecha en desktop) -->
            <div id="paymentDetails"
              class="hidden flex-1 p-5 bg-gray-800 border border-gray-700 rounded-xl self-start md:self-auto">
              <h3 class="text-lg font-semibold mb-3 text-gray-100 flex items-center gap-2">
                <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" stroke-width="2"
                  viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Payment Details
              </h3>
              <div id="paymentInfo" class="text-gray-300 text-sm leading-relaxed"></div>
              <div id="qrCode" class="mt-6 flex flex-col items-center gap-3 p-5 rounded-2xl bg-gray-700/50 border border-gray-600 shadow-inner transition"></div>
            </div>
          </div>

            
            <script>
                let selectedCrypto = 'btc';
                let availableCurrencies = [];
                
                // Cargar monedas disponibles al cargar la página
                async function loadCurrencies() {
                    try {
                        const response = await fetch('/api/currencies', {
                            method: 'GET',
                            credentials: 'include'
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            availableCurrencies = data.currencies;
                            renderCryptoOptions();
                        }
                    } catch (error) {
                        console.error('Error loading currencies:', error);
                    }
                }
                
                // Renderizar opciones de criptomonedas
                function renderCryptoOptions() {
                    const select = document.getElementById('cryptoSelect');
                    
                    // Limpiar opciones existentes
                    select.innerHTML = '';
                    
                    // Agregar opción por defecto
                    const defaultOption = document.createElement('option');
                    defaultOption.value = '';
                    defaultOption.textContent = 'Select a cryptocurrency...';
                    select.appendChild(defaultOption);
                    
                    // Ordenar monedas: populares primero, luego alfabéticamente
                    const popularCurrencies = ['usdtmatic', 'btc', 'eth', 'usdtsol', 'usdtpol', 'usdttrc20', 'usdterc20', 'doge', 'ltc', 'bnb', 'ada', 'xrp'];
                    const sortedCurrencies = [];
                    
                    // Agregar monedas populares primero
                    popularCurrencies.forEach(crypto => {
                        if (availableCurrencies.includes(crypto)) {
                            sortedCurrencies.push(crypto);
                        }
                    });
                    
                    // Agregar el resto de monedas alfabéticamente
                    availableCurrencies.forEach(crypto => {
                        if (!sortedCurrencies.includes(crypto)) {
                            sortedCurrencies.push(crypto);
                        }
                    });
                    
                    // Crear opciones para el selector
                    sortedCurrencies.forEach(crypto => {
                        const option = document.createElement('option');
                        option.value = crypto;
                        
                        // Nombres amigables para monedas populares
                        const friendlyNames = {
                            'usdtmatic': '💎 Tether Polygon (USDTMATIC) - Min $1',
                            'btc': '₿ Bitcoin (BTC)',
                            'eth': 'Ξ Ethereum (ETH)',
                            'usdtsol': '💎 Tether Solana (USDTSOL) - Min $1',
                            'usdtpol': '💎 Tether Polygon (USDTPOL) - Min $1',
                            'usdttrc20': '💎 Tether TRC20 (USDTTRC20) - Min $5',
                            'usdterc20': '💎 Tether ERC20 (USDTERC20) - Min $5',
                            'doge': '🐕 Dogecoin (DOGE)',
                            'ltc': 'Ł Litecoin (LTC)',
                            'bnb': '🟡 BNB (BNB)',
                            'ada': '🔷 Cardano (ADA)',
                            'xrp': '💎 Ripple (XRP)'
                        };
                        
                                                 option.textContent = friendlyNames[crypto] || \`\${crypto.toUpperCase()}\`;
                         select.appendChild(option);
                     });
                     
                     // Seleccionar USDTMATIC por defecto
                     select.value = 'usdtmatic';
                     selectedCrypto = 'usdtmatic';
                     updateInterfaceForCrypto();
                 }
                
                // Función para actualizar la interfaz según la criptomoneda seleccionada
                function updateInterfaceForCrypto() {
                    const amountLabel = document.getElementById('amountLabel');
                    const amountInput = document.getElementById('amount');
                    const estimateInfo = document.getElementById('estimateInfo');

		    amountLabel.textContent = 'Amount (USDT)';

		    const c = selectedCrypto;

                    if (selectedCrypto === 'usdtmatic') {
                        amountInput.min = '1';
                        amountInput.value = '1';
//                        estimateInfo.classList.add('hidden');
	            } else if ((c.includes("usdt") || c.includes("usdc") || c.includes("fdusd")) && (c.includes("BSC") || c.includes("SOL"))) {
                        amountInput.min = '5';
                        amountInput.value = '5';
                    } else {
                        amountInput.min = '15';
                        amountInput.value = '15';
                        updateEstimate();
                    }
		    updateEstimate();
                }
                
                // Actualizar estimación cuando cambie el monto
                document.getElementById('amount').addEventListener('input', updateEstimate);
                
                // Actualizar cuando cambie la criptomoneda seleccionada
                document.getElementById('cryptoSelect').addEventListener('change', function() {
                    selectedCrypto = this.value;
                    updateInterfaceForCrypto();
                });
                
                async function updateEstimate() {
                    const amount = document.getElementById('amount').value;
                    if (!amount || amount < 10) return;
                    
                    // No hacer estimación para USDT
//                    if (selectedCrypto === 'usdtmatic' || selectedCrypto === 'usdtsol' || selectedCrypto === 'usdtpol' || selectedCrypto === 'usdttrc20' || selectedCrypto === 'usdterc20') return;
                    
                    try {
                        const response = await fetch(\`/api/estimate?amount=\${amount}&crypto=\${selectedCrypto}\`, {
                            method: 'GET',
                            credentials: 'include'
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            document.getElementById('estimateInfo').classList.remove('hidden');
                            document.getElementById('estimatedAmount').textContent = data.estimated_amount + ' ' + selectedCrypto.toUpperCase();
                            document.getElementById('exchangeRate').textContent = \`1 USD = \${data.rate}\`;
                        }
                    } catch (error) {
                        console.error('Error getting estimate:', error);
                    }
                }
                
                document.getElementById('paymentForm').addEventListener('submit', async function(e) {
                    e.preventDefault();
                    
                    const amount = document.getElementById('amount').value;
                    const submitBtn = document.getElementById('submitBtn');
                    
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Processing...';
                    
                    try {
                        const response = await fetch('/api/create-payment', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ 
                                amount: parseFloat(amount),
                                crypto: selectedCrypto
                            }),
                            credentials: 'include'
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            document.getElementById('paymentDetails').classList.remove('hidden');
                            document.getElementById('paymentInfo').innerHTML = \`
                                <p><strong>Payment ID:</strong> \${data.payment.id}</p>
                                <!-- <p><strong>Amount:</strong> \${data.payment.priceAmount} USD</p> -->
                                <p><strong>Monto a pagar:</strong> \${data.payment.payAmount} \${data.payment.payCurrency.toUpperCase()}</p>
                                <p><strong>Address:</strong> <code class="bg-gray-200 px-2 py-1 rounded">\${data.payment.payAddress}</code></p>
                                <p class="text-sm text-gray-600 mt-2">Please send the exact amount to the address above. Your balance will be updated automatically once the payment is confirmed.</p>
                                <div class="mt-4 flex justify-center">
                                  <button id="checkStatusBtn"
                                      class="flex items-center justify-center gap-2 px-5 py-3 rounded-xl 
                                             bg-gradient-to-r from-green-500 to-emerald-600 
                                             hover:from-green-600 hover:to-emerald-700 
                                             text-white font-semibold text-sm shadow-lg 
                                             hover:shadow-xl transition-all transform hover:scale-105 active:scale-95">
                                      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v6h6M20 20v-6h-6M4 20h6v-6M20 4h-6v6" />
                                      </svg>
                                      Check Payment Status
                                  </button>
                                </div>
                            \`;
                            
                            // Generar QR code
                            if (data.payment.qrCode) {
                                const qrContainer = document.getElementById('qrCode');
                                qrContainer.innerHTML = '';
                                new QRCode(qrContainer, {
                                    text: data.payment.qrCode,
                                    width: 200,
                                    height: 200,
                                    colorDark: "#000000",
                                    colorLight: "#ffffff",
                                    correctLevel: QRCode.CorrectLevel.H
                                });
                            }
                            
                            submitBtn.textContent = 'Payment Created Successfully';
                            
                            // Agregar funcionalidad para verificar estado
                            document.getElementById('checkStatusBtn').addEventListener('click', async function() {
                                this.disabled = true;
                                this.textContent = 'Checking...';
                                
                                try {
                                    const statusResponse = await fetch(\`/api/payment-status?payment_id=\${data.payment.id}\`, {
                                        method: 'GET',
                                        credentials: 'include'
                                    });
                                    
                                    const statusData = await statusResponse.json();
                                    
                                    if (statusData.success) {
                                        this.textContent = \`Status: \${statusData.status}\`;
                                        this.className = statusData.status === 'finished' ? 
                                            'mt-3 bg-green-600 text-white px-4 py-2 rounded text-sm' : 
                                            'mt-3 bg-yellow-600 text-white px-4 py-2 rounded text-sm';
                                        
                                        if (statusData.status === 'finished') {
                                            // Mostrar mensaje de éxito
                                            document.getElementById('paymentInfo').innerHTML += \`
                                                <div class="mt-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
                                                    <strong>✅ Payment Completed!</strong><br>
                                                    Your balance has been updated. Redirecting to game...
                                                </div>
                                            \`;
                                            setTimeout(() => {
                                                window.location.href = '/?payment=success';
                                            }, 3000);
                                        }
                                    } else {
                                        this.textContent = 'Error checking status';
                                        this.className = 'mt-3 bg-red-600 text-white px-4 py-2 rounded text-sm';
                                    }
                                } catch (error) {
                                    this.textContent = 'Error checking status';
                                    this.className = 'mt-3 bg-red-600 text-white px-4 py-2 rounded text-sm';
                                }
                            });
                            
                            // Verificación automática cada 30 segundos
                            let checkInterval = setInterval(async function() {
                                try {
                                    const statusResponse = await fetch(\`/api/payment-status?payment_id=\${data.payment.id}\`, {
                                        method: 'GET',
                                        credentials: 'include'
                                    });
                                    
                                    const statusData = await statusResponse.json();
                                    
                                    if (statusData.success && statusData.status === 'finished') {
                                        clearInterval(checkInterval);
                                        
                                        // Mostrar mensaje de éxito automático
                                        document.getElementById('paymentInfo').innerHTML += \`
                                            <div class="mt-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
                                                <strong>🎉 Payment Completed Automatically!</strong><br>
                                                Your balance has been updated. Redirecting to game...
                                            </div>
                                        \`;
                                        
                                        setTimeout(() => {
                                            window.location.href = '/?payment=success';
                                        }, 3000);
                                    }
                                } catch (error) {
                                    console.error('Auto-check error:', error);
                                }
                            }, 30000); // Verificar cada 30 segundos
                        } else {
                            alert('Error: ' + data.error);
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Process Payment';
                        }
                    } catch (error) {
                        console.error('Error:', error);
                        alert('Error processing payment. Please try again.');
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Process Payment';
                    }
                });
                
                // Cargar monedas al iniciar
                loadCurrencies();
            </script>
        </body>
        </html>
    `);
});

// ===== NUEVA IMPLEMENTACIÓN DE PAGOS CON NOWPAYMENTS =====

// Endpoint para obtener monedas disponibles
app.get('/api/currencies', async (req, res) => {
    try {
        console.log('[NOWPAYMENTS] Obteniendo monedas disponibles');
        
        // Configuración de NOWPayments
        const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || '9Y86N0F-CB34G0D-KMB5ZAZ-JZR9J46';
        const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';

        // Obtener monedas disponibles
        const currenciesResponse = await fetch(`${NOWPAYMENTS_API_URL}/currencies`, {
            method: 'GET',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY
            }
        });
        
        const currenciesData = await currenciesResponse.json();
        console.log('[NOWPAYMENTS] Monedas disponibles:', currenciesData);
        
        if (!currenciesResponse.ok) {
            console.error('[NOWPAYMENTS] Error obteniendo monedas:', currenciesData);
            return res.status(500).json({ error: 'Error obteniendo monedas disponibles' });
        }

        res.json({
            success: true,
            currencies: currenciesData.currencies || []
        });

    } catch (error) {
        console.error('[NOWPAYMENTS] Error en currencies:', error);
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
        const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || '9Y86N0F-CB34G0D-KMB5ZAZ-JZR9J46';
        const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';

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
            adjustedAmount = Math.max(amount, 2); // Mínimo $1 USDT en Polygon
            fixedRate = false;
            feePaidByUser = false;
        }
        // Configuración especial para USDTERC20
        else if ((c.includes("usdt") || c.includes("usdc") || c.includes("fdusd")) && (c.includes("BSC") || c.includes("SOL"))) {
            adjustedAmount = Math.max(amount, 5); // Mínimo $5 USDT en ERC20
        }
        // Si la criptomoneda es USDT (pero no USDTMATIC), usar la misma criptomoneda como moneda de precio
        else {
            adjustedAmount = Math.max(amount, 15); // Mínimo $5 USDT para otros
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

        // Agregar payout_address y payout_currency solo para USDTMATIC
        if (crypto.toLowerCase() === 'usdtmatic') {
            paymentData.payout_address = '0x9d2fd4bdb798ac2cd108c5435564ceeeb28d1178';
            paymentData.payout_currency = 'usdtmatic';
        }



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
        db.run(`INSERT INTO payments (
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
            new Date().toISOString()
        ], function(err) {
            if (err) {
                console.error('[NOWPAYMENTS] Error guardando pago en BD:', err);
            } else {
                console.log(`[NOWPAYMENTS] Pago guardado en BD - ID: ${this.lastID}`);
            }
        });

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
        const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || '9Y86N0F-CB34G0D-KMB5ZAZ-JZR9J46';
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
        db.all(`SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`, [req.user.id], (err, payments) => {
            if (err) {
                console.error('[NOWPAYMENTS] Error obteniendo pagos:', err);
                return res.status(500).json({ error: 'Error obteniendo pagos' });
            }

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
        db.get(`SELECT * FROM payments WHERE payment_id = ?`, [payment_id], async (err, payment) => {
            if (err) {
                console.error('[NOWPAYMENTS] Error verificando pago:', err);
                return res.status(500).send('Error');
            }

            if (!payment) {
                console.error('[NOWPAYMENTS] Pago no encontrado en BD:', payment_id);
                return res.status(404).send('Payment not found');
            }

            // Actualizar estado del pago
            db.run(`UPDATE payments SET 
                status = ?, 
                pay_amount = ?, 
                updated_at = ? 
                WHERE payment_id = ?`, 
                [payment_status, actually_paid || pay_amount, new Date().toISOString(), payment_id], 
                async function(err) {
                    if (err) {
                        console.error('[NOWPAYMENTS] Error actualizando pago:', err);
                        return res.status(500).send('Error');
                    }

                    // Si el pago está confirmado o finalizado, agregar fondos al usuario
                    if (payment_status === 'confirmed' || payment_status === 'finished' || payment_status === 'sending') {
                        try {
                            // Usar el monto realmente pagado en USD
                            const amountToAdd = actually_paid_at_fiat || price_amount || payment.amount;
                            const newBalance = await authRepository.addWinnings(payment.user_id, amountToAdd);
                            console.log(`[NOWPAYMENTS] ✅ Fondos agregados para usuario ${payment.user_id}: $${amountToAdd} USD, nuevo balance: $${newBalance}`);
                            
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

                    res.status(200).send('OK');
                });
        });

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

app.post('/api/voluntaryDisconnect', async (req, res) => {
    try {
        const sessionToken = req.headers.authorization?.replace('Bearer ', '');
        const { betAmount, maxMass, duration } = req.body;
        
        console.log('[API] /api/voluntaryDisconnect recibido');
        console.log('[API] Dinero en juego (betAmount):', betAmount);
        console.log('[API] Masa máxima (maxMass):', maxMass);
        console.log('[API] Duración (duration):', duration);
        
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
        let resultType, commissionApplied = 0;

        console.log('[API] === LÓGICA DE CASHOUT SIMPLIFICADA ===');
        console.log('[API] Apuesta original:', originalBet);
        console.log('[API] Dinero en juego:', betAmount);

        // Lógica de cashout simplificada según tus reglas
        if (betAmount === originalBet) {
            // EMPATE: No se cambia el balance, pero se devuelve la apuesta original al jugador.
            console.log('[API] EMPATE - Balance sin cambios. Devolviendo apuesta original.');
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
            const winnings = betAmount - originalBet;
            commissionApplied = Math.round(winnings * 0.1 * 100) / 100;
            const netWinnings = winnings - commissionApplied;
            returnedAmount = originalBet + netWinnings;
            
            console.log(`[API] Ganancia neta: $${winnings} | Comisión (10%): $${commissionApplied} | Ganancia neta final: $${netWinnings}`);
        }
        
        if (returnedAmount > 0) {
            finalBalance = await authRepository.addWinnings(user.id, returnedAmount);
        }
        
        // Registrar en el historial (buscar la partida activa más reciente)
        try {
            const gameRow = await new Promise((resolve, reject) => {
                db.get(`SELECT id FROM game_history 
                        WHERE user_id = ? AND result_type IS NULL 
                        ORDER BY start_time DESC LIMIT 1`, 
                        [user.id], 
                        (err, row) => {
                            if (err) {
                                console.error('[API] Error buscando partida activa:', err);
                                reject(err);
                            } else {
                                resolve(row);
                            }
                        });
            });
            
            if (gameRow) {
                console.log(`[API] Encontrada partida activa - ID: ${gameRow.id}`);
                await recordGameEnd(gameRow.id, betAmount, resultType, commissionApplied, 'manual_cashout', maxMass || 0);
                console.log(`[API] Partida registrada en historial - ID: ${gameRow.id}, Resultado: ${resultType}, Masa: ${maxMass}, Duración: ${duration}`);
            } else {
                console.log(`[API] No se encontró partida activa para el usuario ${user.id}`);
            }
        } catch (error) {
            console.error('[API] Error registrando en historial:', error);
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
        console.log('[SKIN_DEBUG] Datos recibidos del cliente:', JSON.stringify(clientPlayerData, null, 2));
        
        if (map.players.findIndexByID(socket.id) > -1) {
            console.log('[INFO] Player ID is already connected, kicking.');
            socket.disconnect();
        } else if (!util.validNick(clientPlayerData.name)) {
            console.log(`[VALIDATION_ERROR] Nombre inválido: "${clientPlayerData.name}" - Longitud: ${clientPlayerData.name.length}`);
            socket.emit('kick', 'Invalid username.');
            socket.disconnect();
        } else {
            console.log('[INFO] Player ' + clientPlayerData.name + ' connected!');
            sockets[socket.id] = socket;

            const sanitizedName = clientPlayerData.name.replace(/(<([^>]+)>)/ig, '');
            clientPlayerData.name = sanitizedName;

            // Guardar información del usuario y apuesta ANTES de inicializar
            playerUserId = clientPlayerData.userId;
            playerUserIds[socket.id] = clientPlayerData.userId; // Guardar en el mapeo global
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
            currentPlayer.init(generateSpawnpoint(), config.defaultPlayerMass);
            
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
            
            map.players.pushNew(currentPlayer);
            
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



    socket.on('disconnect', async () => {
        // Solo procesar cashout automático si NO es una desconexión voluntaria
        // y el jugador tenía una apuesta activa
        if (playerUserId && playerBetAmount > 0 && currentPlayer.originalBetAmount > 0 && !currentPlayer.voluntaryExit) {
            try {
                const currentMoney = currentPlayer.getTotalMoney() || playerBetAmount;
                const maxMass = currentPlayer.massTotal || 0;
                
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

    // Manejar desconexión voluntaria
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

        // NUEVA LÓGICA: La célula que come se divide en 4 partes
        const eaterCell = map.players.getCell(eater.playerIndex, eater.cellIndex);
        console.log(`[COMBAT_DIVISION] ${eaterPlayer.name} se come a ${eatenPlayer.name} - dividiendo célula que come en 4 partes`);
        
        // Dividir la célula que come en 4 partes
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
                message: `¡Comiste a ${eatenPlayer.name}! Tu célula se dividió en 4 partes.`
            });
        }

        // NUEVA LÓGICA: Solo transferir todo el dinero al final, sin cálculos intermedios
        console.log(`[COMBAT_MONEY] ${eaterPlayer.name} se come a ${eatenPlayer.name} - transferencia completa de dinero al final`);

        // Transferir toda la masa de la célula comida a la célula que come
        eaterPlayer.changeCellMass(eater.cellIndex, cellGotEaten.mass);

        // NUEVO SISTEMA: GAME OVER inmediato para el jugador comido
        console.log(`[COMBAT_GAME_OVER] ${eatenPlayer.name} fue comido - GAME OVER inmediato`);
        
        // Transferir todo el dinero restante del jugador comido al jugador que come
        const remainingMoney = eatenPlayer.getTotalMoney();
        if (remainingMoney > 0) {
            // Asignar todo el dinero a la primera célula del jugador que come
            if (eaterPlayer.cells.length > 0) {
                if (!eaterPlayer.cells[0].gameMoney) {
                    eaterPlayer.cells[0].gameMoney = 0;
                }
                eaterPlayer.cells[0].gameMoney += remainingMoney;
                console.log(`[COMBAT_MONEY] ${eaterPlayer.name} recibió $${remainingMoney} completo de ${eatenPlayer.name}`);
            }
        }
        
        // GAME OVER para el jugador comido
        if (sockets[eatenPlayer.id]) {
            sockets[eatenPlayer.id].emit('gameOver', {
                message: '¡Perdiste! Fuiste comido por otro jugador.',
                finalMoney: remainingMoney
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
            // console.log('[SEND_UPDATES] Iniciando envío de actualizaciones...');
    spectators.forEach(updateSpectator);
    map.enumerateWhatPlayersSee(function (playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses, visiblePowerFood) {
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

// Importar base de datos para historial de partidas
const db = require('./sql');

// Función para registrar el inicio de una partida
function recordGameStart(userId, username, betAmount) {
    return new Promise((resolve, reject) => {
        const startTime = new Date().toISOString();
        db.run(`INSERT INTO game_history (user_id, username, bet_amount, final_amount, start_time) 
                VALUES (?, ?, ?, ?, ?)`, 
                [userId, username, betAmount, betAmount, startTime], 
                function(err) {
                    if (err) {
                        console.error('[GAME_HISTORY] Error registrando inicio de partida:', err);
                        reject(err);
                    } else {
                        console.log(`[GAME_HISTORY] Partida iniciada para ${username} - ID: ${this.lastID}`);
                        resolve(this.lastID);
                    }
                });
    });
}

// Función para registrar el final de una partida (cashout)
function recordGameEnd(gameId, finalAmount, resultType, commissionApplied, disconnectReason = 'manual_cashout', maxMass = 0) {
    return new Promise((resolve, reject) => {
        const endTime = new Date().toISOString();
        
        // Primero obtener la información de la partida para calcular duración
        db.get(`SELECT start_time, bet_amount FROM game_history WHERE id = ?`, [gameId], (err, row) => {
            if (err) {
                console.error('[GAME_HISTORY] Error obteniendo datos de partida:', err);
                reject(err);
                return;
            }
            
            if (!row) {
                console.error('[GAME_HISTORY] No se encontró la partida con ID:', gameId);
                reject(new Error('Partida no encontrada'));
                return;
            }
            
            const startTime = new Date(row.start_time);
            const durationSeconds = Math.floor((new Date(endTime) - startTime) / 1000);
            const returnedAmount = finalAmount - commissionApplied;
            
            // Actualizar el registro con el final de la partida
            db.run(`UPDATE game_history 
                    SET final_amount = ?, returned_amount = ?, result_type = ?, 
                        commission_applied = ?, end_time = ?, duration_seconds = ?, 
                        max_mass_reached = ?, disconnect_reason = ?
                    WHERE id = ?`, 
                    [finalAmount, returnedAmount, resultType, commissionApplied, endTime, 
                     durationSeconds, maxMass, disconnectReason, gameId], 
                    function(err) {
                        if (err) {
                            console.error('[GAME_HISTORY] Error registrando final de partida:', err);
                            reject(err);
                        } else {
                            console.log(`[GAME_HISTORY] Partida finalizada - ID: ${gameId}, Resultado: ${resultType}, Duración: ${durationSeconds}s`);
                            resolve({
                                gameId,
                                resultType,
                                finalAmount,
                                returnedAmount,
                                durationSeconds,
                                disconnectReason
                            });
                        }
                    });
        });
    });
}

// Función para obtener el historial de un usuario
function getUserGameHistory(userId, limit = 50) {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM game_history 
                WHERE user_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?`, 
                [userId, limit], 
                (err, rows) => {
                    if (err) {
                        console.error('[GAME_HISTORY] Error obteniendo historial:', err);
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                });
    });
}

// Función para procesar cashout automático en desconexión
async function processAutoCashout(userId, username, currentBetAmount, originalBetAmount, disconnectReason = 'disconnect', maxMass = 0) {
    try {
        console.log(`[AUTO_CASHOUT] Procesando cashout automático para ${username}`);
        console.log(`[AUTO_CASHOUT] Apuesta original: $${originalBetAmount}, Cantidad actual: $${currentBetAmount}`);
        
        let resultType, returnedAmount, commissionApplied = 0;
        
        // Aplicar la misma lógica que el cashout manual
        if (currentBetAmount === originalBetAmount) {
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
            console.log('[AUTO_CASHOUT] GANANCIA - Aplicando comisión del 10%');
        }
        
        // Actualizar balance del usuario
        const newBalance = await updateUserBalance(userId, returnedAmount);
        
        // Registrar en el historial (buscar la partida activa más reciente)
        db.get(`SELECT id FROM game_history 
                WHERE user_id = ? AND result_type IS NULL 
                ORDER BY start_time DESC LIMIT 1`, 
                [userId], 
                async (err, row) => {
                    if (err) {
                        console.error('[AUTO_CASHOUT] Error buscando partida activa:', err);
                        return;
                    }
                    
                    if (row) {
                        await recordGameEnd(row.id, currentBetAmount, resultType, commissionApplied, disconnectReason, maxMass);
                    }
                });
        
        console.log(`[AUTO_CASHOUT] Cashout automático completado para ${username}`);
        console.log(`[AUTO_CASHOUT] Resultado: ${resultType}, Devuelto: $${returnedAmount}, Nuevo balance: $${newBalance}`);
        
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

// Función para actualizar balance de usuario
function updateUserBalance(userId, amount) {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE users SET balance = balance + ? WHERE id = ?`, [amount, userId], function(err) {
            if (err) {
                console.error('[AUTO_CASHOUT] Error actualizando balance:', err);
                reject(err);
            } else {
                // Obtener el nuevo balance
                db.get(`SELECT balance FROM users WHERE id = ?`, [userId], (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row.balance);
                    }
                });
            }
        });
    });
}

setInterval(tickGame, 1000 / 60);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / config.networkUpdateFactor);

// Don't touch, IP configurations.
var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || config.host;
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || config.port;
http.listen(serverport, ipaddress, () => console.log('[DEBUG] Listening on ' + ipaddress + ':' + serverport));

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
        db.run(`UPDATE payments SET status = 'finished', updated_at = ? WHERE payment_id = ? AND user_id = ?`, 
            [new Date().toISOString(), payment_id, req.user.id], 
            async function(err) {
                if (err) {
                    console.error('[TEST] Error actualizando estado:', err);
                    return res.status(500).json({ error: 'Error actualizando estado' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Pago no encontrado' });
                }

                // Obtener el pago para agregar fondos
                db.get(`SELECT * FROM payments WHERE payment_id = ?`, [payment_id], async (err, payment) => {
                    if (err || !payment) {
                        console.error('[TEST] Error obteniendo pago:', err);
                        return res.status(500).json({ error: 'Error obteniendo pago' });
                    }

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
                });
            });

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
        db.run(`UPDATE payments SET status = ?, updated_at = ? WHERE payment_id = ? AND user_id = ?`, 
            [status, new Date().toISOString(), payment_id, req.user.id], 
            function(err) {
                if (err) {
                    console.error('[NOWPAYMENTS] Error actualizando estado:', err);
                    return res.status(500).json({ error: 'Error actualizando estado' });
                }

                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Pago no encontrado' });
                }

                console.log(`[NOWPAYMENTS] Estado actualizado para pago ${payment_id}`);
                res.json({ success: true, message: 'Estado actualizado correctamente' });
            });

    } catch (error) {
        console.error('[NOWPAYMENTS] Error en update-payment-status:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});
