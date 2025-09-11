var global = require('./global');

class Canvas {
    constructor(params) {
        this.directionLock = false;
        this.target = global.target;
        this.reenviar = true;
        this.socket = global.socket;
        this.directions = [];
        var self = this;

        this.cv = document.getElementById('cvs');
        this.cv.width = global.screen.width;
        this.cv.height = global.screen.height;
        this.cv.addEventListener('mousemove', this.gameInput, false);
        this.cv.addEventListener('mouseout', this.outOfBounds, false);
        this.cv.addEventListener('keypress', this.keyInput, false);
        this.cv.addEventListener('keyup', function(event) {
            self.reenviar = true;
            self.directionUp(event);
        }, false);
        this.cv.addEventListener('keydown', this.directionDown, false);
        this.cv.addEventListener('touchstart', this.touchInput, false);
        this.cv.addEventListener('touchmove', this.touchInput, false);
        this.cv.parent = self;
        global.canvas = this;
    }

    // Function called when a key is pressed, will change direction if arrow key.
    directionDown(event) {
    	var key = event.which || event.keyCode;
        var self = this.parent; // have to do this so we are not using the cv object
    	if (self.directional(key)) {
    		self.directionLock = true;
    		if (self.newDirection(key, self.directions, true)) {
    			self.updateTarget(self.directions);
    			self.socket.emit('0', self.target);
    		}
    	}
    }

    // Function called when a key is lifted, will change direction if arrow key.
    directionUp(event) {
    	var key = event.which || event.keyCode;
    	if (this.directional(key)) { // this == the actual class
    		if (this.newDirection(key, this.directions, false)) {
    			this.updateTarget(this.directions);
    			if (this.directions.length === 0) this.directionLock = false;
    			this.socket.emit('0', this.target);
    		}
    	}
    }

    // Updates the direction array including information about the new direction.
    newDirection(direction, list, isAddition) {
    	var result = false;
    	var found = false;
    	for (var i = 0, len = list.length; i < len; i++) {
    		if (list[i] == direction) {
    			found = true;
    			if (!isAddition) {
    				result = true;
    				// Removes the direction.
    				list.splice(i, 1);
    			}
    			break;
    		}
    	}
    	// Adds the direction.
    	if (isAddition && found === false) {
    		result = true;
    		list.push(direction);
    	}

    	return result;
    }

    // Updates the target according to the directions in the directions array.
    updateTarget(list) {
    	this.target = { x : 0, y: 0 };
    	var directionHorizontal = 0;
    	var directionVertical = 0;
    	for (var i = 0, len = list.length; i < len; i++) {
    		if (directionHorizontal === 0) {
    			if (list[i] == global.KEY_LEFT) directionHorizontal -= Number.MAX_VALUE;
    			else if (list[i] == global.KEY_RIGHT) directionHorizontal += Number.MAX_VALUE;
    		}
    		if (directionVertical === 0) {
    			if (list[i] == global.KEY_UP) directionVertical -= Number.MAX_VALUE;
    			else if (list[i] == global.KEY_DOWN) directionVertical += Number.MAX_VALUE;
    		}
    	}
    	this.target.x += directionHorizontal;
    	this.target.y += directionVertical;
        global.target = this.target;
    }

    directional(key) {
    	return this.horizontal(key) || this.vertical(key);
    }

    horizontal(key) {
    	return key == global.KEY_LEFT || key == global.KEY_RIGHT;
    }

    vertical(key) {
    	return key == global.KEY_DOWN || key == global.KEY_UP;
    }

    // Register when the mouse goes off the canvas.
    outOfBounds() {
        if (!global.continuity) {
            this.parent.target = { x : 0, y: 0 };
            global.target = this.parent.target;
        }
    }

    gameInput(mouse) {
    	if (!this.directionLock) {
    		this.parent.target.x = mouse.clientX - this.parent.cv.width / 2;
    		this.parent.target.y = mouse.clientY - this.parent.cv.height / 2;
            global.target = this.parent.target;
            
            // Debug: verificar que el mouse esté funcionando
            if (!global.debugLogsDisabled) {
                console.log('[MOUSE] Target actualizado:', this.parent.target.x, this.parent.target.y);
            }
    	}
    }

    touchInput(touch) {
        touch.preventDefault();
        touch.stopPropagation();
    	if (!this.directionLock) {
    		this.parent.target.x = touch.touches[0].clientX - this.parent.cv.width / 2;
    		this.parent.target.y = touch.touches[0].clientY - this.parent.cv.height / 2;
            global.target = this.parent.target;
    	}
    }

    // Chat command callback functions.
    keyInput(event) {
    	var key = event.which || event.keyCode;
    	if (key === global.KEY_FIREFOOD && this.parent.reenviar) {
            // Validar que el jugador tenga masa suficiente antes de disparar comida
            if (this.canUseFireFood()) {
                this.parent.socket.emit('1');
                this.parent.reenviar = false;
            } else {
                console.log('[FIREFOOD] No tienes masa suficiente para disparar comida');
                // Mostrar mensaje al usuario si está disponible
                if (window.chat && window.chat.addSystemLine) {
                    window.chat.addSystemLine(' ❌ No tienes masa suficiente para disparar comida');
                }
            }
        }
        else if (key === global.KEY_SPLIT && this.parent.reenviar) {
            document.getElementById('split_cell').play();
            this.parent.socket.emit('2');
            this.parent.reenviar = false;
        }
        else if (key === global.KEY_CHAT) {
            document.getElementById('chatInput').focus();
        }
    }

    // Verificar si el jugador puede usar el poder de disparar comida
    canUseFireFood() {
        // Verificar si tenemos información del jugador
        if (!global.player || !global.player.cells || global.player.cells.length === 0) {
            console.log('[FIREFOOD_DEBUG] No hay información del jugador disponible');
            return false;
        }

        // Verificar si alguna célula tiene masa suficiente
        // La masa mínima requerida es defaultPlayerMass + fireFood (10 + 20 = 30)
        const minRequiredMass = 30; // config.defaultPlayerMass + config.fireFood
        
        console.log(`[FIREFOOD_DEBUG] Verificando ${global.player.cells.length} células. Masa mínima requerida: ${minRequiredMass}`);
        
        for (let i = 0; i < global.player.cells.length; i++) {
            const cellMass = global.player.cells[i].mass;
            console.log(`[FIREFOOD_DEBUG] Célula ${i}: masa = ${cellMass}`);
            if (cellMass >= minRequiredMass) {
                console.log(`[FIREFOOD_DEBUG] Célula ${i} puede disparar comida`);
                return true;
            }
        }
        
        console.log('[FIREFOOD_DEBUG] Ninguna célula tiene masa suficiente');
        return false;
    }
}

module.exports = Canvas;
