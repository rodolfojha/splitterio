/*jslint bitwise: true, node: true */
/* Radar System - Updated: 2024-01-27 */
'use strict';

var io = require('socket.io-client');
var render = require('./render');
var ChatClient = require('./chat-client');
var Canvas = require('./canvas');
var global = require('./global');

var playerNameInput = document.getElementById('playerNameInput');
var socket;

// Variables para el ping de latencia
var pingStartTime = 0;
var currentPing = 0;
var pingInterval = null;

// Variables para estadísticas en tiempo real
var statsUpdateInterval = null;

// Función para cargar estadísticas iniciales
function loadInitialStats() {
    fetch('/api/stats')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateStatsDisplay(data.stats);
            }
        })
        .catch(error => {
            console.error('[STATS] Error cargando estadísticas iniciales:', error);
        });
}

// Función para actualizar la visualización de estadísticas
function updateStatsDisplay(stats) {
    // Actualizar jugadores online
    const playersOnlineElement = document.getElementById('playersOnline');
    if (playersOnlineElement) {
        playersOnlineElement.textContent = stats.playersOnline;
    }
    
    // Actualizar ganancias globales
    const globalWinningsElement = document.getElementById('globalWinnings');
    if (globalWinningsElement) {
        globalWinningsElement.textContent = '$' + parseFloat(stats.globalWinnings).toLocaleString();
    }
}

// Función para iniciar actualizaciones de estadísticas
function startStatsUpdates() {
    if (statsUpdateInterval) {
        clearInterval(statsUpdateInterval);
    }
    
    // Cargar estadísticas iniciales
    loadInitialStats();
    
    // Actualizar cada 5 segundos
    statsUpdateInterval = setInterval(loadInitialStats, 5000);
}

// Función para detener actualizaciones de estadísticas
function stopStatsUpdates() {
    if (statsUpdateInterval) {
        clearInterval(statsUpdateInterval);
        statsUpdateInterval = null;
    }
}

// Función para cargar el leaderboard
function loadLeaderboard() {
    fetch('/api/leaderboard')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateLeaderboardDisplay(data.leaderboard);
            }
        })
        .catch(error => {
            console.error('[LEADERBOARD] Error cargando leaderboard:', error);
        });
}

// Función para actualizar la visualización del leaderboard
function updateLeaderboardDisplay(leaderboard) {
    const leaderboardList = document.getElementById('leaderboardList');
    if (!leaderboardList) return;
    
    if (leaderboard.length === 0) {
        leaderboardList.innerHTML = `
            <div class="text-center text-gray-400">
                <p>No hay jugadores en el leaderboard aún</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    leaderboard.forEach((player, index) => {
        const position = index + 1;
        const medal = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : `${position}.`;
        
        html += `
            <div class="flex items-center justify-between p-2 bg-gray-800 bg-opacity-50 rounded-lg">
                <div class="flex items-center space-x-3">
                    <span class="text-lg font-bold ${position <= 3 ? 'text-yellow-400' : 'text-gray-300'}">${medal}</span>
                    <div>
                        <p class="font-semibold text-white">${player.username}</p>
                        <p class="text-xs text-gray-400">${player.total_games_played} partidas • ${player.win_rate.toFixed(1)}% win rate</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="font-bold text-green-400">$${parseFloat(player.total_winnings).toLocaleString()}</p>
                    <p class="text-xs text-gray-400">Mejor: $${parseFloat(player.biggest_win).toLocaleString()}</p>
                </div>
            </div>
        `;
    });
    
    leaderboardList.innerHTML = html;
}

// Función para iniciar actualizaciones del leaderboard
function startLeaderboardUpdates() {
    // Cargar leaderboard inicial
    loadLeaderboard();
    
    // Actualizar cada 30 segundos
    setInterval(loadLeaderboard, 30000);
}

var debug = function (args) {
    if (console && console.log) {
        console.log(args);
    }
};

if (/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)) {
    global.mobile = true;
}

function startGame(type) {
    // Siempre usar el nombre del input, independientemente del tipo de autenticación
    global.playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    
    global.playerType = type;

    global.screen.width = window.innerWidth;
    global.screen.height = window.innerHeight;

    // Usar las nuevas funciones del diseo
    if (typeof showGameArea === 'function') {
        showGameArea();
    } else {
        // Fallback al mtodo anterior
        document.getElementById('startMenuWrapper').style.maxHeight = '0px';
        document.getElementById('gameAreaWrapper').classList.add('active');
    }
    if (!socket) {
        socket = io({ query: "type=" + type });
        setupSocket(socket);
    }
    if (!global.animLoopHandle)
        animloop();
    socket.emit('respawn');
    window.chat.socket = socket;
    window.chat.registerFunctions();
    window.canvas.socket = socket;
    global.socket = socket;
    
    // Detener actualizaciones de estadísticas cuando entra al juego
    stopStatsUpdates();
    
    // Mostrar información sobre la brújula
    setTimeout(() => {
        window.chat.addSystemLine(' 🎯 Brújula de detección activada! Presiona H para ayuda');
    }, 2000);
    
    setTimeout(() => {
        window.chat.addSystemLine(' 📡 Nuevo: Radar de largo alcance! Presiona R para activarlo');
    }, 4000);
    
    setTimeout(() => {
        window.chat.addSystemLine(' 🎯 Radar de fondo activo! Presiona T para desactivarlo');
    }, 6000);
    
    setTimeout(() => {
        window.chat.addSystemLine(' 🌍 ¡Nuevo! Brújula detecta células en todo el mapa');
    }, 8000);
    
    // Función de debug para mostrar datos del radar cada 10 segundos
    setInterval(() => {
        if (global.debugLogsDisabled) return; // Saltar si los logs están deshabilitados
        
        if (global.radarData && global.radarData.length > 0) {
            console.log('[RADAR_DEBUG] ✅ Radar activo con', global.radarData.length, 'jugadores');
            // Mostrar información de los primeros 2 jugadores para debug
            global.radarData.slice(0, 2).forEach((player, index) => {
                console.log(`[RADAR_DEBUG] Jugador ${index + 1}: ${player.name} en (${player.x}, ${player.y})`);
            });
        } else {
            console.log('[RADAR_DEBUG] ❌ No hay datos del radar');
        }
    }, 10000);
    
    // Test automático después de 15 segundos
    setTimeout(() => {
        console.log('[TEST] 🧪 Ejecutando test automático del sistema de radar...');
        window.testRadarSystem();
    }, 15000);
}

// Hacer startGame disponible globalmente
window.startGame = startGame;

// Funcin para mostrar opciones de apuesta
function showBetOptions() {
    document.getElementById('betOptions').style.display = 'block';
    document.getElementById('normalButtons').style.display = 'none';
}

// Funcin para ocultar opciones de apuesta
function hideBetOptions() {
    document.getElementById('betOptions').style.display = 'none';
    document.getElementById('normalButtons').style.display = 'block';
    // Limpiar cualquier apuesta pendiente
    global.betAmount = 0;
}

// Funcin para procesar apuesta
function processBet(betAmount) {
    console.log(`[BET] Procesando apuesta de $${betAmount}`);
    
    if (!currentUser || (!sessionToken && !currentUser.id)) {
        console.error('Usuario no autenticado');
        return;
    }

    // Preparar headers según el tipo de autenticación
    const headers = {
        'Content-Type': 'application/json'
    };
    
    // Para usuarios con sessionToken (autenticación tradicional)
    if (sessionToken) {
        headers['Authorization'] = 'Bearer ' + sessionToken;
    }
    // Para usuarios de Google OAuth, usamos cookies de sesión (no necesitamos Authorization header)

    fetch('/api/bet', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ betAmount: betAmount }),
        credentials: 'include' // Incluir cookies para sesiones de Google OAuth
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log(`[BET] Apuesta procesada exitosamente. Nuevo balance: $${data.newBalance}`);
            // Actualizar balance en la UI
            currentUser.balance = data.newBalance;
            updateNavAuth();
            
            // Iniciar juego con la apuesta
            startGameWithBet(betAmount);
        } else {
            console.error('[BET] Error en la apuesta:', data.error);
            alert('Error: ' + data.error);
        }
    })
    .catch(error => {
        console.error('Error al procesar apuesta:', error);
        alert('Error al procesar la apuesta');
    });
}

// Funcin para iniciar juego con apuesta
function startGameWithBet(betAmount) {
    console.log(`[BET] Iniciando juego con apuesta de $${betAmount}`);
    
    // Usar el nombre del input, no el nombre de Google OAuth
    global.playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    global.playerType = 'player';
    global.betAmount = betAmount;
    global.originalBetAmount = betAmount; // Guardar la apuesta original
    updateMobileCashoutButton();

    global.screen.width = window.innerWidth;
    global.screen.height = window.innerHeight;

    // Usar las nuevas funciones del diseo
    if (typeof showGameArea === 'function') {
        showGameArea();
    } else {
        // Fallback al mtodo anterior
        document.getElementById('startMenuWrapper').style.maxHeight = '0px';
        document.getElementById('gameAreaWrapper').classList.add('active');
    }
    
    if (!socket) {
        socket = io({ query: "type=player" });
        setupSocket(socket);
    }
    if (!global.animLoopHandle)
        animloop();
    
    // Enviar respawn para iniciar el juego
    socket.emit('respawn');
    
    window.chat.socket = socket;
    window.chat.registerFunctions();
    window.canvas.socket = socket;
    global.socket = socket;
    global.gameStart = Date.now();
    updateMobileCashoutButton();
    
    // Detener actualizaciones de estadísticas cuando entra al juego
    stopStatsUpdates();
}

// Checks if the nick chosen contains valid characters (any Unicode character except control characters).
function validNick() {
    var regex = /^[^\x00-\x1F\x7F]*$/;
    debug('Regex Test', regex.exec(playerNameInput.value));
    return regex.exec(playerNameInput.value) !== null && playerNameInput.value.length > 0 && playerNameInput.value.length <= 25;
}

// Variables de autenticacin
var currentUser = null;
var sessionToken = null;
var selectedBetAmount = 0;



// Funciones de autenticacin
function updateNavAuth() {
    console.log('Actualizando navegacin de autenticacin...');
    console.log('Usuario actual:', currentUser);
    
    const navNotAuth = document.getElementById('navNotAuth');
    const navAuth = document.getElementById('navAuth');
    const playerNameSection = document.getElementById('playerNameSection');
    
    if (currentUser) {
        // Usuario autenticado
        if (navNotAuth) navNotAuth.style.display = 'none';
        if (navAuth) navAuth.style.display = 'block';
        
        const navUserDisplayName = document.getElementById('navUserDisplayName');
        const navUserBalance = document.getElementById('navUserBalance');
        const userDisplayName = document.getElementById('userDisplayName');
        
        if (navUserDisplayName) navUserDisplayName.textContent = currentUser.username;
        if (navUserBalance) navUserBalance.textContent = currentUser.balance;
        if (userDisplayName) userDisplayName.textContent = currentUser.username;
        
        // Mostrar el campo de nombre de jugador incluso cuando est autenticado
        if (playerNameSection) playerNameSection.style.display = 'block';
        
        console.log('Usuario autenticado, mostrando informacin del usuario:', currentUser.username, 'Balance:', currentUser.balance);
    } else {
        // Usuario no autenticado
        if (navNotAuth) navNotAuth.style.display = 'block';
        if (navAuth) navAuth.style.display = 'none';
        
        // Mostrar el campo de nombre cuando no est autenticado
        if (playerNameSection) playerNameSection.style.display = 'block';
        
        // Actualizar mensaje de bienvenida para usuario no autenticado
        const userDisplayName = document.getElementById('userDisplayName');
        if (userDisplayName) userDisplayName.textContent = 'Invitado';
        
        console.log('Usuario no autenticado, mostrando botones de login/registro');
    }
}

function showLoginModal() {
    console.log('Mostrando modal de login...');
    const loginModal = document.getElementById('loginModal');
    const loginEmail = document.getElementById('loginEmail');
    
    if (loginModal) {
        loginModal.style.display = 'flex';
        console.log('Modal de login mostrado');
    } else {
        console.error('No se encontr el modal de login');
    }
    
    if (loginEmail) {
        loginEmail.focus();
    }
}

// Función para mostrar notificación de pago exitoso
function showPaymentSuccessNotification() {
    // Crear notificación
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-4 rounded-lg shadow-lg z-50 transform transition-all duration-300';
    notification.style.transform = 'translateX(100%)';
    notification.innerHTML = `
        <div class="flex items-center">
            <span class="text-2xl mr-3">🎉</span>
            <div>
                <h4 class="font-bold">Payment Successful!</h4>
                <p class="text-sm">Your balance has been updated.</p>
            </div>
        </div>
    `;
    
    // Agregar al DOM
    document.body.appendChild(notification);
    
    // Animar entrada
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remover después de 5 segundos
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

function hideLoginModal() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('loginError').textContent = '';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
}

// Funciones de registro tradicional eliminadas - solo Google OAuth

function loginUser() {
    // Función de login tradicional eliminada - usar Google OAuth
    console.log('Login tradicional deshabilitado. Usar Google OAuth.');
    var errorElement = document.getElementById('loginError');
    errorElement.textContent = 'Por favor, usa el botón de Google para iniciar sesión';
}

// Función registerUser eliminada - solo Google OAuth

function loginWithGoogle() {
    console.log('Iniciando autenticación con Google...');
    window.location.href = '/auth/google';
}

function logoutUser() {
    // Verificar si es una sesión de Google
    fetch('/api/auth/status')
    .then(response => response.json())
    .then(data => {
        if (data.authenticated) {
            // Es una sesión de Google, usar la ruta de logout de Google
            window.location.href = '/auth/logout';
        } else {
            // Es una sesión normal, usar la API de logout
            if (sessionToken) {
                fetch('/api/logout', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ sessionToken })
                })
                .catch(error => {
                    console.error('Error al cerrar sesión:', error);
                });
            }
            
            // Usar la función centralizada para limpiar datos
            clearAuthData();
            console.log('Usuario deslogueado y localStorage limpiado');
        }
    })
    .catch(error => {
        console.error('Error verificando tipo de sesión:', error);
        // Fallback a logout normal
        if (sessionToken) {
            fetch('/api/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sessionToken })
            })
            .catch(error => {
                console.error('Error al cerrar sesión:', error);
            });
        }
        clearAuthData();
    });
}

function checkAuthStatus() {
    console.log('Verificando estado de autenticación...');
    
    // Primero verificar si hay una sesión de Google activa
    fetch('/api/auth/status', {
        credentials: 'include' // Incluir cookies para sesiones de Google OAuth
    })
    .then(response => {
        console.log('[DEBUG] Respuesta de /api/auth/status - status:', response.status);
        return response.json();
    })
    .then(data => {
        console.log('[DEBUG] Datos recibidos de /api/auth/status:', data);
        
        if (data.authenticated && data.user) {
            // Usuario autenticado con Google
            console.log('[AUTH] Usuario autenticado con Google:', data.user);
            currentUser = data.user;
            sessionToken = null; // No hay token para sesiones de Google
            updateNavAuth();
            updateWalletBalance();
            updateBetInterface();
            return;
        } else {
            console.log('[AUTH] Usuario no autenticado en el servidor');
        }
        
        // Si no hay sesión de Google, verificar localStorage
        var savedUserData = localStorage.getItem('userData');
        var savedToken = localStorage.getItem('sessionToken');
        
        if (savedUserData && savedToken) {
            try {
                // Restaurar datos del usuario desde localStorage
                currentUser = JSON.parse(savedUserData);
                sessionToken = savedToken;
                
                console.log('Datos de usuario encontrados en localStorage:', currentUser);
                
                // Verificar que el token aún sea válido
                fetch('/api/balance', {
                    headers: {
                        'Authorization': 'Bearer ' + savedToken
                    }
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Token inválido');
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.balance !== undefined) {
                        // Token válido, actualizar balance
                        currentUser.balance = data.balance;
                        localStorage.setItem('userData', JSON.stringify(currentUser));
                        updateNavAuth();
                        updateWalletBalance();
                        updateBetInterface();
                        console.log('Sesión restaurada exitosamente. Balance actualizado:', data.balance);
                    } else {
                        throw new Error('Respuesta inválida del servidor');
                    }
                })
                .catch(error => {
                    console.log('Error verificando token, limpiando datos...', error);
                    clearAuthData();
                });
            } catch (error) {
                console.log('Error parseando datos de usuario, limpiando localStorage...', error);
                clearAuthData();
            }
        } else {
            console.log('No hay datos de sesión guardados');
            currentUser = null;
            sessionToken = null;
            updateNavAuth();
            updateWalletBalance();
            updateBetInterface();
        }
    })
    .catch(error => {
        console.error('Error verificando estado de autenticación:', error);
        // Fallback a verificación de localStorage
        var savedUserData = localStorage.getItem('userData');
        var savedToken = localStorage.getItem('sessionToken');
        
        if (savedUserData && savedToken) {
            try {
                currentUser = JSON.parse(savedUserData);
                sessionToken = savedToken;
                updateNavAuth();
                updateWalletBalance();
                updateBetInterface();
            } catch (error) {
                clearAuthData();
            }
        } else {
            currentUser = null;
            sessionToken = null;
            updateNavAuth();
            updateWalletBalance();
            updateBetInterface();
        }
    });
}

// Funcin para limpiar datos de autenticacin
function clearAuthData() {
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userPassword');
    localStorage.removeItem('userData');
    currentUser = null;
    sessionToken = null;
    updateNavAuth();
    updateBetInterface();
    updateWalletBalance();
}

// Funcin para actualizar el balance del usuario
function updateUserBalance() {
    if (!currentUser || !sessionToken) {
        return;
    }
    
    fetch('/api/balance', {
        headers: {
            'Authorization': 'Bearer ' + sessionToken
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.balance !== undefined) {
            currentUser.balance = data.balance;
            window.currentUser = currentUser; // Actualizar variable global
            localStorage.setItem('userData', JSON.stringify(currentUser));
            updateWalletBalance();
            updateBetInterface();
            console.log('Balance actualizado:', data.balance);
        }
    })
    .catch(error => {
        console.error('Error actualizando balance:', error);
    });
}

// Función para configurar los event listeners de autenticación
function setupAuthEventListeners() {
    console.log('Configurando event listeners de autenticación...');
    
    const navGoogleLoginBtn = document.getElementById('navGoogleLoginBtn');
    const navLoginBtn = document.getElementById('navLoginBtn');
    const navLogoutBtn = document.getElementById('navLogoutBtn');
    const closeLoginModal = document.getElementById('closeLoginModal');
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    
    if (navGoogleLoginBtn) {
        navGoogleLoginBtn.onclick = loginWithGoogle;
        console.log('Botón de Google OAuth configurado');
    } else {
        console.error('No se encontró el botón de Google OAuth');
    }
    
    if (navLoginBtn) {
        navLoginBtn.onclick = showLoginModal;
        console.log('Botón de login configurado');
    } else {
        console.error('No se encontró el botón de login');
    }
    
    if (navLogoutBtn) {
        navLogoutBtn.onclick = logoutUser;
        console.log('Botón de logout configurado');
    }

    // Configurar botón Add Funds
    const addFundsBtn = document.getElementById('addFundsBtn');
    if (addFundsBtn) {
        addFundsBtn.onclick = function() {
            window.location.href = '/add-funds.html';
        };
        console.log('Botón de Add Funds configurado');
    }
    
    // Configurar botón My Payments
    const myPaymentsBtn = document.getElementById('myPaymentsBtn');
    if (myPaymentsBtn) {
        myPaymentsBtn.onclick = function() {
            window.location.href = '/my-payments.html';
        };
        console.log('Botón de My Payments configurado');
    }
    
    if (closeLoginModal) {
        closeLoginModal.onclick = hideLoginModal;
        console.log('Botón de cerrar modal configurado');
    }
    
    // Configurar botones adicionales de modales (solo login)
    const switchToLoginBtn = document.getElementById('switchToLogin');
    
    if (switchToLoginBtn) {
        switchToLoginBtn.onclick = switchToLogin;
        console.log('Botón de cambiar a login configurado');
    }
    
    // Cerrar modales al hacer clic fuera
    window.addEventListener('click', (event) => {
        const loginModal = document.getElementById('loginModal');
        
        if (event.target === loginModal) {
            hideLoginModal();
        }
    });
    
    if (googleLoginBtn) {
        googleLoginBtn.onclick = loginWithGoogle;
        console.log('Botón de Google OAuth del modal configurado');
    }
    
    // Cerrar modal al hacer clic fuera de él
    const loginModal = document.getElementById('loginModal');
    if (loginModal) {
        loginModal.onclick = function(e) {
            if (e.target === this) {
                hideLoginModal();
            }
        };
    }
    
    // Login con Enter eliminado - solo Google OAuth
}

// Configurar event listeners cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM cargado, configurando event listeners de autenticación...');
    setupAuthEventListeners();
    
    // Iniciar actualizaciones de estadísticas en tiempo real
    startStatsUpdates();
    
    // Iniciar actualizaciones del leaderboard
    startLeaderboardUpdates();
    
    // Verificar parámetros de URL para mensajes de Google OAuth
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    const error = urlParams.get('error');
    const logout = urlParams.get('logout');
    
    if (success === 'google_auth_success') {
        console.log('Autenticación con Google exitosa');
        // Limpiar la URL
        window.history.replaceState({}, document.title, window.location.pathname);
        // Verificar estado de autenticación
        setTimeout(() => {
            checkAuthStatus();
        }, 1000);
    }
    
    if (success === 'payment') {
        console.log('Pago completado exitosamente');
        // Limpiar la URL
        window.history.replaceState({}, document.title, window.location.pathname);
        // Mostrar notificación de éxito
        showPaymentSuccessNotification();
        // Verificar estado de autenticación para actualizar balance
        setTimeout(() => {
            checkAuthStatus();
        }, 1000);
    }
    
    if (error === 'google_auth_failed') {
        console.error('Error en autenticación con Google');
        alert('Error al autenticarse con Google. Por favor, intenta de nuevo.');
        // Limpiar la URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    if (logout === 'success') {
        console.log('Logout exitoso');
        // Limpiar la URL
        window.history.replaceState({}, document.title, window.location.pathname);
        // Limpiar datos locales
        clearAuthData();
    }
});

window.onload = function () {
    console.log('[DEBUG] window.onload - Página cargada, configurando autenticación...');
    
    try {
        // Verificar estado de autenticación al cargar
        console.log('[DEBUG] window.onload - Ejecutando checkAuthStatus...');
        checkAuthStatus();
        console.log('[DEBUG] window.onload - checkAuthStatus completado');
    } catch (error) {
        console.error('[DEBUG] Error en checkAuthStatus:', error);
    }
    
    console.log('[DEBUG] window.onload - Configurando visibilitychange listener...');
    // Actualizar balance cuando la página vuelva a estar visible
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            console.log('Página visible, verificando sesión...');
            if (currentUser && (sessionToken || currentUser.id)) {
                updateUserBalance();
            } else {
                // Si no hay sesión activa, verificar si hay datos guardados
                checkAuthStatus();
            }
        }
    });

    console.log('[DEBUG] window.onload - Configurando botones de juego...');
    var btn = document.getElementById('startButton'),
        btnS = document.getElementById('spectateButton'),
        nickErrorText = document.querySelector('#startMenu .input-error'),
        logoutBtn = document.getElementById('logoutButton');

    if (btnS) {
        btnS.onclick = function () {
            startGame('spectator');
        };
    }

    if (btn) {
        btn.onclick = function () {
            // Solo usuarios autenticados pueden jugar
            if (currentUser) {
                if (nickErrorText) nickErrorText.style.opacity = 0;
                // Mostrar opciones de apuesta antes de iniciar el juego
                showBetOptions();
            } else {
                // Mostrar modal de login en lugar de alert
                showLoginModal();
            }
        };
    }

    var settingsMenu = document.getElementById('settingsButton');
    var settings = document.getElementById('settings');

    if (settingsMenu) {
        settingsMenu.onclick = function () {
            if (settings && settings.style.maxHeight == '300px') {
                settings.style.maxHeight = '0px';
            } else if (settings) {
                settings.style.maxHeight = '300px';
            }
        };
    }

    playerNameInput.addEventListener('keypress', function (e) {
        var key = e.which || e.keyCode;

        if (key === global.KEY_ENTER) {
            if (currentUser) {
                nickErrorText.style.opacity = 0;
                // Mostrar opciones de apuesta antes de iniciar el juego
                showBetOptions();
            } else {
                // Mostrar modal de login en lugar de alert
                showLoginModal();
            }
        }
    });

    // Event listeners para botones de apuesta - CONSOLIDADO en DOMContentLoaded
    const cancelBetBtn = document.getElementById('cancelBet');
    
    if (cancelBetBtn) {
        cancelBetBtn.onclick = hideBetOptions;
    }

    // Event listener para el botn de salir del juego
    const exitGameBtn = document.getElementById('exitGameBtn');
    if (exitGameBtn) {
        exitGameBtn.onclick = function() {
            // Confirmar salida solo si no hay un cashout en proceso
            if (global.isCashOutActive) {
                alert('Ya ests procesando un cash out. Por favor, espera a que termine.');
                return;
            }

            const originalBet = global.originalBetAmount || global.betAmount;
            const hasWinnings = global.betAmount > originalBet;
            const message = hasWinnings 
                ? 'Ests seguro de que quieres salir del juego? Se te aplicar un descuento del 10% sobre tus ganancias.'
                : 'Ests seguro de que quieres salir del juego?';
            
            if (confirm(message)) {
                // Marcar como desconexin voluntaria
                global.voluntaryExit = true;
                handleDisconnect();
            }
        };
    }

    // Event listener para el botón de cashout móvil
    const mobileCashoutBtn = document.getElementById('mobileCashoutBtn');
    if (mobileCashoutBtn) {
        mobileCashoutBtn.addEventListener('touchstart', function(e) {
            e.preventDefault();
            if (global.gameStart && global.gameStart > 0 && global.betAmount > 0 && !global.isCashOutActive) {
                startCashOut();
            }
        });
        
        mobileCashoutBtn.addEventListener('touchend', function(e) {
            e.preventDefault();
            if (global.isCashOutActive) {
                cancelCashOut();
            }
        });
        
        // También agregar soporte para mouse en dispositivos híbridos
        mobileCashoutBtn.addEventListener('mousedown', function(e) {
            e.preventDefault();
            if (global.gameStart && global.gameStart > 0 && global.betAmount > 0 && !global.isCashOutActive) {
                startCashOut();
            }
        });
        
        mobileCashoutBtn.addEventListener('mouseup', function(e) {
            e.preventDefault();
            if (global.isCashOutActive) {
                cancelCashOut();
            }
        });
    }

    // Asegurar que la interfaz de apuestas esté actualizada al cargar la página
    setTimeout(() => {
        updateBetInterface();
    }, 100);

};

// TODO: Break out into GameControls.

var playerConfig = {
    border: 6,
    textColor: '#FFFFFF',
    textBorder: '#000000',
    textBorderSize: 3,
    defaultSize: 30
};

var player = {
    id: -1,
    x: global.screen.width / 2,
    y: global.screen.height / 2,
    screenWidth: global.screen.width,
    screenHeight: global.screen.height,
    target: { x: global.screen.width / 2, y: global.screen.height / 2 }
};
global.player = player;

var foods = [];
var viruses = [];
var fireFood = [];
var powerFoods = [];
var bombs = [];
var users = [];
var leaderboard = [];
var redZone = null;
var target = { x: player.x, y: player.y };
global.target = target;

window.canvas = new Canvas();
window.chat = new ChatClient();

var visibleBorderSetting = document.getElementById('visBord');
visibleBorderSetting.onchange = settings.toggleBorder;

var showMassSetting = document.getElementById('showMass');
showMassSetting.onchange = settings.toggleMass;

var continuitySetting = document.getElementById('continuity');
continuitySetting.onchange = settings.toggleContinuity;

var roundFoodSetting = document.getElementById('roundFood');
roundFoodSetting.onchange = settings.toggleRoundFood;

var redZoneSetting = document.getElementById('redZone');
redZoneSetting.onchange = settings.toggleRedZone;

var c = window.canvas.cv;
var graph = c.getContext('2d');

$("#feed").click(function () {
    socket.emit('1');
    window.canvas.reenviar = false;
});

$("#split").click(function () {
    socket.emit('2');
    window.canvas.reenviar = false;
});

function handleDisconnect() {
    console.log('[DISCONNECT] Iniciando desconexin...');
    console.log('[DISCONNECT] voluntaryExit:', global.voluntaryExit);
    console.log('[DISCONNECT] betAmount:', global.betAmount);
    
    // Evitar llamadas duplicadas
    if (global.isDisconnecting) return;
    global.isDisconnecting = true;

    // Solo procesar cashout si es una salida voluntaria
    if (global.voluntaryExit && currentUser && (sessionToken || currentUser.id) && global.betAmount && global.betAmount > 0) {
        console.log('[DISCONNECT] Procesando cash out voluntario...');
        
        // Calcular duracin del juego
        const gameDuration = global.gameStart ? Math.floor((Date.now() - global.gameStart) / 1000) : 0;
        const originalBet = global.originalBetAmount || global.betAmount;
        
        // Preparar headers según el tipo de autenticación
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // Para usuarios con sessionToken (autenticación tradicional)
        if (sessionToken) {
            headers['Authorization'] = 'Bearer ' + sessionToken;
        }
        // Para usuarios de Google OAuth, usamos cookies de sesión (no necesitamos Authorization header)

        // Notificar al servidor que es una desconexión voluntaria
        if (socket) {
            socket.emit('voluntaryDisconnect');
        }
        
        // Llamar a la API de cashout
        fetch('/api/voluntaryDisconnect', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ 
                betAmount: global.betAmount,
                originalBetAmount: originalBet,
                maxMass: global.player ? global.player.massTotal : 0,
                duration: gameDuration
            }),
            credentials: 'include' // Incluir cookies para sesiones de Google OAuth
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                currentUser.balance = data.newBalance;
                updateNavAuth();
                console.log(`[CASHOUT] Procesado exitosamente. Devuelto: $${data.returned}, nuevo balance: $${data.newBalance}`);
                
                // Redirigir a la pgina de resultados del cashout
                redirectToCashoutResults({
                    player: currentUser.username,
                    initialBet: originalBet,
                    finalMass: global.player ? global.player.massTotal : 0,
                    duration: gameDuration,
                    winnings: data.returned,
                    balance: data.newBalance
                });
            } else {
                console.error('[CASHOUT] Error en la API:', data.error);
                completeDisconnect();
            }
        })
        .catch(error => {
            console.error('[CASHOUT] Error al procesar cashout:', error);
            completeDisconnect();
        });
    } else {
        // Desconexin normal del socket (no voluntaria), solo limpiar
        console.log('[DISCONNECT] Desconexin normal del socket, no procesando cashout');
        completeDisconnect();
    }
}

function completeDisconnect() {
    // Limpiar variables
    global.voluntaryExit = false;
    global.betAmount = 0;
    global.originalBetAmount = 0;
    global.cashOutProgress = 0;
    global.isCashOutActive = false;
    global.gameStart = false;
    updateMobileCashoutButton();
    global.isDisconnecting = false; // Resetear la bandera
    
    // Cerrar socket
    if (socket) {
        socket.close();
    }
    
    // Redirigir a la pantalla principal
    if (!global.kicked) {
        // Mostrar mensaje de desconexin
        render.drawErrorMessage('Disconnected!', graph, global.screen);
        
        // Despus de 2 segundos, volver al men principal
        setTimeout(() => {
            // Usar las nuevas funciones del diseo
            if (typeof showMainMenu === 'function') {
                showMainMenu();
            } else {
                // Fallback al mtodo anterior
                document.getElementById('gameAreaWrapper').classList.remove('active');
                const mainSection = document.getElementById('mainGameSection');
                if (mainSection) {
                    mainSection.style.display = 'block';
                }
            }
            
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
            // Ocultar controles del juego
            document.getElementById('gameControls').style.display = 'none';
            
            // Reiniciar actualizaciones de estadísticas cuando regresa al lobby
            startStatsUpdates();
        }, 2000);
    }
}

// socket stuff.
function setupSocket(socket) {
    console.log('[SOCKET] 🔌 Configurando socket...');
    
    // Handle ping.
    socket.on('pongcheck', function () {
        var latency = Date.now() - global.startPingTime;
        debug('Latency: ' + latency + 'ms');
        window.chat.addSystemLine('Ping: ' + latency + 'ms');
    });

    // Handle error.
    socket.on('connect_error', () => {
        console.error('Error de conexin con el servidor. Intentando reconectar...');
        completeDisconnect();
    });
    
    // ATENCIN: Se elimin la llamada a `handleDisconnect` de este evento
    socket.on('disconnect', (reason) => {
        console.log('Socket desconectado:', reason);
        // Si la desconexin no fue voluntaria, manejarla aqu
        if (!global.voluntaryExit) {
            completeDisconnect();
        }
    });

    // Handle connection.
    socket.on('welcome', function (playerSettings, gameSizes) {
        player = playerSettings;
        player.name = global.playerName;
        player.screenWidth = global.screen.width;
        player.screenHeight = global.screen.height;
        player.target = window.canvas.target;
        global.player = player;
        window.chat.player = player;
        
        // Obtener la skin seleccionada
        let selectedSkinData = null;
        if (window.getSelectedSkinData) {
            selectedSkinData = window.getSelectedSkinData();
            console.log(`[SKIN_CONNECTION] Datos de skin obtenidos:`, selectedSkinData);
        } else {
            console.log(`[SKIN_CONNECTION] Función getSelectedSkinData no disponible`);
        }
        
        // Si hay una apuesta activa, enviar los datos del jugador con la apuesta
        if (global.betAmount && global.betAmount > 0) {
            const playerData = {
                name: currentUser.username,
                userId: currentUser.id,
                betAmount: global.betAmount
            };
            
            // Agregar información de la skin si está disponible
            if (selectedSkinData) {
                playerData.skinId = selectedSkinData.skinId;
                playerData.skinName = selectedSkinData.skinName;
                playerData.skinHue = selectedSkinData.skinHue;
                console.log(`[SKIN_CONNECTION] Enviando datos de skin al servidor (con apuesta):`, {
                    skinId: selectedSkinData.skinId,
                    skinName: selectedSkinData.skinName,
                    skinHue: selectedSkinData.skinHue
                });
            } else {
                console.log(`[SKIN_CONNECTION] No hay datos de skin para enviar (con apuesta)`);
            }
            
            socket.emit('gotit', playerData);
        } else {
            const playerData = {
                name: player.name,
                screenWidth: player.screenWidth,
                screenHeight: player.screenHeight
            };
            
            // Agregar información de la skin si está disponible
            if (selectedSkinData) {
                playerData.skinId = selectedSkinData.skinId;
                playerData.skinName = selectedSkinData.skinName;
                playerData.skinHue = selectedSkinData.skinHue;
                console.log(`[SKIN_CONNECTION] Enviando datos de skin al servidor (sin apuesta):`, {
                    skinId: selectedSkinData.skinId,
                    skinName: selectedSkinData.skinName,
                    skinHue: selectedSkinData.skinHue
                });
            } else {
                console.log(`[SKIN_CONNECTION] No hay datos de skin para enviar (sin apuesta)`);
            }
            
            socket.emit('gotit', playerData);
        }
        
        global.gameStart = Date.now();
        updateMobileCashoutButton();
        window.chat.addSystemLine('Connected to the game!');
        window.chat.addSystemLine('Type <b>-help</b> for a list of commands.');
        
        // Mostrar mensaje de cashout si hay una apuesta activa (sin mostrar botn de salir)
        if (global.betAmount && global.betAmount > 0) {
            window.chat.addSystemLine(' Presiona <b>C</b> para hacer cash out y retirar tus ganancias!');
        }
        
        // Iniciar el sistema de ping
        startPingSystem();
        
        if (global.mobile) {
            document.getElementById('gameAreaWrapper').removeChild(document.getElementById('chatbox'));
        }
        c.focus();
        global.game.width = gameSizes.width;
        global.game.height = gameSizes.height;
        resize();
        
        // Mostrar notificación de escudo protector inicial
        setTimeout(() => {
            showShieldNotification('¡Escudo protector activado por 15 segundos!', 15);
            window.chat.addSystemLine('{SHIELD} <b>¡Escudo protector activado por 15 segundos!</b>');
        }, 500); // Pequeño delay para asegurar que el juego esté completamente cargado
        
        // Procesar flechas pendientes después de que el juego esté completamente inicializado
        setTimeout(() => {
            processPendingArrows();
        }, 2000);
    });



    socket.on('playerDied', (data) => {
        const player = isUnnamedCell(data.playerEatenName) ? 'An unnamed cell' : data.playerEatenName;
        //const killer = isUnnamedCell(data.playerWhoAtePlayerName) ? 'An unnamed cell' : data.playerWhoAtePlayerName;

        //window.chat.addSystemLine('{GAME} - <b>' + (player) + '</b> was eaten by <b>' + (killer) + '</b>');
        window.chat.addSystemLine('{GAME} - <b>' + (player) + '</b> was eaten');
    });

    socket.on('playerDisconnect', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> disconnected.');
        // Remover flecha del jugador que se desconectó
        if (data.id) {
            removePlayerArrow(data.id);
        }
    });

    socket.on('playerJoin', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> joined.');
    });

    // Handle shield activation notification
    socket.on('shieldActivated', (data) => {
        console.log('[SHIELD] Escudo protector activado:', data);
        
        // Mostrar notificación en el chat
        window.chat.addSystemLine('{SHIELD} <b>' + data.message + '</b>');
        
        // Mostrar notificación visual temporal
        showShieldNotification(data.message, data.duration);
    });

    // Handle combat division notification
    socket.on('combatDivision', (data) => {
        console.log('[COMBAT_DIVISION] División por combate:', data);
        
        // Mostrar notificación en el chat
        window.chat.addSystemLine('{COMBAT} <b>' + data.message + '</b>');
        
        // Mostrar notificación visual temporal
        showCombatNotification(data.message);
    });

    // Handle player skin change notification
    socket.on('playerSkinChanged', (data) => {
        console.log('[SKIN_CHANGE] Jugador cambió de skin:', data);
        
        // Mostrar notificación en el chat
        window.chat.addSystemLine('{SKIN} <b>' + data.playerName + '</b> cambió a skin: <b>' + data.skinName + '</b>');
        
        // Actualizar el hue y skinId del jugador en el cliente si es necesario
        if (window.users) {
            for (let user of window.users) {
                if (user.id === data.playerId) {
                    user.hue = data.hue;
                    user.skinId = data.skinId;
                    console.log(`[SKIN] Actualizado hue de ${user.name} a ${data.hue} y skinId a ${data.skinId}`);
                    break;
                }
            }
        }
    });

    // Handle stats update
    socket.on('statsUpdate', (data) => {
        console.log('[STATS] 📊 Estadísticas actualizadas:', data);
        
        // Actualizar jugadores online
        const playersOnlineElement = document.getElementById('playersOnline');
        if (playersOnlineElement) {
            playersOnlineElement.textContent = data.playersOnline;
        }
        
        // Actualizar ganancias globales
        const globalWinningsElement = document.getElementById('globalWinnings');
        if (globalWinningsElement) {
            globalWinningsElement.textContent = '$' + parseFloat(data.globalWinnings).toLocaleString();
        }
    });

    // Handle global combat alert (combate y cashout)
    socket.on('combatAlert', (data) => {
        console.log('[COMBAT_ALERT] ⚔️ Alerta de combate/cashout recibida:', data);
        console.log('[COMBAT_ALERT] Data completa:', JSON.stringify(data, null, 2));
        
        // Verificar si es un cashout o un combate
        const isCashout = data.eatenName === 'CASHOUT';
        console.log('[COMBAT_ALERT] isCashout:', isCashout, 'data.eatenName:', data.eatenName);
        
        if (isCashout) {
            // Es un cashout
            console.log('[CASHOUT_ALERT] 💰 Alerta de cashout detectada');
            window.chat.addSystemLine(` 💰 ${data.message}`);
        } else {
            // Es un combate normal
            showGlobalCombatAlert(data.eaterName, data.eatenName);
            window.chat.addSystemLine(` ⚔️ ${data.message}`);
        }
        
        // Activar brújula automática para todos los jugadores (excepto el que hizo cashout)
        console.log('[COMBAT_ALERT] Comparando IDs - data.eaterId:', data.eaterId, 'global.player?.id:', global.player?.id);
        if (data.eaterId !== global.player?.id) {
            global.showCompass = true;
            global.useRadarCompass = false; // Usar brújula simple en lugar del radar
            global.combatTarget = {
                name: data.eaterName,
                id: data.eaterId, // ID del jugador para seguimiento en tiempo real
                timestamp: Date.now(),
                type: isCashout ? 'cashout' : 'combat'
            };
            
            console.log(`[COMBAT_ALERT] 🎯 Brújula activada para rastrear a ${data.eaterName} (ID: ${data.eaterId}) - Tipo: ${isCashout ? 'cashout' : 'combat'}`);
            console.log(`[COMBAT_ALERT] Estado de brújula - showCompass: ${global.showCompass}, useRadarCompass: ${global.useRadarCompass}`);
            window.chat.addSystemLine(` 🧭 Brújula activada para rastrear a ${data.eaterName}`);
            
            // Desactivar la brújula después de 10 segundos para cashout, 15 para combate
            const timeoutDuration = isCashout ? 10000 : 15000;
            setTimeout(() => {
                if (global.combatTarget && global.combatTarget.id === data.eaterId) {
                    global.showCompass = false;
                    global.useRadarCompass = false;
                    global.combatTarget = null;
                    console.log(`[COMBAT_ALERT] 🕐 Brújula ${isCashout ? 'de cashout' : 'de combate'} desactivada automáticamente`);
                    window.chat.addSystemLine(` 🧭 Brújula ${isCashout ? 'de cashout' : 'de combate'} desactivada`);
                }
            }, timeoutDuration);
        } else {
            console.log('[COMBAT_ALERT] 🚫 No se activa brújula para el jugador que hizo la acción');
        }
        
        // Mostrar flecha indicadora para todos los jugadores (mantener funcionalidad existente)
        if (data.eaterPosition) {
            updatePlayerArrow('combat-eater', 'Jugador Dividido', data.eaterPosition.x, data.eaterPosition.y);
        }
    });

    socket.on('leaderboard', (data) => {
        leaderboard = data.leaderboard;
        var status = '<span class="title">Leaderboard</span>';
        for (var i = 0; i < leaderboard.length; i++) {
            status += '<br />';
            if (leaderboard[i].id == player.id) {
                if (leaderboard[i].name.length !== 0)
                    status += '<span class="me">' + (i + 1) + '. ' + leaderboard[i].name + "</span>";
                else
                    status += '<span class="me">' + (i + 1) + ". An unnamed cell</span>";
            } else {
                if (leaderboard[i].name.length !== 0)
                    status += (i + 1) + '. ' + leaderboard[i].name;
                else
                    status += (i + 1) + '. An unnamed cell';
            }
        }
        //status += '<br />Players: ' + data.players;
        document.getElementById('status').innerHTML = status;
    });

    socket.on('serverMSG', function (data) {
        window.chat.addSystemLine(data);
    });

    // Chat.
    socket.on('serverSendPlayerChat', function (data) {
        window.chat.addChatLine(data.sender, data.message, false);
    });

    // Handle movement.
    socket.on('serverTellPlayerMove', function (playerData, userData, foodsList, massList, virusList, powerFoodList, bombList) {
        if (global.playerType == 'player') {
            player.x = playerData.x;
            player.y = playerData.y;
            player.hue = playerData.hue;
            player.massTotal = playerData.massTotal;
            
            // Actualizar clulas del jugador
            player.cells = playerData.cells;
            
            // Debug: mostrar datos del jugador (solo cuando cambia el dinero)
            if (playerData.gameMoney !== global.betAmount) {
                console.log('[PLAYER_DATA] playerData:', playerData);
            }
            
             // Verificar si el jugador tiene dinero en el juego
             if (playerData.gameMoney !== undefined) {
                 if (playerData.gameMoney !== global.betAmount) {
                     console.log(`[MONEY] Dinero actualizado: $${global.betAmount} -> $${playerData.gameMoney}`);
                     global.betAmount = playerData.gameMoney;
                 }
             } else {
                 console.log('[MONEY] playerData.gameMoney es undefined');
             }
             
             // Actualizar informacin de dinero por clula
             if (playerData.cells && playerData.cells.length > 0) {
                 let totalCellMoney = 0;
                 playerData.cells.forEach(cell => {
                     totalCellMoney += cell.gameMoney || 0;
                 });
                 
                 if (totalCellMoney !== global.betAmount) {
                     console.log(`[CELL_MONEY] Dinero total de clulas: $${totalCellMoney}`);
                     global.betAmount = totalCellMoney;
                 }
             }
        }
        users = userData;
        foods = foodsList;
        viruses = virusList;
        fireFood = massList;
        powerFoods = powerFoodList || [];
        bombs = bombList || [];
        
        // Actualizar flechas de otros jugadores (sin logs de debug)
        if (userData && Array.isArray(userData)) {
            userData.forEach(user => {
                if (user && user.id !== player.id) {
                    updatePlayerArrow(user.id, user.name, user.x, user.y);
                }
            });
            
            // Limpiar flechas de jugadores que ya no están visibles
            const otherPlayers = userData.filter(u => u.id !== player.id);
            const currentPlayerIds = otherPlayers.map(u => u.id);
            const existingArrowIds = Array.from(playerArrows.keys());
            
            existingArrowIds.forEach(arrowId => {
                if (!currentPlayerIds.includes(arrowId)) {
                    removePlayerArrow(arrowId);
                }
            });
            
            // Actualizar flechas para cada jugador
            otherPlayers.forEach(user => {
                updatePlayerArrow(user.id, user.name, user.x, user.y);
            });
        }
        

    });

    // Handle radar data (todos los jugadores del mapa)
    socket.on('radarData', function (allPlayersData) {
        // console.log('[RADAR] ✅ EVENTO RADAR RECIBIDO!');
        // console.log('[RADAR] ✅ Recibidos datos de', allPlayersData.length, 'jugadores para el radar');
        global.radarData = allPlayersData;
        
        // Mostrar información básica de cada jugador
        allPlayersData.forEach(player => {
            if (player.id !== player.id) { // Excluir al propio jugador
                console.log(`[RADAR] Jugador ${player.name} en (${player.x}, ${player.y}) con ${player.cells.length} células`);
            }
        });
    });

    // Death.
    socket.on('RIP', function () {
        global.gameStart = false;
        updateMobileCashoutButton();
        render.drawErrorMessage('You died!', graph, global.screen);
        
        // Ocultar controles del juego
        document.getElementById('gameControls').style.display = 'none';
        
        // El jugador perdi todo su dinero al morir
        if (global.betAmount && global.betAmount > 0) {
            console.log(`[BET] Player died with $${global.betAmount} in game - lost everything`);
            window.chat.addSystemLine(` Perdiste $${global.betAmount} al morir!`);
            global.betAmount = 0; // Resetear el dinero del juego
        }
        
        window.setTimeout(() => {
            // Usar las nuevas funciones del diseo
            if (typeof showMainMenu === 'function') {
                showMainMenu();
            } else {
                // Fallback al mtodo anterior
                document.getElementById('gameAreaWrapper').classList.remove('active');
                document.getElementById('startMenuWrapper').style.maxHeight = '1000px';
            }
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
        }, 2500);
    });

    // Game Over por quedarse sin dinero o ser comido
    socket.on('gameOver', function (data) {
        global.gameStart = false;
        updateMobileCashoutButton();
        render.drawErrorMessage(data.message || 'Perdiste! Te quedaste sin dinero.', graph, global.screen);
        
        // Ocultar controles del juego
        document.getElementById('gameControls').style.display = 'none';
        
        // Mostrar mensaje en el chat
        window.chat.addSystemLine(' ' + (data.message || 'Perdiste! Te quedaste sin dinero.'));
        
        // Si queda dinero residual, informar
        if (data.finalMoney && data.finalMoney > 0) {
            window.chat.addSystemLine(` Se devolvieron $${data.finalMoney} a tu balance.`);
        }
        
        // Procesar registro de partida si hay una apuesta activa
        if (currentUser && (sessionToken || currentUser.id) && global.betAmount && global.betAmount > 0) {
            console.log('[GAME_OVER] Procesando registro de partida por game over...');
            
            // Calcular duración del juego
            const gameDuration = global.gameStart ? Math.floor((Date.now() - global.gameStart) / 1000) : 0;
            const originalBet = global.originalBetAmount || global.betAmount;
            const finalMoney = data.finalMoney || 0;
            
            // Preparar headers según el tipo de autenticación
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Para usuarios con sessionToken (autenticación tradicional)
            if (sessionToken) {
                headers['Authorization'] = 'Bearer ' + sessionToken;
            }
            
            // Llamar a la API para registrar la partida
            fetch('/api/voluntaryDisconnect', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ 
                    betAmount: finalMoney, // Usar el dinero final (puede ser 0 si fue comido)
                    originalBetAmount: originalBet,
                    maxMass: global.player ? global.player.massTotal : 0,
                    duration: gameDuration,
                    disconnectReason: 'eaten' // Marcar como comido
                }),
                credentials: 'include'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    currentUser.balance = data.newBalance;
                    updateNavAuth();
                    console.log(`[GAME_OVER] Partida registrada. Devuelto: $${data.returned}, nuevo balance: $${data.newBalance}`);
                } else {
                    console.error('[GAME_OVER] Error registrando partida:', data.error);
                }
            })
            .catch(error => {
                console.error('[GAME_OVER] Error al registrar partida:', error);
            });
        }
        
        // Guardar datos antes de resetear
        const originalBet = global.originalBetAmount || global.betAmount;
        const gameDuration = global.gameStart ? Math.floor((Date.now() - global.gameStart) / 1000) : 0;
        const finalMoney = data.finalMoney || 0;
        
        // Resetear el dinero del juego
        global.betAmount = 0;
        
        // Regresar al lobby después de mostrar el mensaje
        window.setTimeout(() => {
            // Si hay datos de partida, redirigir a la página de resultados
            if (currentUser && originalBet && originalBet > 0) {
                // Redirigir a la página de resultados del cashout
                redirectToCashoutResults({
                    player: currentUser.username,
                    initialBet: originalBet,
                    finalMass: global.player ? global.player.massTotal : 0,
                    duration: gameDuration,
                    winnings: 0, // Cuando es comido, no gana nada
                    balance: currentUser.balance,
                    commission: 0, // No hay comisión en pérdidas
                    wasEaten: true // Marcar que el jugador fue comido
                });
            } else {
                // Usar las nuevas funciones del diseño
                if (typeof showMainMenu === 'function') {
                    showMainMenu();
                } else {
                    // Fallback al método anterior
                    document.getElementById('gameAreaWrapper').classList.remove('active');
                    document.getElementById('startMenuWrapper').style.maxHeight = '1000px';
                }
            }
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
        }, 3000); // 3 segundos para que el jugador lea el mensaje
    });

    // Zona roja
    socket.on('redZoneUpdate', function (zoneInfo) {
        redZone = zoneInfo;
    });

    socket.on('redZoneDamage', function () {
        // Efecto visual cuando el jugador recibe dao de la zona roja
        window.chat.addSystemLine(' Ests en la zona roja! Recibiendo dao...');
    });

    socket.on('kick', function (reason) {
        global.gameStart = false;
        updateMobileCashoutButton();
        global.kicked = true;
        if (reason !== '') {
            render.drawErrorMessage('You were kicked for: ' + reason, graph, global.screen);
        }
        else {
            render.drawErrorMessage('You were kicked!', graph, global.screen);
        }
        socket.close();
    });

    // Cash out automtico
    socket.on('autoCashoutWarning', function (data) {
        const seconds = Math.ceil(data.delay / 1000);
        window.chat.addSystemLine(` Alcanzaste el lmite mximo! Cash out automtico en ${seconds} segundos...`);
        
        // Mostrar contador de cuenta regresiva
        let countdown = seconds;
        const countdownInterval = setInterval(() => {
            countdown--;
            if (countdown > 0) {
                window.chat.addSystemLine(` Cash out automtico en ${countdown} segundos...`);
            } else {
                clearInterval(countdownInterval);
            }
        }, 1000);
    });

    socket.on('forceCashout', function () {
        window.chat.addSystemLine(' Cash out automtico ejecutado!');
        global.voluntaryExit = true;
        handleDisconnect();
    });

    // Evento cuando el jugador choca con un virus
    socket.on('virusCollision', function (data) {
        console.log(`[CLIENT_VIRUS] EVENTO RECIBIDO! Data:`, data);
        window.chat.addSystemLine(' Chocaste con un virus! Tu dinero se dividi entre tus clulas.');
        
        // Actualizar las clulas del jugador con el dinero dividido
        console.log(`[CLIENT_VIRUS] Verificando condiciones - data: ${!!data}, data.cells: ${!!data?.cells}, global.player: ${!!global.player}`);
        if (data && data.cells && global.player) {
            console.log(`[CLIENT_VIRUS] Actualizando ${data.cells.length} clulas con dinero dividido`);
            console.log(`[CLIENT_VIRUS] Datos recibidos del servidor:`, data.cells);
            console.log(`[CLIENT_VIRUS] Estado actual de clulas ANTES:`, global.player.cells.map(cell => ({
                x: cell.x?.toFixed(0) || 'undefined',
                y: cell.y?.toFixed(0) || 'undefined', 
                gameMoney: cell.gameMoney || 'undefined'
            })));
            
            // Actualizar cada clula con su dinero especfico
            data.cells.forEach((cellData, index) => {
                if (global.player.cells[index]) {
                    global.player.cells[index].gameMoney = cellData.gameMoney;
                    console.log(`[CLIENT_VIRUS] Clula ${index} actualizada: ${global.player.cells[index].gameMoney} (era ${global.player.cells[index].gameMoney})`);
                } else {
                    console.log(`[CLIENT_VIRUS] ERROR: No se encontr la clula ${index} en global.player.cells (total: ${global.player.cells.length})`);
                }
            });
            
            console.log(`[CLIENT_VIRUS] Estado final de clulas DESPUS:`, global.player.cells.map(cell => ({
                x: cell.x?.toFixed(0) || 'undefined',
                y: cell.y?.toFixed(0) || 'undefined',
                gameMoney: cell.gameMoney || 'undefined'
            })));
            
            // Actualizar el dinero total
            if (data.totalMoney !== undefined) {
                global.betAmount = data.totalMoney;
                console.log(`[CLIENT_VIRUS] Dinero total actualizado: $${data.totalMoney}`);
            }
        } else {
            console.log(`[CLIENT_VIRUS] ERROR: No se pudo actualizar clulas - data:`, data, `global.player:`, global.player);
        }
    });



    // Evento cuando el jugador gana dinero al comerse una clula
    socket.on('moneyGained', function (data) {
        window.chat.addSystemLine(` Ganaste $${data.amount} al comerte una clula!`);
    });

    // Evento cuando el jugador pierde dinero al ser comido
    socket.on('moneyLost', function (data) {
        window.chat.addSystemLine(` Perdiste $${data.amount} al ser comido!`);
    });

    // Evento cuando el jugador sobrevive siendo comido
    socket.on('playerSurvived', function (data) {
        console.log(`[CLIENT_SURVIVAL] Sobreviviste! Data:`, data);
        window.chat.addSystemLine(' ' + (data.message || 'Sobreviviste siendo dividido en 4 partes!'));
        
        if (data.cells && global.player) {
            console.log(`[CLIENT_SURVIVAL] Actualizando ${data.cells.length} clulas con proteccin`);
            
            // Actualizar las clulas del jugador
            data.cells.forEach((cellData, index) => {
                if (global.player.cells[index]) {
                    global.player.cells[index].gameMoney = cellData.gameMoney;
                    global.player.cells[index].isProtected = cellData.isProtected;
                    global.player.cells[index].protectionTimeLeft = cellData.protectionTimeLeft;
                    console.log(`[CLIENT_SURVIVAL] Clula ${index}: $${cellData.gameMoney}, protegida: ${cellData.isProtected}, tiempo: ${cellData.protectionTimeLeft}s`);
                }
            });
            
            // Actualizar el dinero total
            if (data.totalMoney !== undefined) {
                global.betAmount = data.totalMoney;
                console.log(`[CLIENT_SURVIVAL] Dinero total actualizado: $${global.betAmount}`);
            }
        }
    });

    // Evento cuando otro jugador sobrevive
    socket.on('playerSurvived', function (data) {
        if (data.name && data.name !== global.playerName) {
            window.chat.addSystemLine(' ' + (data.message || `${data.name} sobrevivi siendo dividido!`));
        }
    });

    // Manejar activacin de poderes
    socket.on('powerActivated', function (data) {
        let emoji = '';
        let message = '';
        
        switch(data.powerType) {
            case 'speed_boost':
                emoji = '';
                message = `Comiste ${data.name}! Velocidad x${data.multiplier} por ${data.duration/1000} segundos`;
                break;
            case 'mass_boost':
                emoji = '';
                message = `Comiste ${data.name}! Masa x${data.multiplier} por ${data.duration/1000} segundos (Crecimiento masivo!)`;
                break;
            case 'shield':
                emoji = '';
                message = `Comiste ${data.name}! Escudo protector activo por ${data.duration/1000} segundos`;
                break;
            default:
                emoji = '';
                message = `Poder activado! ${data.name} por ${data.duration/1000} segundos`;
        }
        
        window.chat.addSystemLine(`${emoji} ${message}`);
    });

    // Event listeners para el sistema de eventos de velocidad
    socket.on('speedEventCountdownAlert', function (data) {
        console.log('[SPEED_EVENT] Alerta de cuenta regresiva recibida:', data);
        
        const message = ` Evento de velocidad en ${data.minutesLeft} minutos! Preprate para la velocidad x2!`;
        window.chat.addSystemLine(message);
        
        // Mostrar notificacin visual de cuenta regresiva
        showSpeedEventCountdownAlert(data.minutesLeft);
    });

    socket.on('speedEventWarning', function (data) {
        console.log('[SPEED_EVENT] Advertencia final recibida:', data);
        
        const message = ` Evento de velocidad en ${data.timeUntilEvent} segundos! Preprate para la velocidad x2!`;
        window.chat.addSystemLine(message);
        
        // Mostrar notificacin visual de advertencia final
        showSpeedEventWarning(data.timeUntilEvent);
    });

    socket.on('speedEventStart', function (data) {
        console.log('[SPEED_EVENT] Evento iniciado:', data);
        
        const message = ` EVENTO DE VELOCIDAD ACTIVADO! Todos los jugadores tienen velocidad x${data.speedMultiplier}!`;
        window.chat.addSystemLine(message);
        
        // Mostrar notificacin visual del evento activo
        showSpeedEventActive(data.duration, data.speedMultiplier);
    });

    socket.on('speedEventCountdown', function (data) {
        console.log('[SPEED_EVENT] Contador actualizado:', data);
        
        // Actualizar el contador del evento
        updateSpeedEventCountdown(data.timeLeft);
    });

    socket.on('speedEventEnd', function () {
        console.log('[SPEED_EVENT] Evento finalizado');
        
        const message = ' El evento de velocidad ha terminado!';
        window.chat.addSystemLine(message);
        
        // Ocultar notificaciones del evento
        hideSpeedEventNotifications();
    });

    // Event listeners para el sistema de eventos de bombas
    socket.on('bombEventCountdownAlert', function (data) {
        console.log('[BOMB_EVENT] Alerta de cuenta regresiva recibida:', data);
        
        const message = ` Evento de bombas en ${data.minutesLeft} minutos! Preprate para las bombas mviles!`;
        window.chat.addSystemLine(message);
        
        // Mostrar notificacin visual de cuenta regresiva
        showBombEventCountdownAlert(data.minutesLeft);
    });

    socket.on('bombEventWarning', function (data) {
        console.log('[BOMB_EVENT] Advertencia final recibida:', data);
        
        const message = ` Evento de bombas en ${data.timeUntilEvent} segundos! Preprate para las bombas mviles!`;
        window.chat.addSystemLine(message);
        
        // Mostrar notificacin visual de advertencia final
        showBombEventWarning(data.timeUntilEvent);
    });

    socket.on('bombEventStart', function (data) {
        console.log('[BOMB_EVENT] Evento iniciado:', data);
        
        const message = ` EVENTO DE BOMBAS ACTIVADO! ${data.bombCount} bombas mviles en el campo!`;
        window.chat.addSystemLine(message);
        
        // Mostrar notificacin visual del evento activo
        showBombEventActive(data.duration, data.bombCount);
    });

    socket.on('bombEventCountdown', function (data) {
        console.log('[BOMB_EVENT] Contador actualizado:', data);
        
        // Actualizar el contador del evento
        updateBombEventCountdown(data.timeLeft);
    });

    socket.on('bombEventEnd', function () {
        console.log('[BOMB_EVENT] Evento finalizado');
        
        const message = ' El evento de bombas ha terminado!';
        window.chat.addSystemLine(message);
        
        // Ocultar notificaciones del evento
        hideBombEventNotifications();
    });

    socket.on('bombCollision', function (data) {
        console.log('[BOMB_EVENT] Colisin con bomba:', data);
        
        const message = ' Chocaste con una bomba! Te has dividido!';
        window.chat.addSystemLine(message);
    });
    
    console.log('[SOCKET] ✅ Configuración de socket completada');
}

const isUnnamedCell = (name) => name.length < 1;

const getPosition = (entity, player, screen) => {
    return {
        x: entity.x - player.x + screen.width / 2,
        y: entity.y - player.y + screen.height / 2
    }
}

window.requestAnimFrame = (function () {
    return window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.msRequestAnimationFrame ||
        function (callback) {
            window.setTimeout(callback, 1000 / 60);
        };
})();

window.cancelAnimFrame = (function (handle) {
    return window.cancelAnimationFrame ||
        window.mozCancelAnimationFrame;
})();

function animloop() {
    global.animLoopHandle = window.requestAnimFrame(animloop);
    gameLoop();
}

function gameLoop() {
    if (global.gameStart && global.gameStart > 0) {
        // Actualizar progreso del cash out
        updateCashOutProgress();
        
        graph.fillStyle = global.backgroundColor;
        graph.fillRect(0, 0, global.screen.width, global.screen.height);

        render.drawGrid(global, player, global.screen, graph);
        foods.forEach(food => {
            let position = getPosition(food, player, global.screen);
            render.drawFood(position, food, graph);
        });
        fireFood.forEach(fireFood => {
            let position = getPosition(fireFood, player, global.screen);
            render.drawFireFood(position, fireFood, playerConfig, graph);
        });
        viruses.forEach(virus => {
            let position = getPosition(virus, player, global.screen);
            render.drawVirus(position, virus, graph);
        });
        powerFoods.forEach(powerFood => {
            let position = getPosition(powerFood, player, global.screen);
            render.drawPowerFood(position, powerFood, graph);
        });
        
        // Renderizar bombas si el evento est activo
        bombs.forEach(bomb => {
            let position = getPosition(bomb, player, global.screen);
            render.drawBomb(position, bomb, graph);
        });


        let borders = { // Position of the borders on the screen
            left: global.screen.width / 2 - player.x,
            right: global.screen.width / 2 + global.game.width - player.x,
            top: global.screen.height / 2 - player.y,
            bottom: global.screen.height / 2 + global.game.height - player.y
        }
        
        // Asegurar que los bordes estn correctamente calculados
        if (global.game.width && global.game.height) {
            borders.left = Math.max(borders.left, 0);
            borders.right = Math.min(borders.right, global.screen.width);
            borders.top = Math.max(borders.top, 0);
            borders.bottom = Math.min(borders.bottom, global.screen.height);
        }
        
        if (global.borderDraw) {
            render.drawBorder(borders, graph);
        }

        // Dibujar zona roja (solo si est habilitada)
        if (redZone && global.showRedZone) {
            render.drawRedZone(redZone, player, global.screen, graph);
        }

        var cellsToDraw = [];
        for (var i = 0; i < users.length; i++) {
            let color = 'hsl(' + users[i].hue + ', 100%, 50%)';
            let borderColor = 'hsl(' + users[i].hue + ', 100%, 45%)';
            for (var j = 0; j < users[i].cells.length; j++) {
                const cellData = {
                    color: color,
                    borderColor: borderColor,
                    mass: users[i].cells[j].mass,
                    name: users[i].name,
                    radius: users[i].cells[j].radius,
                    x: users[i].cells[j].x - player.x + global.screen.width / 2,
                    y: users[i].cells[j].y - player.y + global.screen.height / 2,
                    gameMoney: users[i].cells[j].gameMoney || 0,
                    isProtected: users[i].cells[j].isProtected || false,
                    protectionTimeLeft: users[i].cells[j].protectionTimeLeft || 0,
                    hasShield: users[i].cells[j].hasShield || false,
                    skinId: users[i].skinId || users[i].cells[j].skinId || 1 // Agregar skinId
                };
                
                // Debug log para rastrear skinId
                if (users[i].name === global.playerName) {
                    // console.log(`[CELL_DEBUG] Célula de ${users[i].name}: skinId=${cellData.skinId}, users[i].skinId=${users[i].skinId}, cell.skinId=${users[i].cells[j].skinId}`);
                }
                

                
                cellsToDraw.push(cellData);
            }
        }
        cellsToDraw.sort(function (obj1, obj2) {
            return obj1.mass - obj2.mass;
        });
        render.drawCells(cellsToDraw, playerConfig, global.toggleMassState, borders, graph);

        // Dibujar el radar de fondo (siempre activo)
        if (global.showBackgroundRadar) {
            render.drawBackgroundRadar(player, users, global.screen, graph, global);
        }
        
        // Brújula simple de prueba (siempre activa para debug)
        if (global.testSimpleRadar) {
            render.drawSimpleRadarCompass(player, global.screen, graph, global);
        }
        
        // Dibujar la brújula que apunta hacia células cercanas
        if (global.showCompass) {
            console.log('[COMPASS_DRAW] Dibujando brújula - useRadarCompass:', global.useRadarCompass, 'useAdvancedCompass:', global.useAdvancedCompass);
            if (global.useRadarCompass) {
                render.drawRadarCompass(player, users, global.screen, graph, global);
            } else if (global.useAdvancedCompass) {
                render.drawAdvancedCompass(player, users, global.screen, graph, global);
            } else {
                render.drawCompass(player, users, global.screen, graph, global);
            }
        }

        // Dibujar barra de progreso del cash out si est activo
        if (global.isCashOutActive) {
            render.drawCashOutProgress(global.cashOutProgress, global.screen, graph);
        }

        // Dibujar ping de latencia
        render.drawPing(currentPing, global.screen, graph);

        socket.emit('0', window.canvas.target); // playerSendTarget "Heartbeat".
    }
}

window.addEventListener('resize', resize);

// Manejo de teclas para cash out y brújula
window.addEventListener('keydown', function(e) {
    if (e.key === 'c' || e.key === 'C') {
        if (global.gameStart && global.gameStart > 0 && global.betAmount > 0 && !global.isCashOutActive) {
            startCashOut();
        }
    }
    
    // Controles de la brújula
    if (e.key === 'b' || e.key === 'B') {
        global.showCompass = !global.showCompass;
        console.log(`[COMPASS] Brújula ${global.showCompass ? 'activada' : 'desactivada'}`);
        window.chat.addSystemLine(` Brújula ${global.showCompass ? 'activada' : 'desactivada'}`);
    }
    
    if (e.key === 'v' || e.key === 'V') {
        global.useAdvancedCompass = !global.useAdvancedCompass;
        global.useRadarCompass = false; // Desactivar radar al cambiar a avanzada
        console.log(`[COMPASS] Brújula ${global.useAdvancedCompass ? 'avanzada' : 'simple'} activada`);
        window.chat.addSystemLine(` Brújula ${global.useAdvancedCompass ? 'avanzada' : 'simple'} activada`);
    }
    
    if (e.key === 'r' || e.key === 'R') {
        global.useRadarCompass = !global.useRadarCompass;
        global.useAdvancedCompass = false; // Desactivar avanzada al activar radar
        console.log(`[COMPASS] Radar ${global.useRadarCompass ? 'activado' : 'desactivado'}`);
        window.chat.addSystemLine(` Radar ${global.useRadarCompass ? 'activado' : 'desactivado'}`);
    }
    
    if (e.key === 't' || e.key === 'T') {
        global.showBackgroundRadar = !global.showBackgroundRadar;
        console.log(`[COMPASS] Radar de fondo ${global.showBackgroundRadar ? 'activado' : 'desactivado'}`);
        window.chat.addSystemLine(` Radar de fondo ${global.showBackgroundRadar ? 'activado' : 'desactivado'}`);
    }
    
    if (e.key === 'p' || e.key === 'P') {
        global.testSimpleRadar = !global.testSimpleRadar;
        console.log(`[COMPASS] Brújula de prueba ${global.testSimpleRadar ? 'activada' : 'desactivada'}`);
        window.chat.addSystemLine(` Brújula de prueba ${global.testSimpleRadar ? 'activada' : 'desactivada'}`);
    }
    
    // Controles para ajustar el rango del radar
    if (e.key === '+' || e.key === '=') {
        if (global.useRadarCompass) {
            global.radarRange = Math.min(global.radarRange + 1000, 10000);
            console.log(`[RADAR] Rango aumentado a ${global.radarRange}px`);
            window.chat.addSystemLine(` Rango del radar: ${global.radarRange/1000}km`);
        }
    }
    
    if (e.key === '-') {
        if (global.useRadarCompass) {
            global.radarRange = Math.max(global.radarRange - 1000, 2000);
            console.log(`[RADAR] Rango disminuido a ${global.radarRange}px`);
            window.chat.addSystemLine(` Rango del radar: ${global.radarRange/1000}km`);
        }
    }
    
    if (e.key === 'h' || e.key === 'H') {
        showCompassHelp();
    }
});

window.addEventListener('keyup', function(e) {
    if (e.key === 'c' || e.key === 'C') {
        if (global.isCashOutActive) {
            cancelCashOut();
        }
    }
});

function startCashOut() {
    global.isCashOutActive = true;
    global.cashOutStartTime = Date.now();
    global.cashOutProgress = 0;
    console.log('[CASHOUT] Iniciando cash out...');
    window.chat.addSystemLine(' Mantén presionada la tecla C para hacer cash out...');
    
    // Dividir todas las células en 4 partes cuando se inicia el cashout
    if (global.player && global.player.cells && global.player.cells.length > 0) {
        console.log('[CASHOUT] Dividiendo células en 4 partes...');
        for (let i = 0; i < global.player.cells.length; i++) {
            socket.emit('split', { cellIndex: i, pieces: 4 });
        }
        window.chat.addSystemLine(' 🎯 Células divididas en 4 partes!');
    }
    
    // Enviar alerta de cashout ANTES de desconectarse
    socket.emit('cashoutStarted', {
        playerName: currentUser ? currentUser.username : global.playerName,
        betAmount: global.betAmount
    });
    
    // NO activar brújula para el jugador que hace cashout
    // La brújula se activará para otros jugadores a través del evento combatAlert
    console.log('[CASHOUT] Brújula NO activada para el jugador que hace cashout');
    window.chat.addSystemLine(' 🎯 Células divididas - Otros jugadores verán tu ubicación!');
    
    updateMobileCashoutButton();
}

function cancelCashOut() {
    global.isCashOutActive = false;
    global.cashOutProgress = 0;
    console.log('[CASHOUT] Cash out cancelado');
    window.chat.addSystemLine(' Cash out cancelado');
    
    // No hay brújula que desactivar ya que no se activó para este jugador
    console.log('[CASHOUT] No hay brújula que desactivar');
    
    updateMobileCashoutButton();
}

function updateCashOutProgress() {
    if (global.isCashOutActive) {
        const elapsed = Date.now() - global.cashOutStartTime;
        global.cashOutProgress = Math.min(elapsed / global.cashOutDuration, 1);
        
        // No mantener brújula activa para el jugador que hace cashout
        // La brújula se maneja a través del evento cashoutAlert para otros jugadores
        
        if (global.cashOutProgress >= 1) {
            // Cash out completado
            global.isCashOutActive = false;
            global.voluntaryExit = true;
            console.log('[CASHOUT] Cash out completado, saliendo del juego...');
            window.chat.addSystemLine(' Cash out completado! Saliendo del juego...');
            
            // No hay brújula que desactivar para el jugador que hace cashout
            
            handleDisconnect();
        }
    }
    
    // Actualizar el estado del botón de cashout móvil
    updateMobileCashoutButton();
}

function updateMobileCashoutButton() {
    const mobileCashoutBtn = document.getElementById('mobileCashoutBtn');
    if (!mobileCashoutBtn) return;
    
    // Verificar si el usuario puede hacer cashout
    const canCashout = global.gameStart && global.gameStart > 0 && global.betAmount > 0 && !global.isCashOutActive;
    
    if (canCashout) {
        mobileCashoutBtn.disabled = false;
        mobileCashoutBtn.innerHTML = '<i class="fa-solid fa-arrow-right-from-bracket"></i> CASH OUT';
    } else if (global.isCashOutActive) {
        mobileCashoutBtn.disabled = true;
        mobileCashoutBtn.textContent = '⏳ CASHING OUT...';
    } else {
        mobileCashoutBtn.disabled = true;
        mobileCashoutBtn.innerHTML = '<i class="fa-solid fa-arrow-right-from-bracket"></i> CASH OUT';
    }
}

function resize() {
    if (!socket) return;

    player.screenWidth = c.width = global.screen.width = global.playerType == 'player' ? window.innerWidth : global.game.width;
    player.screenHeight = c.height = global.screen.height = global.playerType == 'player' ? window.innerHeight : global.game.height;

    if (global.playerType == 'spectator') {
        player.x = global.game.width / 2;
        player.y = global.game.height / 2;
    }

    // Asegurar que el jugador est dentro de los lmites del nuevo mapa
    if (global.playerType == 'player' && global.game.width && global.game.height) {
        if (player.x < 0 || player.x > global.game.width) {
            player.x = global.game.width / 2;
        }
        if (player.y < 0 || player.y > global.game.height) {
            player.y = global.game.height / 2;
        }
    }

    socket.emit('windowResized', { screenWidth: global.screen.width, screenHeight: global.screen.height });
}



// Log de verificacin
console.log('Script app.js cargado completamente');
console.log('[TEST] 🧪 Sistema de radar cargado - Versión 2024-01-27');

// Función de test para verificar que el sistema funciona
window.testRadarSystem = function() {
    console.log('[TEST] 🧪 Iniciando test del sistema de radar...');
    console.log('[TEST] global.radarData:', global.radarData);
    console.log('[TEST] global.showCompass:', global.showCompass);
    console.log('[TEST] global.testSimpleRadar:', global.testSimpleRadar);
    
    if (global.radarData && global.radarData.length > 0) {
        console.log('[TEST] ✅ Datos del radar disponibles');
        return true;
    } else {
        console.log('[TEST] ❌ No hay datos del radar');
        return false;
    }
};

// Variables globales para el sistema de eventos de velocidad
let speedEventWarningElement = null;
let speedEventActiveElement = null;
let speedEventCountdownElement = null;
let speedEventCountdownAlertElement = null;

// Variables globales para el sistema de eventos de bombas
let bombEventWarningElement = null;
let bombEventActiveElement = null;
let bombEventCountdownElement = null;
let bombEventCountdownAlertElement = null;

// Funciones para el sistema de eventos de velocidad
function showSpeedEventCountdownAlert(minutesLeft) {
    // Crear elemento de alerta de cuenta regresiva si no existe
    if (!speedEventCountdownAlertElement) {
        speedEventCountdownAlertElement = document.createElement('div');
        speedEventCountdownAlertElement.id = 'speedEventCountdownAlert';
        speedEventCountdownAlertElement.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(45deg, #ff9f43, #f39c12);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
            z-index: 1000;
            box-shadow: 0 3px 10px rgba(255, 159, 67, 0.3);
            animation: slideDown 0.5s ease-out;
        `;
        document.body.appendChild(speedEventCountdownAlertElement);
    }
    
    speedEventCountdownAlertElement.innerHTML = `
         Evento de velocidad en ${minutesLeft} minutos! <br>
        <small>Preprate para la velocidad x2!</small>
    `;
    speedEventCountdownAlertElement.style.display = 'block';
    
    // Ocultar despus de 5 segundos
    setTimeout(() => {
        if (speedEventCountdownAlertElement) {
            speedEventCountdownAlertElement.style.display = 'none';
        }
    }, 5000);
}

function showSpeedEventWarning(timeUntilEvent) {
    // Crear elemento de advertencia si no existe
    if (!speedEventWarningElement) {
        speedEventWarningElement = document.createElement('div');
        speedEventWarningElement.id = 'speedEventWarning';
        speedEventWarningElement.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(45deg, #ff6b35, #f7931e);
            color: white;
            padding: 15px 25px;
            border-radius: 10px;
            font-size: 18px;
            font-weight: bold;
            text-align: center;
            z-index: 1000;
            box-shadow: 0 4px 15px rgba(255, 107, 53, 0.3);
            animation: pulse 1s infinite;
        `;
        document.body.appendChild(speedEventWarningElement);
    }
    
    speedEventWarningElement.innerHTML = `
         EVENTO DE VELOCIDAD EN ${timeUntilEvent} SEGUNDOS! <br>
        <small>Preprate para la velocidad x2!</small>
    `;
    speedEventWarningElement.style.display = 'block';
    
    // Ocultar despus del tiempo especificado
    setTimeout(() => {
        if (speedEventWarningElement) {
            speedEventWarningElement.style.display = 'none';
        }
    }, timeUntilEvent * 1000);
}

function showSpeedEventActive(duration, speedMultiplier) {
    // Ocultar advertencia si est visible
    if (speedEventWarningElement) {
        speedEventWarningElement.style.display = 'none';
    }
    
    // Crear elemento de evento activo si no existe
    if (!speedEventActiveElement) {
        speedEventActiveElement = document.createElement('div');
        speedEventActiveElement.id = 'speedEventActive';
        speedEventActiveElement.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(45deg, #00d4aa, #00b894);
            color: white;
            padding: 20px 30px;
            border-radius: 15px;
            font-size: 20px;
            font-weight: bold;
            text-align: center;
            z-index: 1000;
            box-shadow: 0 6px 20px rgba(0, 212, 170, 0.4);
            animation: bounce 0.5s ease-in-out;
        `;
        document.body.appendChild(speedEventActiveElement);
    }
    
    // Crear elemento de contador si no existe
    if (!speedEventCountdownElement) {
        speedEventCountdownElement = document.createElement('div');
        speedEventCountdownElement.id = 'speedEventCountdown';
        speedEventCountdownElement.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
            z-index: 1000;
        `;
        document.body.appendChild(speedEventCountdownElement);
    }
    
    speedEventActiveElement.innerHTML = `
         EVENTO DE VELOCIDAD ACTIVADO! <br>
        <small>Todos los jugadores tienen velocidad x${speedMultiplier}!</small>
    `;
    speedEventActiveElement.style.display = 'block';
    speedEventCountdownElement.style.display = 'block';
    
    // Inicializar contador
    const initialTime = Math.floor(duration / 1000);
    updateSpeedEventCountdown(initialTime);
}

function updateSpeedEventCountdown(timeLeft) {
    if (speedEventCountdownElement) {
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        speedEventCountdownElement.innerHTML = `
             Tiempo restante: ${timeString}
        `;
        
        // Cambiar color segn el tiempo restante
        if (timeLeft <= 30) {
            speedEventCountdownElement.style.background = 'rgba(255, 0, 0, 0.8)';
            speedEventCountdownElement.style.animation = 'blink 1s infinite';
        } else if (timeLeft <= 60) {
            speedEventCountdownElement.style.background = 'rgba(255, 165, 0, 0.8)';
        } else {
            speedEventCountdownElement.style.background = 'rgba(0, 0, 0, 0.8)';
        }
    }
}

function hideSpeedEventNotifications() {
    if (speedEventWarningElement) {
        speedEventWarningElement.style.display = 'none';
    }
    if (speedEventActiveElement) {
        speedEventActiveElement.style.display = 'none';
    }
    if (speedEventCountdownElement) {
        speedEventCountdownElement.style.display = 'none';
    }
    if (speedEventCountdownAlertElement) {
        speedEventCountdownAlertElement.style.display = 'none';
    }
}

// Agregar estilos CSS para las animaciones
const style = document.createElement('style');
style.textContent = `
    @keyframes pulse {
        0% { transform: translateX(-50%) scale(1); }
        50% { transform: translateX(-50%) scale(1.05); }
        100% { transform: translateX(-50%) scale(1); }
    }
    
    @keyframes bounce {
        0% { 
            transform: translateX(-50%) scale(0.3);
        }
        50% { 
            transform: translateX(-50%) scale(1.05);
        }
        100% { 
            transform: translateX(-50%) scale(1);
        }
    }
    
    @keyframes blink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0.5; }
    }
    
    @keyframes slideDown {
        0% { 
            transform: translateX(-50%) translateY(-100%);
            opacity: 0;
        }
        100% { 
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style);

// Funciones para el sistema de eventos de bombas
function showBombEventCountdownAlert(minutesLeft) {
    // Crear elemento de alerta de cuenta regresiva si no existe
    if (!bombEventCountdownAlertElement) {
        bombEventCountdownAlertElement = document.createElement('div');
        bombEventCountdownAlertElement.id = 'bombEventCountdownAlert';
        bombEventCountdownAlertElement.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(45deg, #e74c3c, #c0392b);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
            z-index: 1000;
            box-shadow: 0 3px 10px rgba(231, 76, 60, 0.3);
            animation: slideDown 0.5s ease-out;
        `;
        document.body.appendChild(bombEventCountdownAlertElement);
    }
    
    bombEventCountdownAlertElement.innerHTML = `
         Evento de bombas en ${minutesLeft} minutos! <br>
        <small>Preprate para las bombas mviles!</small>
    `;
    bombEventCountdownAlertElement.style.display = 'block';
    
    // Ocultar despus de 5 segundos
    setTimeout(() => {
        if (bombEventCountdownAlertElement) {
            bombEventCountdownAlertElement.style.display = 'none';
        }
    }, 5000);
}

function showBombEventWarning(timeUntilEvent) {
    // Crear elemento de advertencia si no existe
    if (!bombEventWarningElement) {
        bombEventWarningElement = document.createElement('div');
        bombEventWarningElement.id = 'bombEventWarning';
        bombEventWarningElement.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(45deg, #e74c3c, #c0392b);
            color: white;
            padding: 15px 25px;
            border-radius: 10px;
            font-size: 18px;
            font-weight: bold;
            text-align: center;
            z-index: 1000;
            box-shadow: 0 4px 15px rgba(231, 76, 60, 0.3);
            animation: pulse 1s infinite;
        `;
        document.body.appendChild(bombEventWarningElement);
    }
    
    bombEventWarningElement.innerHTML = `
         EVENTO DE BOMBAS EN ${timeUntilEvent} SEGUNDOS! <br>
        <small>Preprate para las bombas mviles!</small>
    `;
    bombEventWarningElement.style.display = 'block';
    
    // Ocultar despus del tiempo especificado
    setTimeout(() => {
        if (bombEventWarningElement) {
            bombEventWarningElement.style.display = 'none';
        }
    }, timeUntilEvent * 1000);
}

function showBombEventActive(duration, bombCount) {
    // Ocultar advertencia si est visible
    if (bombEventWarningElement) {
        bombEventWarningElement.style.display = 'none';
    }
    
    // Crear elemento de evento activo si no existe
    if (!bombEventActiveElement) {
        bombEventActiveElement = document.createElement('div');
        bombEventActiveElement.id = 'bombEventActive';
        bombEventActiveElement.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(45deg, #e74c3c, #c0392b);
            color: white;
            padding: 20px 30px;
            border-radius: 15px;
            font-size: 20px;
            font-weight: bold;
            text-align: center;
            z-index: 1000;
            box-shadow: 0 6px 20px rgba(231, 76, 60, 0.4);
            animation: bounce 0.5s ease-in-out;
        `;
        document.body.appendChild(bombEventActiveElement);
    }
    
    // Crear elemento de contador si no existe
    if (!bombEventCountdownElement) {
        bombEventCountdownElement = document.createElement('div');
        bombEventCountdownElement.id = 'bombEventCountdown';
        bombEventCountdownElement.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
            z-index: 1000;
        `;
        document.body.appendChild(bombEventCountdownElement);
    }
    
    bombEventActiveElement.innerHTML = `
         EVENTO DE BOMBAS ACTIVADO! <br>
        <small>${bombCount} bombas mviles en el campo!</small>
    `;
    bombEventActiveElement.style.display = 'block';
    bombEventCountdownElement.style.display = 'block';
    
    // Inicializar contador
    const initialTime = Math.floor(duration / 1000);
    updateBombEventCountdown(initialTime);
}

function updateBombEventCountdown(timeLeft) {
    if (bombEventCountdownElement) {
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        bombEventCountdownElement.innerHTML = `
             Tiempo restante: ${timeString}
        `;
        
        // Cambiar color segn el tiempo restante
        if (timeLeft <= 30) {
            bombEventCountdownElement.style.background = 'rgba(255, 0, 0, 0.8)';
            bombEventCountdownElement.style.animation = 'blink 1s infinite';
        } else if (timeLeft <= 60) {
            bombEventCountdownElement.style.background = 'rgba(255, 165, 0, 0.8)';
        } else {
            bombEventCountdownElement.style.background = 'rgba(0, 0, 0, 0.8)';
        }
    }
}

function hideBombEventNotifications() {
    if (bombEventWarningElement) {
        bombEventWarningElement.style.display = 'none';
    }
    if (bombEventActiveElement) {
        bombEventActiveElement.style.display = 'none';
    }
    if (bombEventCountdownElement) {
        bombEventCountdownElement.style.display = 'none';
    }
    if (bombEventCountdownAlertElement) {
        bombEventCountdownAlertElement.style.display = 'none';
    }
}

// Funcin para redirigir a la pgina de resultados del cashout
function redirectToCashoutResults(data) {
    // Cerrar socket primero
    if (socket) {
        socket.close();
    }
    
    // Limpiar variables
    global.voluntaryExit = false;
    global.betAmount = 0;
    global.originalBetAmount = 0;
    global.cashOutProgress = 0;
    global.isCashOutActive = false;
    global.gameStart = false;
    global.isDisconnecting = false;
    
    // Construir URL con parmetros
    const params = new URLSearchParams({
        player: data.player,
        initialBet: data.initialBet,
        finalMass: data.finalMass,
        duration: data.duration,
        winnings: data.winnings,
        balance: data.balance
    });
    
    // Agregar parámetro wasEaten si existe
    if (data.wasEaten) {
        params.append('wasEaten', 'true');
    }
    
    // Redirigir a la pgina de resultados
    window.location.href = `cashout-results.html?${params.toString()}`;
}

// === NUEVO SISTEMA DE MANEJO DE APUESTAS ===
document.addEventListener('DOMContentLoaded', function() {
    console.log('Inicializando sistema de apuestas...');
    
    // Verificar estado de autenticacin al cargar la pgina
    checkAuthStatus();
    
    // Variables para el sistema de apuestas (usar variable global)
    // selectedBetAmount ya está declarada globalmente
    
    // Obtener elementos del nuevo diseo
    const betButtons = document.querySelectorAll('.betButton');
    const startButton = document.getElementById('startButton');
    const spectateButton = document.getElementById('spectateButton');
    const playerNameInput = document.getElementById('playerNameInput');
    const nameError = document.getElementById('nameError');
    
    // Función para manejar la selección de apuesta
    function handleBetSelection(button) {
        console.log('[DEBUG] Botón de apuesta clickeado:', button.getAttribute('data-amount'));
        // Verificar si el usuario est autenticado (soporta tanto sessionToken como Google OAuth)
        if (!currentUser || !(sessionToken || currentUser.id)) {
            updateBetStatus(' Debes iniciar sesin para apostar');
            return;
        }
        
        // Obtener el monto de la apuesta
        const amount = parseFloat(button.getAttribute('data-amount'));
        
        // Verificar si tiene suficiente balance
        if (currentUser.balance < amount) {
            updateBetStatus(` Balance insuficiente. Necesitas $${amount} pero tienes $${currentUser.balance.toFixed(2)}`);
            return;
        }
        
        // Seleccionar este botn
        betButtons.forEach(btn => btn.classList.remove('selected'));
        button.classList.add('selected');
        
        window.selectedBetAmount = amount;
        updateBetStatus(` Apuesta seleccionada: $${amount}`);
        
        // Activar el botón PLAY
        const startButton = document.getElementById('startButton');
        const playButtonText = document.getElementById('playButtonText');
        
        if (startButton && playButtonText) {
            startButton.disabled = false;
            startButton.classList.remove('bg-gray-500', 'text-gray-300', 'cursor-not-allowed', 'opacity-50');
        }
        
        console.log(`[BET] Monto seleccionado: $${amount}`);
    }

    // Manejar botones de apuesta con soporte para móvil
    console.log('[DEBUG] Configurando event listeners para botones de apuesta:', betButtons.length);
    betButtons.forEach(button => {
        // Evento click para desktop
        button.addEventListener('click', function() {
            handleBetSelection(this);
        });
        
        // Eventos táctiles para móvil
        button.addEventListener('touchstart', function(e) {
            e.preventDefault();
            console.log('[DEBUG] Touch start en botón de apuesta:', this.getAttribute('data-amount'));
        }, { passive: false });
        
        button.addEventListener('touchend', function(e) {
            e.preventDefault();
            console.log('[DEBUG] Touch end en botón de apuesta:', this.getAttribute('data-amount'));
            handleBetSelection(this);
        }, { passive: false });
        
        // Prevenir comportamiento por defecto del botón en móvil
        button.addEventListener('touchmove', function(e) {
            e.preventDefault();
        }, { passive: false });
    });
    
    // Función para manejar el inicio del juego
    function handleGameStart() {
        console.log('[PLAY] Botn PLAY clickeado');
        
        // Validar nombre del jugador
        let playerName = playerNameInput.value.trim();
        
        // Si no hay nombre ingresado y el usuario está autenticado con Google, usar su nombre como sugerencia
        if (!playerName && currentUser && currentUser.username) {
            playerNameInput.value = currentUser.username;
            playerName = currentUser.username;
            console.log(`[PLAY] Sugiriendo nombre de Google OAuth: ${playerName}`);
        }
        
        if (!playerName) {
            showNameError('Por favor ingresa tu nombre');
            return;
        }
        
        // Validar caracteres del nombre (permite letras, números, espacios y algunos caracteres especiales)
        if (!/^[a-zA-Z0-9_\s\-\.]+$/.test(playerName)) {
            showNameError('El nombre puede contener letras, números, espacios, guiones y puntos');
            return;
        }
        
        // Ocultar error de nombre si existe
        hideNameError();
        if(!window.selectedBetAmount){ window.selectedBetAmount = 2;}
        // Establecer el nombre global
        global.playerName = playerName;
        // Solo permitir jugar si hay una apuesta seleccionada y el usuario está autenticado
        if (window.selectedBetAmount > 0 && currentUser && (sessionToken || currentUser.id)) {
            console.log(`[PLAY] Iniciando juego con apuesta de $${window.selectedBetAmount}`);
            updateBetStatus(` Iniciando juego con apuesta de $${window.selectedBetAmount}...`);
            processBet(window.selectedBetAmount);
        } else if (!window.selectedBetAmount || window.selectedBetAmount <= 0) {
            // No hay apuesta seleccionada
            updateBetStatus(' ❌ Debes seleccionar una apuesta para jugar');
            return;
        } else if (!currentUser || !(sessionToken || currentUser.id)) {
            // Usuario no autenticado
            updateBetStatus(' ❌ Debes iniciar sesión para apostar');
            return;
        }
    }

    // Manejar botn PLAY con soporte para móvil
    if (startButton) {
        // Evento click para desktop
        startButton.addEventListener('click', handleGameStart);
        
        // Eventos táctiles para móvil
        startButton.addEventListener('touchstart', function(e) {
            e.preventDefault();
            console.log('[PLAY] Touch start en botón PLAY');
        }, { passive: false });
        
        startButton.addEventListener('touchend', function(e) {
            e.preventDefault();
            console.log('[PLAY] Touch end en botón PLAY');
            handleGameStart();
        }, { passive: false });
        
        // Prevenir comportamiento por defecto del botón en móvil
        startButton.addEventListener('touchmove', function(e) {
            e.preventDefault();
        }, { passive: false });
    }
    
    // Manejar botn SPECTATE
    if (spectateButton) {
        spectateButton.addEventListener('click', function() {
            console.log('[SPECTATE] Iniciando modo espectador');
            startSpectating();
        });
    }
    
    // Validacin del nombre en tiempo real
    if (playerNameInput) {
        playerNameInput.addEventListener('input', function() {
            const playerName = this.value.trim();
            
            if (playerName && !/^[a-zA-Z0-9_\s\-\.]+$/.test(playerName)) {
                showNameError('Solo letras, números, espacios, guiones y puntos');
            } else {
                hideNameError();
            }
        });
    }
    
    // Funciones auxiliares
    function showNameError(message) {
        if (nameError) {
            nameError.textContent = message;
            nameError.style.display = 'block';
        }
    }
    
    function hideNameError() {
        if (nameError) {
            nameError.style.display = 'none';
        }
    }
    
    function updateBetStatus(message) {
        const betStatus = document.getElementById('betStatus');
        if (betStatus) {
            betStatus.textContent = message;
            
            // Cambiar color segn el mensaje
            if (message.includes('')) {
                betStatus.style.color = '#10b981'; // Verde
            } else if (message.includes('') || message.includes('')) {
                betStatus.style.color = '#ef4444'; // Rojo
            } else {
                betStatus.style.color = '#9ca3af'; // Gris
            }
        }
    }
    
    // Actualizar interfaz inicialmente
    updateBetInterface();
    
    function startGameFree() {
        // Iniciar juego sin apuesta
        startGame('player');
    }
    
    function startSpectating() {
        // Iniciar modo espectador
        startGame('spectator');
    }
    
    /*function clearBetSelection() {
        window.selectedBetAmount = 0;
        betButtons.forEach(btn => btn.classList.remove('selected'));
        updateBetInterface();
    }*/
    
    // Hacer la funcin disponible globalmente
    window.updateBetInterface = updateBetInterface;
    //window.clearBetSelection = clearBetSelection;
});

// Funcin para actualizar el balance en la interfaz
function updateWalletBalance() {
    const navBalance = document.getElementById('navUserBalance');
    const walletBalance = document.getElementById('walletBalance');
    
    if (currentUser && navBalance && walletBalance) {
        const balance = currentUser.balance || 0;
        navBalance.textContent = balance.toFixed(2);
        walletBalance.textContent = balance.toFixed(2);
    }
}

// Funcin para actualizar la interfaz de apuestas (definida globalmente)
function updateBetInterface() {
    console.log('[DEBUG] Ejecutando updateBetInterface()');
    console.log('[DEBUG] currentUser:', currentUser);
    console.log('[DEBUG] sessionToken:', sessionToken);
    
    const playButtonText = document.getElementById('playButtonText');
    const startButton = document.getElementById('startButton');
    const betButtons = document.querySelectorAll('.betButton');
    const betStatus = document.getElementById('betStatus');
    
    console.log('[DEBUG] betStatus element:', betStatus);
    console.log('[DEBUG] betButtons found:', betButtons.length);
    
    if (!betStatus) {
        console.log('[DEBUG] betStatus element not found, exiting');
        return; // Si no existe el elemento, salir
    }
    
    // Actualizar la interfaz segn el estado de autenticacin
    // Funciona para usuarios tradicionales (con sessionToken) y usuarios de Google OAuth (sin sessionToken)
    const isAuthenticated = currentUser && (sessionToken || currentUser.id);
    console.log('[DEBUG] isAuthenticated:', isAuthenticated);
    
    if (isAuthenticated) {
        updateBetStatus(` Balance: $${currentUser.balance.toFixed(2)} - Selecciona tu apuesta`);
        
        // Habilitar el botón de PLAY
        if (startButton) {
            startButton.disabled = false;
            startButton.style.opacity = '1';
            startButton.style.cursor = 'pointer';
        }
        
        // Habilitar/deshabilitar botones segn el balance
        betButtons.forEach(button => {
            const amount = parseFloat(button.getAttribute('data-amount'));
            if (currentUser.balance >= amount) {
                button.disabled = false;
                button.style.opacity = '1';
            } else {
                button.disabled = true;
                button.style.opacity = '0.5';
            }
        });
        if(!window.selectedBetAmount){ window.selectedBetAmount = 2;}
        
    } else {
        updateBetStatus(' Inicia sesin con Google para jugar');
        window.selectedBetAmount = 0;
        
        // Deshabilitar el botón de PLAY
        if (startButton) {
            startButton.disabled = true;
            startButton.style.opacity = '0.5';
            startButton.style.cursor = 'not-allowed';
        }
        
        // Deshabilitar todos los botones de apuesta
        /*betButtons.forEach(btn => {
            btn.classList.remove('selected');
            btn.disabled = true;
            btn.style.opacity = '0.5';
        });*/
        
        // Actualizar texto del botn PLAY
        //if (playButtonText) playButtonText.textContent = 'LOGIN TO PLAY';
    }
}

// Funcin para actualizar el estado de apuestas
function updateBetStatus(message) {
    const betStatus = document.getElementById('betStatus');
    if (betStatus) {
        betStatus.textContent = message;
        
        // Cambiar color segn el mensaje
        if (message.includes('')) {
            betStatus.style.color = '#10b981'; // Verde
        } else if (message.includes('') || message.includes('')) {
            betStatus.style.color = '#ef4444'; // Rojo
        } else {
            betStatus.style.color = '#9ca3af'; // Gris
        }
    }
}

    // Llamar a updateWalletBalance cuando se actualice el usuario
    const originalUpdateNavAuth = updateNavAuth;
    updateNavAuth = function() {
        originalUpdateNavAuth();
        updateWalletBalance();
        updateBetInterface();
        
        // Auto-completar nombre del jugador si está autenticado con Google
        if (currentUser && currentUser.username && playerNameInput) {
            // Solo auto-completar si el campo está vacío
            if (!playerNameInput.value.trim()) {
                playerNameInput.value = currentUser.username;
                console.log(`[AUTO_FILL] Nombre auto-completado: ${currentUser.username}`);
            }
        }
    };

// Función para mostrar notificación de escudo protector
function showShieldNotification(message, duration) {
    // Crear elemento de notificación
    const notification = document.createElement('div');
    notification.id = 'shieldNotification';
    notification.style.cssText = `
        position: fixed;
        top: 15%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px 20px;
        border-radius: 10px;
        font-size: 14px;
        font-weight: bold;
        text-align: center;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: shieldPulse 2s ease-in-out;
        border: 2px solid #4ade80;
        max-width: 300px;
    `;
    
    notification.innerHTML = `
        <div style="margin-bottom: 5px; font-size: 16px;">🛡️</div>
        <div style="font-size: 13px;">${message}</div>
        <div style="font-size: 11px; margin-top: 5px; opacity: 0.9;">Escudo activo por ${duration} segundos</div>
    `;
    
    // Agregar estilos CSS para la animación
    if (!document.getElementById('shieldStyles')) {
        const style = document.createElement('style');
        style.id = 'shieldStyles';
        style.textContent = `
            @keyframes shieldPulse {
                0% { transform: translate(-50%, -50%) scale(0.9); opacity: 0; }
                50% { transform: translate(-50%, -50%) scale(1.05); opacity: 1; }
                100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Agregar al DOM
    document.body.appendChild(notification);
    
    // Remover después del tiempo especificado
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'shieldPulse 0.5s ease-in-out reverse';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 500);
        }
    }, duration * 1000);
}

// Función para mostrar notificación de división por combate
function showCombatNotification(message) {
    // Crear elemento de notificación
    const notification = document.createElement('div');
    notification.id = 'combatNotification';
    notification.style.cssText = `
        position: fixed;
        top: 20%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
        color: white;
        padding: 12px 20px;
        border-radius: 10px;
        font-size: 14px;
        font-weight: bold;
        text-align: center;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: combatPulse 2s ease-in-out;
        border: 2px solid #ff4757;
        max-width: 300px;
    `;
    
    notification.innerHTML = `
        <div style="margin-bottom: 5px; font-size: 16px;">⚔️</div>
        <div style="font-size: 13px;">${message}</div>
        <div style="font-size: 11px; margin-top: 5px; opacity: 0.9;">¡Tu célula se dividió en 4 partes!</div>
    `;
    
    // Agregar estilos CSS si no existen
    if (!document.getElementById('combatStyles')) {
        const style = document.createElement('style');
        style.id = 'combatStyles';
        style.textContent = `
            @keyframes combatPulse {
                0% { transform: translate(-50%, -50%) scale(0.9); opacity: 0; }
                50% { transform: translate(-50%, -50%) scale(1.05); opacity: 1; }
                100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Agregar notificación al DOM
    document.body.appendChild(notification);
    
    // Remover notificación después de 3 segundos
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'combatPulse 0.5s ease-in-out reverse';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 500);
        }
    }, 3000);
}

// Sistema de flechas para seguir jugadores
let playerArrows = new Map(); // Mapa para almacenar las flechas de cada jugador

// Función para crear o actualizar flecha de jugador
function updatePlayerArrow(playerId, playerName, playerX, playerY) {
    console.log('[ARROW_UPDATE] Intentando actualizar flecha para:', playerName, 'en', playerX, playerY);
    
    // Verificar si las alertas de combate están habilitadas
    const showCombatAlerts = document.getElementById('showCombatAlerts');
    if (showCombatAlerts && !showCombatAlerts.checked) {
        console.log('[ARROW_UPDATE] Alertas de combate deshabilitadas');
        return;
    }
    
    // Verificar que las variables del juego estén disponibles
    // Usar las variables locales en lugar de window.variables
    if (!player || !global || !global.game) {
        console.log('[ARROW_UPDATE] Variables del juego no disponibles, guardando datos para más tarde');
        console.log('[ARROW_UPDATE] Estado de variables:', {
            player: !!player,
            global: !!global,
            game: !!(global && global.game),
            playerValue: player,
            globalValue: global
        });
        // Guardar los datos para procesarlos más tarde cuando las variables estén disponibles
        if (!window.pendingArrows) {
            window.pendingArrows = [];
        }
        window.pendingArrows.push({playerId, playerName, playerX, playerY});
        return;
    }
    
    // No mostrar flecha para el propio jugador
    if (playerId === player.id) {
        console.log('[ARROW_UPDATE] Es el propio jugador, no mostrar flecha');
        return;
    }
    
    let arrow = playerArrows.get(playerId);
    
    // Si no existe la flecha, crearla
    if (!arrow) {
        arrow = document.createElement('div');
        arrow.className = 'player-arrow';
        arrow.id = `player-arrow-${playerId}`;
        arrow.setAttribute('data-player-name', playerName);
        arrow.textContent = playerName.charAt(0).toUpperCase(); // Mostrar primera letra del nombre
        document.body.appendChild(arrow);
        playerArrows.set(playerId, arrow);
        console.log(`[ARROW] Flecha creada para ${playerName} (ID: ${playerId})`);
    }
    
    // Calcular posición de la flecha en la pantalla
    const canvas = document.getElementById('cvs');
    if (!canvas) {
        console.log('[ARROW_UPDATE] Canvas no encontrado');
        return;
    }
    
    const canvasRect = canvas.getBoundingClientRect();
    const screenX = ((playerX - player.x) * global.game.scale) + (canvasRect.width / 2);
    const screenY = ((playerY - player.y) * global.game.scale) + (canvasRect.height / 2);
    
    // Asegurar que la flecha esté dentro de los límites de la pantalla
    const arrowSize = 40;
    const maxX = window.innerWidth - arrowSize;
    const maxY = window.innerHeight - arrowSize;
    
    const finalX = Math.max(arrowSize, Math.min(maxX, screenX));
    const finalY = Math.max(arrowSize, Math.min(maxY, screenY));
    
    // Aplicar posición
    arrow.style.left = finalX + 'px';
    arrow.style.top = finalY + 'px';
    
    // Calcular ángulo hacia el jugador
    const deltaX = playerX - player.x;
    const deltaY = playerY - player.y;
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    
    // Aplicar rotación
    arrow.style.transform = `rotate(${angle}deg)`;
    
    console.log(`[ARROW_UPDATE] Flecha actualizada para ${playerName} en (${finalX}, ${finalY}) con ángulo ${angle}°`);
}

// Función para procesar flechas pendientes cuando las variables del juego estén disponibles
function processPendingArrows() {
    if (window.pendingArrows && window.pendingArrows.length > 0) {
        console.log('[ARROW_PENDING] Procesando', window.pendingArrows.length, 'flechas pendientes');
        window.pendingArrows.forEach(arrowData => {
            updatePlayerArrow(arrowData.playerId, arrowData.playerName, arrowData.playerX, arrowData.playerY);
        });
        window.pendingArrows = [];
    }
}

// Función para remover flecha de jugador
function removePlayerArrow(playerId) {
    const arrow = playerArrows.get(playerId);
    if (arrow && arrow.parentNode) {
        arrow.parentNode.removeChild(arrow);
        playerArrows.delete(playerId);
        console.log(`[ARROW] Flecha removida para jugador ID: ${playerId}`);
    }
}

// Función para limpiar todas las flechas
function clearAllPlayerArrows() {
    playerArrows.forEach((arrow, playerId) => {
        if (arrow.parentNode) {
            arrow.parentNode.removeChild(arrow);
        }
    });
    playerArrows.clear();
    console.log('[ARROW] Todas las flechas removidas');
}

// Función de prueba para las flechas (llamar desde consola: testArrows())
window.testArrows = function() {
    console.log('[TEST] Probando flechas de jugadores...');
    // Simular algunos jugadores con posiciones fijas para prueba
    updatePlayerArrow('test1', 'Test1', 1000, 1000);
    updatePlayerArrow('test2', 'Test2', 2000, 1500);
    updatePlayerArrow('test3', 'Test3', 500, 2000);
    console.log('[TEST] Flechas de prueba creadas. Si no aparecen, las variables del juego no están disponibles.');
};

// Función de prueba simple que crea flechas directamente (sin depender de variables del juego)
window.testSimpleArrows = function() {
    console.log('[TEST] Creando flechas simples directamente...');
    
    // Crear 3 flechas en posiciones fijas
    const positions = [
        { x: 100, y: 100, name: 'A' },
        { x: window.innerWidth - 150, y: 100, name: 'B' },
        { x: window.innerWidth / 2, y: window.innerHeight - 150, name: 'C' }
    ];
    
    positions.forEach((pos, index) => {
        const arrow = document.createElement('div');
        arrow.className = 'player-arrow';
        arrow.id = `simple-arrow-${index}`;
        arrow.textContent = pos.name;
        arrow.style.left = pos.x + 'px';
        arrow.style.top = pos.y + 'px';
        arrow.style.transform = 'rotate(0deg)';
        document.body.appendChild(arrow);
        console.log(`[TEST] Flecha simple ${pos.name} creada en (${pos.x}, ${pos.y})`);
    });
    
    console.log('[TEST] 3 flechas simples creadas. Deberías verlas en la pantalla.');
};

// Función de prueba para el combate (llamar desde consola: testCombat())
window.testCombat = function() {
    console.log('[TEST] Probando alerta de combate...');
    showGlobalCombatAlert('Jugador Test', 'Otro Jugador');
};

// Función para limpiar flechas (llamar desde consola: clearArrows())
window.clearArrows = function() {
    console.log('[TEST] Limpiando todas las flechas...');
    clearAllPlayerArrows();
};

// Función para simular un segundo jugador con las variables correctas
window.testRealArrow = function() {
    console.log('[TEST] Simulando jugador real con variables del juego...');
    
    // Verificar que las variables estén disponibles
    if (typeof player === 'undefined' || typeof global === 'undefined') {
        console.log('[TEST] Variables del juego no disponibles. Asegúrate de estar en el juego.');
        console.log('[TEST] player:', typeof player);
        console.log('[TEST] global:', typeof global);
        return;
    }
    
    // Simular un jugador a 500 píxeles de distancia
    const fakePlayerX = player.x + 500;
    const fakePlayerY = player.y + 300;
    
    console.log('[TEST] Creando flecha para jugador simulado en:', fakePlayerX, fakePlayerY);
    console.log('[TEST] Jugador actual en:', player.x, player.y);
    
    // Llamar directamente updatePlayerArrow con las variables correctas
    updatePlayerArrow('fake-player-id', 'TestPlayer', fakePlayerX, fakePlayerY);
};

// Hacer funciones y variables globalmente accesibles
window.processPendingArrows = processPendingArrows;
window.updatePlayerArrow = updatePlayerArrow;
window.removePlayerArrow = removePlayerArrow;

// Hacer variables del juego globalmente accesibles para debug
window.getGameVars = function() {
    return {
        player: typeof player !== 'undefined' ? player : 'undefined',
        global: typeof global !== 'undefined' ? global : 'undefined',
        users: typeof users !== 'undefined' ? users : 'undefined'
    };
};

// Función para mostrar alerta global de combate
function showGlobalCombatAlert(eaterName, eatenName) {
    // Verificar si las alertas de combate están habilitadas
    const showCombatAlerts = document.getElementById('showCombatAlerts');
    if (showCombatAlerts && !showCombatAlerts.checked) {
        return;
    }
    
    // Crear elemento de alerta
    const alert = document.createElement('div');
    alert.className = 'combat-alert';
    alert.innerHTML = `
        <div class="player-name">⚔️ ${eaterName}</div>
        <div class="message">¡Se comió a ${eatenName} y se dividió en 4 partes!</div>
        <div class="message">¡Mira el giroscopio en el centro para encontrarlo!</div>
    `;
    
    // Agregar al DOM
    document.body.appendChild(alert);
    
    // Remover alerta después de 15 segundos (tiempo de restablecimiento de células divididas)
    setTimeout(() => {
        if (alert.parentNode) {
            alert.parentNode.removeChild(alert);
        }
    }, 15000);
}

// Función para mostrar ayuda de la brújula
function showCompassHelp() {
    const helpText = `
🎯 BRÚJULA DE DETECCIÓN DE CÉLULAS

CONTROLES:
• B - Activar/Desactivar brújula
• V - Cambiar entre brújula simple y avanzada
• R - Activar/Desactivar radar de largo alcance
• T - Activar/Desactivar radar de fondo
• +/- - Ajustar rango del radar (solo cuando está activo)

BRÚJULA SIMPLE:
• Detecta células en todo el mapa (hasta 10km)
• Prioriza células con dinero y masa alta
• Flecha dorada = con dinero
• Flecha roja = muy cercana (< 500px)
• Flecha naranja = cercana (< 1000px)
• Flecha azul = células grandes
• Flecha verde = lejanas (> 1000px)

BRÚJULA AVANZADA:
• Detecta hasta 5 células en todo el mapa (hasta 15km)
• Considera distancia, masa y dinero
• Flechas más gruesas = más importantes
• Flecha dorada = células con dinero
• Indicadores de masa/dinero en células
• Prioriza células valiosas a cualquier distancia

RADAR DE LARGO ALCANCE:
• Detecta células hasta 5000px de distancia (configurable)
• Muestra hasta 5 células más importantes
• Círculos concéntricos para rangos
• Efecto de escaneo giratorio
• Prioriza células con dinero
• Indicadores de distancia en cada flecha
• Rango ajustable con teclas +/- (2km - 10km)

RADAR DE FONDO:
• Siempre activo en la esquina superior izquierda
• Detecta la célula más valiosa en todo el mapa (hasta 20km)
• Prioriza células con dinero y masa alta
• Indicador pequeño y discreto
• Efecto de escaneo continuo
• Usa datos completos del servidor

EFECTOS ESPECIALES:
• Pulsación roja = células muy cercanas (< 300px)
• Pulsación dorada = células con mucho dinero (> $100)
• Información de distancia y masa/dinero
• Puntos cardinales (N, S, E, W)
• Efecto de escaneo del radar
    `;
    
    console.log(helpText);
    window.chat.addSystemLine(' Ayuda de brújula mostrada en consola (F12)');
}

// Hacer la función de ayuda globalmente accesible
window.showCompassHelp = showCompassHelp;

// Forzar recarga del cache - Versión del sistema de radar
console.log('[RADAR_SYSTEM] 🚀 Sistema de radar inicializado - v2024.01.27');

// Comando para forzar recarga del cache
window.forceReload = function() {
    console.log('[RELOAD] 🔄 Forzando recarga del cache...');
    // Limpiar cache y recargar
    if ('caches' in window) {
        caches.keys().then(function(names) {
            for (let name of names) caches.delete(name);
        });
    }
    // Forzar recarga sin cache
    window.location.reload(true);
};

// Comando para limpiar solo la consola
window.clearConsole = function() {
    console.clear();
    console.log('[CONSOLE] 🧹 Consola limpiada');
};

// Comando para limpiar logs de arrow debug
window.clearArrowDebug = function() {
    console.clear();
    console.log('[ARROW_CLEAN] 🧹 Logs de arrow debug eliminados');
    console.log('[ARROW_CLEAN] ✅ Consola limpia para usar');
};

// Comando para deshabilitar logs de debug
window.disableDebugLogs = function() {
    global.debugLogsDisabled = true;
    console.log('[DEBUG] 🚫 Logs de debug deshabilitados');
    console.clear();
};

// Comando para habilitar logs de debug
window.enableDebugLogs = function() {
    global.debugLogsDisabled = false;
    console.log('[DEBUG] ✅ Logs de debug habilitados');
};

// Comando de emergencia para limpiar todo
window.emergencyClean = function() {
    console.clear();
    global.debugLogsDisabled = true;
    console.log('[EMERGENCY] 🚨 Limpieza de emergencia completada');
    console.log('[EMERGENCY] ✅ Consola limpia y logs deshabilitados');
    console.log('[EMERGENCY] 💡 Usa enableDebugLogs() para reactivar logs');
};

// Comando para verificar estado del radar
window.checkRadarStatus = function() {
    console.log('[STATUS] 📊 Estado del sistema de radar:');
    console.log('[STATUS] global.radarData:', global.radarData ? global.radarData.length : 'undefined');
    console.log('[STATUS] global.showCompass:', global.showCompass);
    console.log('[STATUS] global.testSimpleRadar:', global.testSimpleRadar);
    console.log('[STATUS] global.useRadarCompass:', global.useRadarCompass);
    console.log('[STATUS] global.showBackgroundRadar:', global.showBackgroundRadar);
    
    if (global.radarData && global.radarData.length > 0) {
        console.log('[STATUS] ✅ Datos del radar disponibles');
        global.radarData.forEach((player, index) => {
            console.log(`[STATUS] Jugador ${index + 1}: ${player.name} en (${player.x}, ${player.y})`);
        });
    } else {
        console.log('[STATUS] ❌ No hay datos del radar');
    }
};

// Función para iniciar el sistema de ping
function startPingSystem() {
    // Limpiar intervalo anterior si existe
    if (pingInterval) {
        clearInterval(pingInterval);
    }
    
    // Enviar ping cada 2 segundos
    pingInterval = setInterval(() => {
        if (socket && socket.connected) {
            pingStartTime = Date.now();
            socket.emit('ping');
        }
    }, 2000);
    
    console.log('[PING] 🏓 Sistema de ping iniciado');
}

// Función para detener el sistema de ping
function stopPingSystem() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    currentPing = 0;
    console.log('[PING] 🏓 Sistema de ping detenido');
}

// Evento para recibir pong del servidor
socket.on('pong', function() {
    currentPing = Date.now() - pingStartTime;
    console.log(`[PING] 🏓 Ping: ${currentPing}ms`);
});
