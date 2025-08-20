"use strict";

const util = require('../lib/util');
const { v4: uuidv4 } = require('uuid');
const {getPosition} = require("../lib/entityUtils");

// Tipos de poderes disponibles
const POWER_TYPES = {
    SPEED_BOOST: 'speed_boost',
    MASS_BOOST: 'mass_boost',
    SHIELD: 'shield'
};

// Función para obtener configuración de poderes desde el sistema de crecimiento
function getPowerConfig() {
    const config = require('../../../config');
    const powersConfig = config.growthSystem?.powers;
    
    return {
        [POWER_TYPES.SPEED_BOOST]: {
            name: 'Uvas de Velocidad',
            hue: 280, // Púrpura para uvas
            duration: powersConfig?.speedBoost?.duration || 20000, // Duración configurable
            multiplier: 5, // x5 velocidad
            rarity: 0.05 // 5% de probabilidad de spawn
        },
        [POWER_TYPES.MASS_BOOST]: {
            name: 'Manzana Dorada',
            hue: 60, // Dorado
            duration: powersConfig?.massBoost?.duration || 15000, // Duración configurable
            multiplier: 5, // x5 masa (aumentado de x2 a x5)
            rarity: 0.03 // 3% de probabilidad de spawn
        },
        [POWER_TYPES.SHIELD]: {
            name: 'Escudo Protector',
            hue: 200, // Azul
            duration: powersConfig?.shield?.duration || 25000, // Duración configurable
            multiplier: 1, // No multiplicador, solo protección
            rarity: 0.02 // 2% de probabilidad de spawn
        }
    };
}

class PowerFood {
    constructor(position, powerType) {
        const POWER_CONFIG = getPowerConfig(); // Obtener configuración actual
        this.id = uuidv4();
        this.x = position.x;
        this.y = position.y;
        this.radius = util.massToRadius(15); // Tamaño más grande para poder
        this.mass = 15;
        this.hue = POWER_CONFIG[powerType].hue;
        this.powerType = powerType;
        this.name = POWER_CONFIG[powerType].name;
        this.duration = POWER_CONFIG[powerType].duration;
        this.multiplier = POWER_CONFIG[powerType].multiplier;
        this.isPowerFood = true; // Identificador para distinguir de comida normal
    }
}

exports.PowerFoodManager = class {
    constructor() {
        this.data = [];
        this.maxPowerFood = 10; // Máximo 10 frutas de poder en el mapa
    }

    addNew(number = 1) {
        const POWER_CONFIG = getPowerConfig(); // Obtener configuración actual
        while (number-- && this.data.length < this.maxPowerFood) {
            // Determinar qué tipo de poder spawnear basado en probabilidades
            const random = Math.random();
            let powerType = null;
            
            if (random < POWER_CONFIG[POWER_TYPES.SHIELD].rarity) {
                powerType = POWER_TYPES.SHIELD;
            } else if (random < POWER_CONFIG[POWER_TYPES.SHIELD].rarity + POWER_CONFIG[POWER_TYPES.MASS_BOOST].rarity) {
                powerType = POWER_TYPES.MASS_BOOST;
            } else if (random < POWER_CONFIG[POWER_TYPES.SHIELD].rarity + POWER_CONFIG[POWER_TYPES.MASS_BOOST].rarity + POWER_CONFIG[POWER_TYPES.SPEED_BOOST].rarity) {
                powerType = POWER_TYPES.SPEED_BOOST;
            }
            
            if (powerType) {
                const position = getPosition(false, this.data[0]?.radius || 5, this.data);
                this.data.push(new PowerFood(position, powerType));
                console.log(`[POWER_FOOD] Spawned ${POWER_CONFIG[powerType].name} at (${position.x.toFixed(0)}, ${position.y.toFixed(0)})`);
            }
        }
    }

    removeExcess(number) {
        while (number-- && this.data.length) {
            this.data.pop();
        }
    }

    delete(powerFoodToDelete) {
        if (powerFoodToDelete.length > 0) {
            this.data = util.removeIndexes(this.data, powerFoodToDelete);
        }
    }

    // Método para obtener la configuración de poderes
    static getPowerConfig() {
        return getPowerConfig();
    }

    // Método para obtener los tipos de poderes
    static getPowerTypes() {
        return POWER_TYPES;
    }
};

// Exportar las constantes para uso en otros archivos
exports.POWER_TYPES = POWER_TYPES;
exports.getPowerConfig = getPowerConfig;
