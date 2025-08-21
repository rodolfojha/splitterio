"use strict";

const util = require('../lib/util');
const sat = require('sat');
const { adjustForBoundaries, adjustForRedZone } = require('../game-logic');

const MIN_SPEED = 6.25;
const SPLIT_CELL_SPEED = 20;
const SPEED_DECREMENT = 0.5;
const MIN_DISTANCE = 50;
const PUSHING_AWAY_SPEED = 1.1;
const MERGE_TIMER = 15;

class Cell {
    constructor(x, y, mass, speed) {
        this.x = x;
        this.y = y;
        this.mass = mass;
        this.radius = util.massToRadius(mass);
        this.speed = speed;
        this.gameMoney = 0; // Dinero específico de esta célula
        this.protectionEndTime = 0; // Tiempo de fin de protección (0 = sin protección)
        this.isProtected = false; // Estado de protección
        this.activePowers = {}; // Poderes activos en esta célula
        this.hasBeenSplit = false; // Indica si esta célula ya fue dividida anteriormente
    }

    setMass(mass) {
        this.mass = mass;
        this.recalculateRadius();
    }

    addMass(mass) {
        this.setMass(this.mass + mass);
    }

    recalculateRadius() {
        this.radius = util.massToRadius(this.mass);
    }

    toCircle() {
        return new sat.Circle(new sat.Vector(this.x, this.y), this.radius);
    }

    // Activar protección temporal
    activateProtection(durationMs = 15000) {
        this.protectionEndTime = Date.now() + durationMs;
        this.isProtected = true;
        console.log(`[PROTECTION] Célula protegida por ${durationMs/1000} segundos`);
    }

    // Verificar si la célula está protegida
    isCurrentlyProtected() {
        if (!this.isProtected) return false;
        
        if (Date.now() > this.protectionEndTime) {
            this.isProtected = false;
            this.protectionEndTime = 0;
            console.log(`[PROTECTION] Protección expirada`);
            return false;
        }
        
        return true;
    }

    // Obtener tiempo restante de protección en segundos
    getProtectionTimeLeft() {
        if (!this.isProtected) return 0;
        const timeLeft = Math.max(0, this.protectionEndTime - Date.now());
        return Math.ceil(timeLeft / 1000);
    }

    // Activar un poder en esta célula
    activatePower(powerType, duration, multiplier) {
        this.activePowers[powerType] = {
            endTime: Date.now() + duration,
            multiplier: multiplier,
            duration: duration
        };
        console.log(`[POWER] Célula activó poder ${powerType} por ${duration/1000} segundos`);
    }

    // Verificar si un poder está activo
    hasActivePower(powerType) {
        if (!this.activePowers[powerType]) return false;
        
        if (Date.now() > this.activePowers[powerType].endTime) {
            delete this.activePowers[powerType];
            console.log(`[POWER] Poder ${powerType} expiró`);
            return false;
        }
        
        return true;
    }

    // Obtener multiplicador de velocidad actual
    getSpeedMultiplier() {
        if (this.hasActivePower('speed_boost')) {
            return this.activePowers['speed_boost'].multiplier;
        }
        return 1;
    }

    // Obtener multiplicador de masa actual
    getMassMultiplier() {
        if (this.hasActivePower('mass_boost')) {
            return this.activePowers['mass_boost'].multiplier;
        }
        return 1;
    }

    // Marcar célula como dividida
    markAsSplit() {
        this.hasBeenSplit = true;
        // NO cambiar el valor del dinero - mantener el valor dividido
        console.log(`[CELL_SPLIT] Célula marcada como dividida, valor mantenido: $${this.gameMoney}`);
    }

    // Verificar si la célula puede ser dividida
    canBeSplit() {
        // Las células siempre pueden ser divididas por virus
        return true;
    }

    // Verificar si tiene escudo activo
    hasShield() {
        const hasShield = this.hasActivePower('shield');
        if (hasShield) {
            console.log(`[SHIELD_CHECK] Célula tiene escudo activo`);
        }
        return hasShield;
    }

    // Limpiar poderes expirados
    cleanupExpiredPowers() {
        const now = Date.now();
        Object.keys(this.activePowers).forEach(powerType => {
            if (now > this.activePowers[powerType].endTime) {
                delete this.activePowers[powerType];
            }
        });
    }

    move(playerX, playerY, playerTarget, slowBase, initMassLog, globalSpeedMultiplier = 1.0) {
        // Limpiar poderes expirados
        this.cleanupExpiredPowers();
        
        var target = {
            x: playerX - this.x + playerTarget.x,
            y: playerY - this.y + playerTarget.y
        };
        var dist = Math.hypot(target.y, target.x)
        var deg = Math.atan2(target.y, target.x);
        var slowDown = 1;
        if (this.speed <= MIN_SPEED) {
            slowDown = util.mathLog(this.mass, slowBase) - initMassLog + 1;
        }

        // Aplicar multiplicador de velocidad local y global
        const localSpeedMultiplier = this.getSpeedMultiplier();
        const totalSpeedMultiplier = localSpeedMultiplier * globalSpeedMultiplier;
        var deltaY = this.speed * totalSpeedMultiplier * Math.sin(deg) / slowDown;
        var deltaX = this.speed * totalSpeedMultiplier * Math.cos(deg) / slowDown;

        if (this.speed > MIN_SPEED) {
            this.speed -= SPEED_DECREMENT;
        }
        if (dist < (MIN_DISTANCE + this.radius)) {
            deltaY *= dist / (MIN_DISTANCE + this.radius);
            deltaX *= dist / (MIN_DISTANCE + this.radius);
        }

        if (!isNaN(deltaY)) {
            this.y += deltaY;
        }
        if (!isNaN(deltaX)) {
            this.x += deltaX;
        }
    }

    // 0: nothing happened
    // 1: A ate B
    // 2: B ate A
    static checkWhoAteWho(cellA, cellB) {
        if (!cellA || !cellB) return 0;
        
        // Verificar si alguna célula está protegida
        if (cellA.isCurrentlyProtected() || cellB.isCurrentlyProtected()) {
            console.log(`[PROTECTION] Colisión bloqueada - Célula A protegida: ${cellA.isCurrentlyProtected()}, Célula B protegida: ${cellB.isCurrentlyProtected()}`);
            return 0; // No se puede comer si está protegida
        }
        
        let response = new sat.Response();
        let colliding = sat.testCircleCircle(cellA.toCircle(), cellB.toCircle(), response);
        if (!colliding) return 0;
        if (response.bInA) return 1;
        if (response.aInB) return 2;
        return 0;
    }
}

exports.Player = class {
    constructor(id) {
        this.id = id;
        this.hue = Math.round(Math.random() * 360);
        this.name = null;
        this.admin = false;
        this.screenWidth = null;
        this.screenHeight = null;
        this.timeToMerge = null;
        this.originalBetAmount = 0; // Apuesta inicial del jugador
        this.moneyLostToOthers = 0; // Dinero total perdido por ser comido
        this.setLastHeartbeat();
    }

    /* Initalizes things that change with every respawn */
    init(position, defaultPlayerMass) {
        this.cells = [new Cell(position.x, position.y, defaultPlayerMass, MIN_SPEED)];
        this.massTotal = defaultPlayerMass;
        this.x = position.x;
        this.y = position.y;
        this.target = {
            x: 0,
            y: 0
        };
        
        // Asignar el dinero inicial a la primera célula
        console.log(`[CELL_INIT] Inicializando célula - Player money: $${this.gameMoney}`);
        if (this.gameMoney > 0) {
            this.cells[0].gameMoney = this.gameMoney;
            console.log(`[CELL_INIT] Primera célula asignada con $${this.gameMoney}`);
        } else {
            console.log(`[CELL_INIT] No hay dinero para asignar a la célula`);
        }
        
        // Activar escudo protector inicial de 15 segundos para todas las células
        for (let cell of this.cells) {
            cell.activateProtection(15000); // 15 segundos
        }
        console.log(`[INITIAL_SHIELD] ${this.name || 'Jugador'} recibió escudo protector de 15 segundos`);
    }

    clientProvidedData(playerData) {
        this.name = playerData.name;
        this.screenWidth = playerData.screenWidth;
        this.screenHeight = playerData.screenHeight;
        this.setLastHeartbeat();
    }

    setLastHeartbeat() {
        this.lastHeartbeat = Date.now();
    }

    setLastSplit() {
        this.timeToMerge = Date.now() + 1000 * MERGE_TIMER;
    }

    loseMassIfNeeded(massLossRate, defaultPlayerMass, minMassLoss) {
        for (let i in this.cells) {
            if (this.cells[i].mass * (1 - (massLossRate / 1000)) > defaultPlayerMass && this.massTotal > minMassLoss) {
                var massLoss = this.cells[i].mass * (massLossRate / 1000);
                this.changeCellMass(i, -massLoss);
            }
        }
    }

    changeCellMass(cellIndex, massDifference) {
        this.cells[cellIndex].addMass(massDifference)
        this.massTotal += massDifference;
    }

    removeCell(cellIndex) {
        this.massTotal -= this.cells[cellIndex].mass;
        this.cells.splice(cellIndex, 1);
        return this.cells.length === 0;
    }

    // Calcular el dinero total sumando todas las células
    getTotalMoney() {
        const total = this.cells.reduce((total, cell) => total + (cell.gameMoney || 0), 0);
        return total; // No redondear para evitar pérdida de precisión
    }

    // Verificar y corregir que el dinero total no exceda la apuesta original
    validateAndCorrectMoney() {
        const totalMoney = this.getTotalMoney();
        const originalBet = this.originalBetAmount || 0;
        
        if (totalMoney > originalBet) {
            console.log(`[MONEY_VALIDATION] ${this.name} tiene $${totalMoney} pero apuesta original fue $${originalBet}. Corrigiendo...`);
            
            // Redistribuir el dinero excedente proporcionalmente entre las células
            const excess = totalMoney - originalBet;
            const totalCellMoney = this.cells.reduce((sum, cell) => sum + (cell.gameMoney || 0), 0);
            
            if (totalCellMoney > 0) {
                for (let cell of this.cells) {
                    if (cell.gameMoney > 0) {
                        const proportion = cell.gameMoney / totalCellMoney;
                        const reduction = excess * proportion;
                        cell.gameMoney = Math.max(0, Math.round((cell.gameMoney - reduction) * 100) / 100);
                    }
                }
            }
            
            const correctedTotal = this.getTotalMoney();
            console.log(`[MONEY_VALIDATION] Dinero corregido: $${correctedTotal} (original: $${totalMoney})`);
        }
    }

    // Dividir jugador cuando es comido (sistema de protección)
    splitWhenEaten(cellIndex, defaultPlayerMass) {
        console.log(`[EATEN_SPLIT] ${this.name} fue comido, dividiendo en 4 partes con protección`);
        
        const cellToSplit = this.cells[cellIndex];
        const cellMoney = cellToSplit.gameMoney || 0; // Dinero restante después de perder 25% de apuesta original
        const cellMass = cellToSplit.mass;
        
        // Calcular masa para cada parte (4 partes total)
        const massPerPart = cellMass / 4;
        
        // Dividir el dinero restante equitativamente entre las 4 células
        const moneyPerCell = cellMoney / 4;
        
        console.log(`[EATEN_SPLIT] Dinero restante total: $${cellMoney}`);
        console.log(`[EATEN_SPLIT] Dinero por célula exacto: $${moneyPerCell}`);
        
        // Crear 3 nuevas células con el dinero dividido exactamente
        for (let i = 0; i < 3; i++) {
            const newCell = new Cell(cellToSplit.x, cellToSplit.y, massPerPart, MIN_SPEED);
            newCell.gameMoney = moneyPerCell;
            newCell.activateProtection(15000); // 15 segundos de protección
            this.cells.push(newCell);
            console.log(`[EATEN_SPLIT] Nueva célula ${this.cells.length - 1} creada con $${newCell.gameMoney} y protección activada`);
        }
        
        // Modificar la célula original con el dinero exacto
        cellToSplit.setMass(massPerPart);
        cellToSplit.gameMoney = moneyPerCell;
        cellToSplit.activateProtection(15000); // 15 segundos de protección
        
        console.log(`[EATEN_SPLIT] Célula original ${cellIndex} ahora tiene $${cellToSplit.gameMoney} y protección activada`);
        console.log(`[EATEN_SPLIT] División completada - ${this.cells.length} células con protección`);
        console.log(`[EATEN_SPLIT] Total de dinero después de división: $${this.getTotalMoney()}`);
        
        return true; // Indica que el jugador no murió
    }


    // Splits a cell into multiple cells with identical mass
    // Creates n-1 new cells, and lowers the mass of the original cell
    // If the resulting cells would be smaller than defaultPlayerMass, creates fewer and bigger cells.
    splitCell(cellIndex, maxRequestedPieces, defaultPlayerMass) {
        console.log(`[SPLIT_CELL] Iniciando división de célula ${cellIndex} en ${maxRequestedPieces} partes`);
        
        // LIMITACIÓN: Máximo 4 células totales
        const MAX_CELLS = 4;
        
        // Verificar si ya tenemos 4 células antes de dividir
        if (this.cells.length >= MAX_CELLS) {
            console.log(`[SPLIT_CELL_LIMIT] ${this.name} ya tiene ${this.cells.length} células (máximo ${MAX_CELLS}). No se puede dividir más.`);
            return; // No dividir si ya tiene 4 células
        }
        
        let cellToSplit = this.cells[cellIndex];
        
        // Verificar si la célula puede ser dividida
        if (!cellToSplit.canBeSplit()) {
            console.log(`[SPLIT_CELL_LIMIT] Célula ${cellIndex} no puede ser dividida`);
            return; // No dividir si no puede ser dividida
        }
        
        let maxAllowedPieces = Math.floor(cellToSplit.mass / defaultPlayerMass); // If we split the cell ino more pieces, they will be too small.
        let piecesToCreate = Math.min(maxAllowedPieces, maxRequestedPieces);
        
        // Ajustar el número de piezas para no exceder el límite de 4 células
        const maxPossiblePieces = MAX_CELLS - this.cells.length + 1; // +1 porque una célula se reemplaza
        piecesToCreate = Math.min(piecesToCreate, maxPossiblePieces);
        
        console.log(`[SPLIT_CELL] Masa de célula: ${cellToSplit.mass}, defaultPlayerMass: ${defaultPlayerMass}`);
        console.log(`[SPLIT_CELL] maxAllowedPieces: ${maxAllowedPieces}, piecesToCreate: ${piecesToCreate}, maxPossiblePieces: ${maxPossiblePieces}`);
        
        // Para virus, forzar la división en el número de partes solicitado (pero respetando el límite)
        if (maxRequestedPieces === 4) {
            piecesToCreate = Math.min(4, maxPossiblePieces);
            console.log(`[SPLIT_CELL] Forzando división en ${piecesToCreate} partes para virus (limitado por máximo células)`);
        }
        
        if (piecesToCreate === 0) {
            console.log(`[SPLIT_CELL] No se pueden crear piezas, abortando división`);
            return;
        }
        let newCellsMass = cellToSplit.mass / piecesToCreate;
        
                // Dividir el dinero de la célula entre las nuevas células
        // Usar solo el dinero de la célula específica
        const cellMoney = cellToSplit.gameMoney || 0;
        console.log(`[SPLIT_CELL] Dinero de célula: ${cellToSplit.gameMoney}, total a dividir: ${cellMoney}`);
        
        if (cellMoney > 0) {
            // Calcular dinero por célula con precisión exacta
            const moneyPerCell = cellMoney / piecesToCreate;
            
            console.log(`[SPLIT] Célula ${cellIndex} con $${cellMoney} se divide en ${piecesToCreate} partes`);
            console.log(`[SPLIT] Cálculo exacto: ${cellMoney} / ${piecesToCreate} = ${moneyPerCell}`);
            
            // Crear las nuevas células con distribución exacta del dinero
            for (let i = 0; i < piecesToCreate - 1; i++) {
                const newCell = new Cell(cellToSplit.x, cellToSplit.y, newCellsMass, SPLIT_CELL_SPEED);
                // Asignar dinero exacto sin redondeo
                newCell.gameMoney = moneyPerCell;
                // Marcar la nueva célula como dividida
                newCell.markAsSplit();
                this.cells.push(newCell);
                console.log(`[SPLIT] Nueva célula ${this.cells.length - 1} creada con $${newCell.gameMoney} - MARCADA COMO DIVIDIDA`);
            }
            
            // Asignar el dinero exacto a la célula original y marcarla como dividida
            cellToSplit.gameMoney = moneyPerCell;
            cellToSplit.markAsSplit();
            console.log(`[SPLIT] Célula original ${cellIndex} ahora tiene $${cellToSplit.gameMoney} - MARCADA COMO DIVIDIDA`);
            
            // Verificar que el dinero total se mantenga correcto
            const totalMoneyAfterSplit = this.getTotalMoney();
            console.log(`[SPLIT] Dinero total después de división: $${totalMoneyAfterSplit} (original: $${cellMoney})`);
        } else {
            // Si no hay dinero, crear células sin dinero
            for (let i = 0; i < piecesToCreate - 1; i++) {
                const newCell = new Cell(cellToSplit.x, cellToSplit.y, newCellsMass, SPLIT_CELL_SPEED);
                newCell.gameMoney = 0;
                // Marcar la nueva célula como dividida (no se puede dividir más)
                newCell.markAsSplit();
                this.cells.push(newCell);
                console.log(`[SPLIT] Nueva célula ${this.cells.length - 1} creada sin dinero - MARCADA COMO DIVIDIDA`);
            }
            // Marcar la célula original como dividida
            cellToSplit.markAsSplit();
        }
        
        cellToSplit.setMass(newCellsMass);
        this.setLastSplit();
        
        console.log(`[SPLIT_CELL] División completada. Total de células: ${this.cells.length}`);
        console.log(`[SPLIT_CELL] Dinero total después de división: $${this.getTotalMoney()}`);
        
        // Mostrar el dinero de cada célula individual
        for (let i = 0; i < this.cells.length; i++) {
            console.log(`[SPLIT_CELL] Célula ${i}: $${this.cells[i].gameMoney || 0}`);
        }
        
        // Comentado: Validación que interfería con la división correcta
        // this.validateAndCorrectMoney();
    }

    // Performs a split resulting from colliding with a virus.
    // The player will have the highest possible number of cells.
    virusSplit(cellIndexes, maxCells, defaultPlayerMass) {
        if (cellIndexes.length === 0) {
            return; // No hay células para dividir
        }
        
        // LIMITACIÓN: Máximo 4 células totales
        const MAX_CELLS = 4;
        
        console.log(`[VIRUS_SPLIT] ${this.name} dividiendo ${cellIndexes.length} células por virus`);
        for (let cellIndex of cellIndexes) {
            // Verificar si ya tenemos 4 células antes de dividir
            if (this.cells.length >= MAX_CELLS) {
                console.log(`[VIRUS_SPLIT_LIMIT] ${this.name} ya tiene ${this.cells.length} células (máximo ${MAX_CELLS}). No se puede dividir más por virus.`);
                break; // No dividir más si ya tiene 4 células
            }
            
            // Verificar si la célula puede ser dividida
            if (!this.cells[cellIndex].canBeSplit()) {
                console.log(`[VIRUS_SPLIT_LIMIT] Célula ${cellIndex} no puede ser dividida por virus`);
                continue; // Saltar esta célula
            }
            
            console.log(`[VIRUS_SPLIT] Llamando splitCell para célula ${cellIndex} con 4 partes`);
            // Para virus, siempre dividir en 4 partes
            this.splitCell(cellIndex, 4, defaultPlayerMass);
        }
    }

    // Performs a split initiated by the player.
    // Tries to split every cell in half, but never more than 4 cells total.
    userSplit(maxCells, defaultPlayerMass) {
        // LIMITACIÓN: Máximo 4 células totales
        const MAX_CELLS = 4;
        
        if (this.cells.length >= MAX_CELLS) {
            console.log(`[SPLIT_LIMIT] ${this.name} ya tiene ${this.cells.length} células (máximo ${MAX_CELLS}). No se puede dividir más.`);
            return; // No dividir si ya tiene 4 células
        }
        
        // Todas las células pueden ser divididas
        const splittableCells = this.cells;
        
        if (splittableCells.length === 0) {
            console.log(`[SPLIT_LIMIT] ${this.name} no tiene células para dividir`);
            return;
        }
        
        let cellsToCreate;
        const maxPossibleCells = Math.min(maxCells, MAX_CELLS);
        
        if (this.cells.length > maxPossibleCells / 2) { // Not every cell can be split
            cellsToCreate = maxPossibleCells - this.cells.length + 1;

            // Ordenar por masa (todas las células pueden ser divididas)
            this.cells.sort(function (a, b) { // Sort the cells so the biggest ones will be split
                return b.mass - a.mass;
            });
        } else { // Every cell can be split
            cellsToCreate = splittableCells.length;
        }

        console.log(`[SPLIT_LIMIT] ${this.name} dividiendo ${cellsToCreate} células (de ${splittableCells.length} disponibles). Total después: ${this.cells.length + cellsToCreate}`);

        let splitCount = 0;
        for (let i = 0; i < this.cells.length && splitCount < cellsToCreate; i++) {
            this.splitCell(i, 2, defaultPlayerMass);
            splitCount++;
        }
    }

    // Loops trough cells, and calls callback with colliding ones
    // Passes the colliding cells and their indexes to the callback
    // null values are skipped during the iteration and removed at the end
    enumerateCollidingCells(callback) {
        for (let cellAIndex = 0; cellAIndex < this.cells.length; cellAIndex++) {
            let cellA = this.cells[cellAIndex];
            if (!cellA) continue; // cell has already been merged

            for (let cellBIndex = cellAIndex + 1; cellBIndex < this.cells.length; cellBIndex++) {
                let cellB = this.cells[cellBIndex];
                if (!cellB) continue;
                let colliding = sat.testCircleCircle(cellA.toCircle(), cellB.toCircle());
                if (colliding) {
                    callback(this.cells, cellAIndex, cellBIndex);
                }
            }
        }

        this.cells = util.removeNulls(this.cells);
    }

    mergeCollidingCells() {
        this.enumerateCollidingCells(function (cells, cellAIndex, cellBIndex) {
            // Combinar masa
            cells[cellAIndex].addMass(cells[cellBIndex].mass);
            
            // Combinar dinero con precisión decimal
            const cellAMoney = cells[cellAIndex].gameMoney || 0;
            const cellBMoney = cells[cellBIndex].gameMoney || 0;
            const combinedMoney = Math.round((cellAMoney + cellBMoney) * 100) / 100; // Redondear a 2 decimales
            cells[cellAIndex].gameMoney = combinedMoney;
            
            // Si ambas células fueron divididas, la célula resultante también está marcada como dividida
            if (cells[cellAIndex].hasBeenSplit || cells[cellBIndex].hasBeenSplit) {
                cells[cellAIndex].hasBeenSplit = true;
                console.log(`[MERGE] Célula resultante marcada como dividida (combinación de células divididas)`);
            }
            
            if (cellBMoney > 0) {
                console.log(`[MERGE] Célula ${cellAIndex} absorbió $${cellBMoney} de célula ${cellBIndex}. Total combinado: $${combinedMoney}`);
            }
            
            // Verificar que el dinero total se mantenga correcto después de la unificación
            const totalMoney = cells.reduce((sum, cell, index) => {
                if (cell && index !== cellBIndex) { // Excluir la célula que será eliminada
                    return sum + (cell.gameMoney || 0);
                }
                return sum;
            }, 0);
            
            console.log(`[MERGE] Dinero total después de unificación: $${Math.round(totalMoney * 100) / 100}`);
            
            cells[cellBIndex] = null;
        });
        
        // Comentado: Validación que interfería con la unificación correcta
        // this.validateAndCorrectMoney();
    }

    pushAwayCollidingCells() {
        this.enumerateCollidingCells(function (cells, cellAIndex, cellBIndex) {
            let cellA = cells[cellAIndex],
                cellB = cells[cellBIndex],
                vector = new sat.Vector(cellB.x - cellA.x, cellB.y - cellA.y); // vector pointing from A to B
            vector = vector.normalize().scale(PUSHING_AWAY_SPEED, PUSHING_AWAY_SPEED);
            if (vector.len() == 0) { // The two cells are perfectly on the top of each other
                vector = new sat.Vector(0, 1);
            }

            cellA.x -= vector.x;
            cellA.y -= vector.y;

            cellB.x += vector.x;
            cellB.y += vector.y;
        });
    }

    move(slowBase, gameWidth, gameHeight, initMassLog, globalSpeedMultiplier = 1.0, redZone = null) {
        if (this.cells.length > 1) {
            if (this.timeToMerge < Date.now()) {
                this.mergeCollidingCells();
            } else {
                this.pushAwayCollidingCells();
            }
        }

        let xSum = 0, ySum = 0;
        for (let i = 0; i < this.cells.length; i++) {
            let cell = this.cells[i];
            cell.move(this.x, this.y, this.target, slowBase, initMassLog, globalSpeedMultiplier);
            adjustForBoundaries(cell, cell.radius/3, 0, gameWidth, gameHeight);
            
            // Prevent cell from moving into red zone
            if (redZone && redZone.radius) {
                adjustForRedZone(cell, redZone);
            }

            xSum += cell.x;
            ySum += cell.y;
        }
        this.x = xSum / this.cells.length;
        this.y = ySum / this.cells.length;
    }

    // Calls `callback` if any of the two cells ate the other.
    static checkForCollisions(playerA, playerB, playerAIndex, playerBIndex, callback) {
        for (let cellAIndex in playerA.cells) {
            for (let cellBIndex in playerB.cells) {
                let cellA = playerA.cells[cellAIndex];
                let cellB = playerB.cells[cellBIndex];

                let cellAData = { playerIndex: playerAIndex, cellIndex: cellAIndex };
                let cellBData = { playerIndex: playerBIndex, cellIndex: cellBIndex };

                let whoAteWho = Cell.checkWhoAteWho(cellA, cellB);

                if (whoAteWho == 1) {
                    callback(cellBData, cellAData);
                } else if (whoAteWho == 2) {
                    callback(cellAData, cellBData);
                }
            }
        }
    }
}
exports.PlayerManager = class {
    constructor() {
        this.data = [];
    }

    pushNew(player) {
        this.data.push(player);
    }

    findIndexByID(id) {
        return util.findIndex(this.data, id);
    }

    removePlayerByID(id) {
        let index = this.findIndexByID(id);
        if (index > -1) {
            this.removePlayerByIndex(index);
        }
    }

    removePlayerByIndex(index) {
        this.data.splice(index, 1);
    }

    shrinkCells(massLossRate, defaultPlayerMass, minMassLoss) {
        for (let player of this.data) {
            player.loseMassIfNeeded(massLossRate, defaultPlayerMass, minMassLoss);
        }
    }

    removeCell(playerIndex, cellIndex) {
        return this.data[playerIndex].removeCell(cellIndex);
    }

    getCell(playerIndex, cellIndex) {
        return this.data[playerIndex].cells[cellIndex]
    }

    handleCollisions(callback) {
        for (let playerAIndex = 0; playerAIndex < this.data.length; playerAIndex++) {
            for (let playerBIndex = playerAIndex + 1; playerBIndex < this.data.length; playerBIndex++) {
                exports.Player.checkForCollisions(
                    this.data[playerAIndex],
                    this.data[playerBIndex],
                    playerAIndex,
                    playerBIndex,
                    callback
                );
            }
        }
    }

    getTopPlayers() {
        this.data.sort(function (a, b) { return b.massTotal - a.massTotal; });
        var topPlayers = [];
        for (var i = 0; i < Math.min(10, this.data.length); i++) {
            topPlayers.push({
                id: this.data[i].id,
                name: this.data[i].name
            });
        }
        return topPlayers;
    }

    getTotalMass() {
        let result = 0;
        for (let player of this.data) {
            result += player.massTotal;
        }
        return result;
    }
}
