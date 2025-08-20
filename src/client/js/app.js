/*jslint bitwise: true, node: true */
'use strict';

var io = require('socket.io-client');
var render = require('./render');
var ChatClient = require('./chat-client');
var Canvas = require('./canvas');
var global = require('./global');

var playerNameInput = document.getElementById('playerNameInput');
var socket;

var debug = function (args) {
    if (console && console.log) {
        console.log(args);
    }
};

if (/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)) {
    global.mobile = true;
}

function startGame(type) {
    // Para espectadores o usuarios no autenticados, continuar normalmente
    if (currentUser && type === 'player') {
        global.playerName = currentUser.username;
    } else {
        global.playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    }
    
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
    
    global.playerName = currentUser.username;
    global.playerType = 'player';
    global.betAmount = betAmount;
    global.originalBetAmount = betAmount; // Guardar la apuesta original

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
}

// Checks if the nick chosen contains valid alphanumeric characters (and underscores).
function validNick() {
    var regex = /^\w*$/;
    debug('Regex Test', regex.exec(playerNameInput.value));
    return regex.exec(playerNameInput.value) !== null;
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
        
        // Ocultar el campo de nombre de jugador cuando est autenticado
        if (playerNameSection) playerNameSection.style.display = 'none';
        
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
                // Mostrar mensaje de que debe iniciar sesión
                alert('Debes iniciar sesión para jugar. Puedes hacer spectate sin cuenta.');
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
                alert('Debes iniciar sesin para jugar. Puedes hacer spectate sin cuenta.');
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

        // Llamar a la API de cashout
        fetch('/api/voluntaryDisconnect', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ 
                betAmount: global.betAmount,
                originalBetAmount: originalBet
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
        }, 2000);
    }
}

// socket stuff.
function setupSocket(socket) {
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
        
        // Si hay una apuesta activa, enviar los datos del jugador con la apuesta
        if (global.betAmount && global.betAmount > 0) {
            socket.emit('gotit', {
                name: currentUser.username,
                userId: currentUser.id,
                betAmount: global.betAmount
            });
        } else {
            socket.emit('gotit', player);
        }
        
        global.gameStart = Date.now();
        window.chat.addSystemLine('Connected to the game!');
        window.chat.addSystemLine('Type <b>-help</b> for a list of commands.');
        
        // Mostrar mensaje de cashout si hay una apuesta activa (sin mostrar botn de salir)
        if (global.betAmount && global.betAmount > 0) {
            window.chat.addSystemLine(' Presiona <b>C</b> para hacer cash out y retirar tus ganancias!');
        }
        
        if (global.mobile) {
            document.getElementById('gameAreaWrapper').removeChild(document.getElementById('chatbox'));
        }
        c.focus();
        global.game.width = gameSizes.width;
        global.game.height = gameSizes.height;
        resize();
    });



    socket.on('playerDied', (data) => {
        const player = isUnnamedCell(data.playerEatenName) ? 'An unnamed cell' : data.playerEatenName;
        //const killer = isUnnamedCell(data.playerWhoAtePlayerName) ? 'An unnamed cell' : data.playerWhoAtePlayerName;

        //window.chat.addSystemLine('{GAME} - <b>' + (player) + '</b> was eaten by <b>' + (killer) + '</b>');
        window.chat.addSystemLine('{GAME} - <b>' + (player) + '</b> was eaten');
    });

    socket.on('playerDisconnect', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> disconnected.');
    });

    socket.on('playerJoin', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> joined.');
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
        

    });

    // Death.
    socket.on('RIP', function () {
        global.gameStart = false;
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

    // Game Over por quedarse sin dinero
    socket.on('gameOver', function (data) {
        global.gameStart = false;
        render.drawErrorMessage(data.message || 'Perdiste! Te quedaste sin dinero.', graph, global.screen);
        
        // Ocultar controles del juego
        document.getElementById('gameControls').style.display = 'none';
        
        // Mostrar mensaje en el chat
        window.chat.addSystemLine(' ' + (data.message || 'Perdiste! Te quedaste sin dinero.'));
        
        // Si queda dinero residual, informar
        if (data.finalMoney && data.finalMoney > 0) {
            window.chat.addSystemLine(` Se devolvieron $${data.finalMoney} a tu balance.`);
        }
        
        // Resetear el dinero del juego
        global.betAmount = 0;
        
        // Regresar al lobby despus de mostrar el mensaje
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
                    hasShield: users[i].cells[j].hasShield || false
                };
                

                
                cellsToDraw.push(cellData);
            }
        }
        cellsToDraw.sort(function (obj1, obj2) {
            return obj1.mass - obj2.mass;
        });
        render.drawCells(cellsToDraw, playerConfig, global.toggleMassState, borders, graph);

        // Dibujar barra de progreso del cash out si est activo
        if (global.isCashOutActive) {
            render.drawCashOutProgress(global.cashOutProgress, global.screen, graph);
        }

        socket.emit('0', window.canvas.target); // playerSendTarget "Heartbeat".
    }
}

window.addEventListener('resize', resize);

// Manejo de teclas para cash out
window.addEventListener('keydown', function(e) {
    if (e.key === 'c' || e.key === 'C') {
        if (global.gameStart && global.gameStart > 0 && global.betAmount > 0 && !global.isCashOutActive) {
            startCashOut();
        }
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
    window.chat.addSystemLine(' Mantn presionada la tecla C para hacer cash out...');
}

function cancelCashOut() {
    global.isCashOutActive = false;
    global.cashOutProgress = 0;
    console.log('[CASHOUT] Cash out cancelado');
    window.chat.addSystemLine(' Cash out cancelado');
}

function updateCashOutProgress() {
    if (global.isCashOutActive) {
        const elapsed = Date.now() - global.cashOutStartTime;
        global.cashOutProgress = Math.min(elapsed / global.cashOutDuration, 1);
        
        if (global.cashOutProgress >= 1) {
            // Cash out completado
            global.isCashOutActive = false;
            global.voluntaryExit = true;
            console.log('[CASHOUT] Cash out completado, saliendo del juego...');
            window.chat.addSystemLine(' Cash out completado! Saliendo del juego...');
            handleDisconnect();
        }
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
    
    // Manejar botones de apuesta
    console.log('[DEBUG] Configurando event listeners para botones de apuesta:', betButtons.length);
    betButtons.forEach(button => {
        button.addEventListener('click', function() {
            console.log('[DEBUG] Botón de apuesta clickeado:', this.getAttribute('data-amount'));
            // Verificar si el usuario est autenticado (soporta tanto sessionToken como Google OAuth)
            if (!currentUser || !(sessionToken || currentUser.id)) {
                updateBetStatus(' Debes iniciar sesin para apostar');
                return;
            }
            
            // Obtener el monto de la apuesta
            const amount = parseFloat(this.getAttribute('data-amount'));
            
            // Verificar si tiene suficiente balance
            if (currentUser.balance < amount) {
                updateBetStatus(` Balance insuficiente. Necesitas $${amount} pero tienes $${currentUser.balance.toFixed(2)}`);
                return;
            }
            
            // Seleccionar este botn
            betButtons.forEach(btn => btn.classList.remove('selected'));
            this.classList.add('selected');
            
            window.selectedBetAmount = amount;
            updateBetStatus(` Apuesta seleccionada: $${amount}`);
            
            // Actualizar el texto del botn PLAY
            const playButtonText = document.getElementById('playButtonText');
            if (playButtonText) playButtonText.textContent = ` PLAY ($${amount})`;
            
            console.log(`[BET] Monto seleccionado: $${amount}`);
        });
    });
    
    // Manejar botn PLAY
    if (startButton) {
        startButton.addEventListener('click', function() {
            console.log('[PLAY] Botn PLAY clickeado');
            
            // Validar nombre del jugador
            let playerName = playerNameInput.value.trim();
            
            // Si el usuario está autenticado con Google y no hay nombre ingresado, usar su nombre de Google
            if (!playerName && currentUser && currentUser.username) {
                playerName = currentUser.username;
                playerNameInput.value = playerName;
                console.log(`[PLAY] Usando nombre de Google OAuth: ${playerName}`);
            }
            
            if (!playerName) {
                showNameError('Por favor ingresa tu nombre');
                return;
            }
            
            // Validar caracteres del nombre (más permisivo para usuarios de Google OAuth)
            if (!/^[a-zA-Z0-9_\s]+$/.test(playerName)) {
                showNameError('El nombre solo puede contener letras, nmeros, espacios y guiones bajos');
                return;
            }
            
            // Ocultar error de nombre si existe
            hideNameError();
            
            // Establecer el nombre global
            global.playerName = playerName;
            
            // Si hay una apuesta seleccionada y el usuario est autenticado
            if (window.selectedBetAmount > 0 && currentUser && (sessionToken || currentUser.id)) {
                console.log(`[PLAY] Iniciando juego con apuesta de $${window.selectedBetAmount}`);
                updateBetStatus(` Iniciando juego con apuesta de $${window.selectedBetAmount}...`);
                processBet(window.selectedBetAmount);
            } else {
                // Jugar sin apuesta (modo gratuito)
                console.log('[PLAY] Iniciando juego sin apuesta');
                updateBetStatus(' Iniciando juego gratuito...');
                startGameFree();
            }
        });
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
            
            if (playerName && !/^[a-zA-Z0-9_]+$/.test(playerName)) {
                showNameError('Solo letras, nmeros y guiones bajos');
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
    
    function clearBetSelection() {
        window.selectedBetAmount = 0;
        betButtons.forEach(btn => btn.classList.remove('selected'));
        updateBetInterface();
    }
    
    // Hacer la funcin disponible globalmente
    window.updateBetInterface = updateBetInterface;
    window.clearBetSelection = clearBetSelection;
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
        
        // Actualizar texto del botn PLAY
        if (window.selectedBetAmount > 0) {
            if (playButtonText) playButtonText.textContent = ` PLAY ($${window.selectedBetAmount})`;
        } else {
            if (playButtonText) playButtonText.textContent = ' PLAY (Free)';
        }
    } else {
        updateBetStatus(' Inicia sesin para apostar, o juega gratis sin apostar');
        window.selectedBetAmount = 0;
        
        // Deshabilitar todos los botones de apuesta
        betButtons.forEach(btn => {
            btn.classList.remove('selected');
            btn.disabled = false; // Permitir click para mostrar mensaje
            btn.style.opacity = '0.8';
        });
        
        // Actualizar texto del botn PLAY
        if (playButtonText) playButtonText.textContent = ' PLAY (Free)';
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
};