const config = require('../../config');

const adjustForBoundaries = (position, radius, borderOffset, gameWidth, gameHeight) => {
    const borderCalc = radius + borderOffset;
    if (position.x > gameWidth - borderCalc) {
        position.x = gameWidth - borderCalc;
    }
    if (position.y > gameHeight - borderCalc) {
        position.y = gameHeight - borderCalc;
    }
    if (position.x < borderCalc) {
        position.x = borderCalc;
    }
    if (position.y < borderCalc) {
        position.y = borderCalc;
    }
};

// Lógica de la zona roja dinámica
class RedZone {
    constructor(config) {
        this.config = config;
        this.centerX = config.gameWidth / 2;
        this.centerY = config.gameHeight / 2;
        this.radius = this.calculateRadius(0); // Inicialmente sin jugadores
        this.shrinkRate = config.redZone.shrinkRate;
        this.damagePerSecond = config.redZone.damagePerSecond;
        this.lastUpdate = Date.now();
    }

    // Calcular el radio de la zona roja basado en el número de jugadores
    calculateRadius(playerCount) {
        const baseRadius = Math.min(this.config.gameWidth, this.config.gameHeight) * this.config.redZone.baseRadiusPercent;
        const minRadius = Math.min(this.config.gameWidth, this.config.gameHeight) * this.config.redZone.minRadiusPercent;
        const maxRadius = Math.min(this.config.gameWidth, this.config.gameHeight) * this.config.redZone.maxRadiusPercent;
        
        let result;
        if (playerCount <= 1) {
            // Con un solo jugador, zona roja pequeña (más espacio seguro)
            result = minRadius;
        } else if (playerCount <= 3) {
            // Con 2-3 jugadores, zona roja media
            result = baseRadius;
        } else {
            // Con 4+ jugadores, expandir la zona roja para dar más espacio
            const expansion = (playerCount - 3) * 100;
            result = Math.min(maxRadius, baseRadius + expansion);
        }
        
        // Solo log cuando hay cambio significativo en el número de jugadores
        if (this.lastCalculatedPlayerCount !== playerCount) {
            console.log(`[REDZONE] Calculando radio para ${playerCount} jugadores: min=${minRadius.toFixed(0)}, base=${baseRadius.toFixed(0)}, max=${maxRadius.toFixed(0)}, resultado=${result.toFixed(0)}`);
            this.lastCalculatedPlayerCount = playerCount;
        }
        return result;
    }

    // Actualizar la zona roja
    update(playerCount) {
        const now = Date.now();
        const deltaTime = (now - this.lastUpdate) / 1000;
        this.lastUpdate = now;

        const targetRadius = this.calculateRadius(playerCount);
        const oldRadius = this.radius;
        
        // Contraer gradualmente hacia el radio objetivo
        if (this.radius > targetRadius) {
            this.radius -= this.shrinkRate * deltaTime;
            if (this.radius < targetRadius) {
                this.radius = targetRadius;
            }
        } else if (this.radius < targetRadius) {
            this.radius += this.shrinkRate * deltaTime;
            if (this.radius > targetRadius) {
                this.radius = targetRadius;
            }
        }
        
        // Log si hay cambio significativo
        if (Math.abs(oldRadius - this.radius) > 10) {
            console.log(`[REDZONE] Radio cambiando: ${oldRadius.toFixed(0)} -> ${this.radius.toFixed(0)} (target: ${targetRadius.toFixed(0)})`);
        }
    }

    // Verificar si un punto está en la zona roja
    isInRedZone(x, y) {
        const distance = Math.sqrt((x - this.centerX) ** 2 + (y - this.centerY) ** 2);
        return distance > this.radius;
    }

    // Obtener información de la zona roja para el cliente
    getZoneInfo() {
        return {
            centerX: this.centerX,
            centerY: this.centerY,
            radius: this.radius,
            damagePerSecond: this.damagePerSecond
        };
    }

    // Aplicar daño a jugadores en la zona roja
    applyDamage(player, deltaTime) {
        if (this.isInRedZone(player.x, player.y)) {
            const damage = this.damagePerSecond * deltaTime;
            // Reducir masa del jugador
            for (let i = 0; i < player.cells.length; i++) {
                if (player.cells[i].mass > this.config.defaultPlayerMass) {
                    player.changeCellMass(i, -damage);
                }
            }
            return true; // Jugador recibió daño
        }
        return false; // Jugador no recibió daño
    }
}

module.exports = {
    adjustForBoundaries,
    RedZone
};