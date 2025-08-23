module.exports = {
    host: "0.0.0.0",
    port: 3000,
    logpath: "logger.php",
    foodMass: 1,
    fireFood: 20,
    limitSplit: 16,
    defaultPlayerMass: 10,
	virus: {
        fill: "#33ff33",
        stroke: "#19D119",
        strokeWidth: 20,
        defaultMass: {
            from: 100,
            to: 150
        },
        splitMass: 180,
        uniformDisposition: false,
	},
    gameWidth: 7000,
    gameHeight: 7000,
    adminPass: "DEFAULT",
    gameMass: 28000,
    maxFood: 1400,
    maxVirus: 50,
    slowBase: 4.5,
    logChat: 0,
    networkUpdateFactor: 40,
    maxHeartbeatInterval: 30000, // Aumentado de 5 segundos a 30 segundos para ser más tolerante
    foodUniformDisposition: true,
    newPlayerInitialPosition: "farthest",
    massLossRate: 1,
    minMassLoss: 50,
    sqlinfo: {
      fileName: "db.sqlite3",
    },
    redZone: {
        enabled: true,
        damagePerSecond: 10,
        shrinkRate: 2.0, // Más rápido para cambios más visibles
        baseRadiusPercent: 0.5, // 50% del mapa (zona media para 2+ jugadores)
        minRadiusPercent: 0.25, // 25% mínimo (zona pequeña para 1 jugador)
        maxRadiusPercent: 0.7   // 70% máximo (zona grande para muchos jugadores)
    },
    // Sistema de crecimiento configurable
    growthSystem: {
        // Factor de crecimiento base (multiplicador de masa ganada)
        baseGrowthFactor: 1.0,
        
        // Bonus para jugadores pequeños (crecen más rápido)
        smallPlayerBonus: {
            enabled: true,
            massThreshold: 50, // Masa por debajo de la cual se aplica el bonus
            multiplier: 2.0    // Multiplicador de crecimiento para jugadores pequeños
        },
        
        // Penalización para jugadores grandes (crecen más lento)
        largePlayerPenalty: {
            enabled: true,
            massThreshold: 200, // Masa por encima de la cual se aplica la penalización
            multiplier: 0.5     // Multiplicador de crecimiento para jugadores grandes
        },
        
        // Límite máximo de crecimiento
        maxGrowthLimit: {
            enabled: true,
            maxMass: 1000,      // Masa máxima permitida
            reductionPercent: 10 // Porcentaje de reducción cuando se alcanza el límite
        },
        
        // Cash out automático cuando se alcanza el límite máximo
        autoCashout: {
            enabled: true,
            activationMass: 800, // Masa a la cual se activa el cash out automático
            delay: 3000          // Delay en milisegundos antes del cash out automático
        },
        
        // Configuración de poderes
        powers: {
            speedBoost: {
                duration: 20000  // 20 segundos en milisegundos
            },
            massBoost: {
                duration: 15000  // 15 segundos en milisegundos
            },
            shield: {
                duration: 25000  // 25 segundos en milisegundos
            }
        }
    },
    
    // Sistema de eventos globales
    globalEvents: {
        speedEvent: {
            enabled: true,
            interval: 300000,    // 5 minutos en milisegundos (para pruebas)
            duration: 120000,    // 2 minutos en milisegundos
            speedMultiplier: 2.0, // Velocidad x2 para todos los jugadores
            warningTime: 60000,  // 1 minuto de advertencia antes del evento
            countdownAlerts: true, // Habilitar alertas de cuenta regresiva
            countdownInterval: 60000 // Intervalo entre alertas (1 minuto)
        },
        bombEvent: {
            enabled: true,
            interval: 300000,    // 5 minutos en milisegundos
            duration: 120000,    // 2 minutos en milisegundos
            warningTime: 60000,  // 1 minuto de advertencia antes del evento
            countdownAlerts: true, // Habilitar alertas de cuenta regresiva
            countdownInterval: 60000, // Intervalo entre alertas (1 minuto)
            bombCount: 15,       // Número de bombas en el campo
            bombSpeed: 3.0,      // Velocidad de movimiento de las bombas
            bombSize: 20,        // Tamaño de las bombas
            bombColor: "#ff0000" // Color rojo para las bombas
        }
    }
};
