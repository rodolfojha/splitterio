"use strict";

const util = require('../lib/util');

class Bomb {
    constructor(x, y, config) {
        this.x = x;
        this.y = y;
        this.radius = config.bombSize;
        this.speed = config.bombSpeed;
        this.color = config.bombColor;
        this.directionX = (Math.random() - 0.5) * 2; // Dirección aleatoria X
        this.directionY = (Math.random() - 0.5) * 2; // Dirección aleatoria Y
        this.id = Math.random().toString(36).substr(2, 9); // ID único
        this.isBomb = true; // Identificador para distinguir de otros objetos
    }

    // Mover la bomba en su dirección actual
    move(gameWidth, gameHeight) {
        // Mover en la dirección actual
        this.x += this.directionX * this.speed;
        this.y += this.directionY * this.speed;

        // Rebotar en los bordes del mapa
        if (this.x <= this.radius || this.x >= gameWidth - this.radius) {
            this.directionX = -this.directionX;
            this.x = Math.max(this.radius, Math.min(gameWidth - this.radius, this.x));
        }
        
        if (this.y <= this.radius || this.y >= gameHeight - this.radius) {
            this.directionY = -this.directionY;
            this.y = Math.max(this.radius, Math.min(gameHeight - this.radius, this.y));
        }

        // Cambiar dirección aleatoriamente de vez en cuando
        if (Math.random() < 0.01) { // 1% de probabilidad por frame
            this.directionX = (Math.random() - 0.5) * 2;
            this.directionY = (Math.random() - 0.5) * 2;
        }
    }

    // Crear un círculo para detección de colisiones
    toCircle() {
        return {
            x: this.x,
            y: this.y,
            radius: this.radius
        };
    }

    // Verificar si un punto está dentro de la bomba
    containsPoint(pointX, pointY) {
        const distance = Math.hypot(pointX - this.x, pointY - this.y);
        return distance <= this.radius;
    }
}

// Clase para manejar múltiples bombas
class BombManager {
    constructor(config) {
        this.bombs = [];
        this.config = config;
        this.isActive = false;
    }

    // Activar el evento de bombas
    activate(gameWidth, gameHeight) {
        this.isActive = true;
        this.bombs = [];
        
        // Crear bombas en posiciones aleatorias
        for (let i = 0; i < this.config.bombCount; i++) {
            const x = Math.random() * (gameWidth - 100) + 50;
            const y = Math.random() * (gameHeight - 100) + 50;
            this.bombs.push(new Bomb(x, y, this.config));
        }
        
        console.log(`[BOMB_EVENT] ${this.bombs.length} bombas activadas`);
    }

    // Desactivar el evento de bombas
    deactivate() {
        this.isActive = false;
        this.bombs = [];
        console.log('[BOMB_EVENT] Bombas desactivadas');
    }

    // Actualizar posición de todas las bombas
    update(gameWidth, gameHeight) {
        if (!this.isActive) return;
        
        this.bombs.forEach(bomb => {
            bomb.move(gameWidth, gameHeight);
        });
    }

    // Verificar colisión con un jugador
    checkCollision(player) {
        if (!this.isActive) return false;
        
        for (let i = 0; i < player.cells.length; i++) {
            const cell = player.cells[i];
            
            for (let j = 0; j < this.bombs.length; j++) {
                const bomb = this.bombs[j];
                
                if (bomb.containsPoint(cell.x, cell.y)) {
                    // Colisión detectada
                    console.log(`[BOMB_EVENT] ${player.name} chocó con bomba`);
                    
                    // Remover la bomba
                    this.bombs.splice(j, 1);
                    
                    return {
                        playerIndex: i,
                        bombIndex: j,
                        bomb: bomb
                    };
                }
            }
        }
        
        return false;
    }

    // Obtener todas las bombas para enviar al cliente
    getBombs() {
        return this.bombs.map(bomb => ({
            x: bomb.x,
            y: bomb.y,
            radius: bomb.radius,
            color: bomb.color,
            id: bomb.id
        }));
    }

    // Obtener el número de bombas activas
    getBombCount() {
        return this.bombs.length;
    }
}

module.exports = {
    Bomb: Bomb,
    BombManager: BombManager
};
