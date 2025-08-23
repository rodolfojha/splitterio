"use strict";

const {isVisibleEntity} = require("../lib/entityUtils");

exports.foodUtils = require('./food');
exports.virusUtils = require('./virus');
exports.massFoodUtils = require('./massFood');
exports.playerUtils = require('./player');
exports.powerFoodUtils = require('./powerFood');

exports.Map = class {
    constructor(config) {
        this.food = new exports.foodUtils.FoodManager(config.foodMass, config.foodUniformDisposition);
        this.viruses = new exports.virusUtils.VirusManager(config.virus);
        this.massFood = new exports.massFoodUtils.MassFoodManager();
        this.powerFood = new exports.powerFoodUtils.PowerFoodManager();
        this.players = new exports.playerUtils.PlayerManager();
    }

    balanceMass(foodMass, gameMass, maxFood, maxVirus) {
        const totalMass = this.food.data.length * foodMass + this.players.getTotalMass();

        const massDiff = gameMass - totalMass;
        const foodFreeCapacity = maxFood - this.food.data.length;
        const foodDiff = Math.min(parseInt(massDiff / foodMass), foodFreeCapacity);
        if (foodDiff > 0) {
            console.debug('[DEBUG] Adding ' + foodDiff + ' food');
            this.food.addNew(foodDiff);
        } else if (foodDiff && foodFreeCapacity !== maxFood) {
            console.debug('[DEBUG] Removing ' + -foodDiff + ' food');
            this.food.removeExcess(-foodDiff);
        }
        //console.debug('[DEBUG] Mass rebalanced!');

        const virusesToAdd = maxVirus - this.viruses.data.length;
        if (virusesToAdd > 0) {
            this.viruses.addNew(virusesToAdd);
        }

        // Spawn de frutas de poder - mantener siempre el máximo en el mapa
        const powerFoodToAdd = this.powerFood.maxPowerFood - this.powerFood.data.length;
        if (powerFoodToAdd > 0) {
            console.log(`[POWER_FOOD] Agregando ${powerFoodToAdd} frutas de poder para mantener el máximo (${this.powerFood.maxPowerFood})`);
            this.powerFood.addNew(powerFoodToAdd);
        }
    }

    enumerateWhatPlayersSee(callback) {
        for (let currentPlayer of this.players.data) {
            var visibleFood = this.food.data.filter(entity => isVisibleEntity(entity, currentPlayer, false));
            var visibleViruses = this.viruses.data.filter(entity => isVisibleEntity(entity, currentPlayer));
            var visibleMass = this.massFood.data.filter(entity => isVisibleEntity(entity, currentPlayer));
            var visiblePowerFood = this.powerFood.data.filter(entity => isVisibleEntity(entity, currentPlayer, false));

            const extractData = (player) => {
                // Debug: verificar si hay células divididas
                const dividedCells = player.cells.filter(cell => cell._justDivided);
                if (dividedCells.length > 0) {
                    console.log(`[MAP_EXTRACT] Jugador ${player.name} tiene ${dividedCells.length} células recién divididas`);
                    dividedCells.forEach((cell, index) => {
                        console.log(`[MAP_EXTRACT] Célula dividida ${index}: $${cell.gameMoney || 0}`);
                        // Limpiar el marcador después de extraer los datos
                        cell._justDivided = false;
                    });
                }
                
                return {
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
                        hasShield: cell.hasShield(),
                        skinId: cell.skinId || player.skinId || 1 // Agregar skinId de la célula o del jugador
                    })),
                    massTotal: Math.round(player.massTotal),
                    hue: player.hue,
                    skinId: player.skinId || 1, // Agregar skinId del jugador
                    id: player.id,
                    name: player.name,
                    gameMoney: player.getTotalMoney() || 0
                };
            }

            var visiblePlayers = [];
                    // console.log(`[MAP_DEBUG] Jugador actual: ${currentPlayer.name} (${currentPlayer.x}, ${currentPlayer.y})`);
        // console.log(`[MAP_DEBUG] Total de jugadores en el mapa: ${this.players.data.length}`);
            
            for (let player of this.players.data) {
                // console.log(`[MAP_DEBUG] Verificando jugador: ${player.name} (${player.x}, ${player.y})`);
                for (let cell of player.cells) {
                    const isVisible = isVisibleEntity(cell, currentPlayer);
                    // console.log(`[MAP_DEBUG] Célula de ${player.name} visible para ${currentPlayer.name}: ${isVisible}`);
                    if (isVisible) {
                        visiblePlayers.push(extractData(player));
                        break;
                    }
                }
            }
            
            // console.log(`[MAP_DEBUG] Jugadores visibles para ${currentPlayer.name}: ${visiblePlayers.length}`);

            callback(extractData(currentPlayer), visiblePlayers, visibleFood, visibleMass, visibleViruses, visiblePowerFood);
        }
    }
}
