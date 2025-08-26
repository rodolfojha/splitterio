const FULL_ANGLE = 2 * Math.PI;

// Sistema de skins con imágenes
const skinImages = {};
const skinImagesLoaded = {};

// Precargar todas las imágenes de skins
const preloadSkinImages = () => {
    const skinFiles = ['skin1.jpg', 'skin2.jpg', 'skin3.jpg', 'skin4.jpg'];
    
    skinFiles.forEach((skinFile, index) => {
        const skinId = index + 1;
        skinImages[skinId] = new Image();
        skinImages[skinId].onload = function() {
            skinImagesLoaded[skinId] = true;
            console.log(`[SKIN_LOADER] Imagen de skin ${skinId} cargada: ${skinFile}`);
        };
        skinImages[skinId].onerror = function() {
            console.error(`[SKIN_LOADER] Error al cargar imagen de skin ${skinId}: ${skinFile}`);
        };
        skinImages[skinId].src = `img/${skinFile}`;
    });
};

// Inicializar la precarga de skins
preloadSkinImages();

const drawRoundObject = (position, radius, graph) => {
    graph.beginPath();
    graph.arc(position.x, position.y, radius, 0, FULL_ANGLE);
    graph.closePath();
    graph.fill();
    graph.stroke();
}

// Función para dibujar célula con textura de skin
const drawCellWithSkin = (cell, graph) => {
    const skinId = cell.skinId || 1; // Default a skin 1 si no hay skin asignada
    
    // Debug: verificar si la skin está cargada
    if (!skinImagesLoaded[skinId]) {
        // console.log(`[SKIN_DEBUG] Skin ${skinId} no está cargada para célula ${cell.name}`);
    }
    
    if (skinImagesLoaded[skinId] && skinImages[skinId]) {
        // console.log(`[SKIN_DEBUG] Dibujando skin ${skinId} para célula ${cell.name}`);
        
        // Crear un patrón de recorte circular para la skin
        graph.save();
        
        // Crear un path circular para recortar la imagen
        graph.beginPath();
        graph.arc(cell.x, cell.y, cell.radius, 0, 2 * Math.PI);
        graph.clip(); // Recortar todo lo que se dibuje después
        
        // Calcular las dimensiones y posición para que la imagen cubra toda la célula
        const diameter = cell.radius * 2;
        const imgX = cell.x - cell.radius;
        const imgY = cell.y - cell.radius;
        
        // Dibujar la imagen de la skin
        graph.drawImage(skinImages[skinId], imgX, imgY, diameter, diameter);
        
        graph.restore(); // Restaurar el estado del canvas
        
        // Dibujar el borde de la célula
        graph.strokeStyle = cell.borderColor;
        graph.lineWidth = 6;
        graph.beginPath();
        graph.arc(cell.x, cell.y, cell.radius, 0, 2 * Math.PI);
        graph.stroke();
    } else {
        // Fallback: dibujar con color si la imagen no está cargada
        // console.log(`[SKIN_DEBUG] Usando fallback de color para célula ${cell.name} (skinId: ${skinId})`);
        graph.fillStyle = cell.color;
        graph.strokeStyle = cell.borderColor;
        graph.lineWidth = 6;
        graph.beginPath();
        graph.arc(cell.x, cell.y, cell.radius, 0, 2 * Math.PI);
        graph.closePath();
        graph.fill();
        graph.stroke();
    }
}

const drawFood = (position, food, graph) => {
    graph.fillStyle = 'hsl(' + food.hue + ', 100%, 50%)';
    graph.strokeStyle = 'hsl(' + food.hue + ', 100%, 45%)';
    graph.lineWidth = 0;
    drawRoundObject(position, food.radius, graph);
};

const drawPowerFood = (position, powerFood, graph) => {
    // Efecto especial para frutas de poder
    const time = Date.now() / 1000;
    const pulse = Math.sin(time * 4) * 0.2 + 0.8; // Efecto pulsante más rápido
    
    // Color base con efecto pulsante
    graph.fillStyle = `hsl(${powerFood.hue}, 100%, ${50 + pulse * 10}%)`;
    graph.strokeStyle = `hsl(${powerFood.hue}, 100%, 40%)`;
    graph.lineWidth = 2;
    
    // Agregar brillo especial
    graph.shadowColor = `hsl(${powerFood.hue}, 100%, 70%)`;
    graph.shadowBlur = 15;
    
    drawRoundObject(position, powerFood.radius, graph);
    
    // Restaurar sombra
    graph.shadowBlur = 0;
    
    // Agregar un pequeño símbolo de poder en el centro
    graph.fillStyle = 'white';
    graph.font = `${powerFood.radius * 0.8}px Arial`;
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    
    let symbol = '⚡';
    switch(powerFood.powerType) {
        case 'speed_boost':
            symbol = '🍇';
            break;
        case 'mass_boost':
            symbol = '🍎';
            break;
        case 'shield':
            symbol = '🛡️';
            break;
    }
    
    graph.fillText(symbol, position.x, position.y);
};

const drawVirus = (position, virus, graph) => {
    graph.strokeStyle = virus.stroke;
    graph.fillStyle = virus.fill;
    graph.lineWidth = virus.strokeWidth;
    let theta = 0;
    let sides = 20;

    graph.beginPath();
    for (let theta = 0; theta < FULL_ANGLE; theta += FULL_ANGLE / sides) {
        let point = circlePoint(position, virus.radius, theta);
        graph.lineTo(point.x, point.y);
    }
    graph.closePath();
    graph.stroke();
    graph.fill();
};

const drawFireFood = (position, mass, playerConfig, graph) => {
    graph.strokeStyle = 'hsl(' + mass.hue + ', 100%, 45%)';
    graph.fillStyle = 'hsl(' + mass.hue + ', 100%, 50%)';
    graph.lineWidth = playerConfig.border + 2;
    drawRoundObject(position, mass.radius - 1, graph);
};

const valueInRange = (min, max, value) => Math.min(max, Math.max(min, value))

const circlePoint = (origo, radius, theta) => ({
    x: origo.x + radius * Math.cos(theta),
    y: origo.y + radius * Math.sin(theta)
});

const cellTouchingBorders = (cell, borders) =>
    cell.x - cell.radius <= borders.left ||
    cell.x + cell.radius >= borders.right ||
    cell.y - cell.radius <= borders.top ||
    cell.y + cell.radius >= borders.bottom

const regulatePoint = (point, borders) => ({
    x: valueInRange(borders.left, borders.right, point.x),
    y: valueInRange(borders.top, borders.bottom, point.y)
});

const drawCellWithLines = (cell, borders, graph) => {
    let pointCount = 30 + ~~(cell.mass / 5);
    let points = [];
    for (let theta = 0; theta < FULL_ANGLE; theta += FULL_ANGLE / pointCount) {
        let point = circlePoint(cell, cell.radius, theta);
        points.push(regulatePoint(point, borders));
    }
    graph.beginPath();
    graph.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        graph.lineTo(points[i].x, points[i].y);
    }
    graph.closePath();
    graph.fill();
    graph.stroke();
}

const drawCells = (cells, playerConfig, toggleMassState, borders, graph) => {
    for (let cell of cells) {
        // Draw the cell itself
        graph.fillStyle = cell.color;
        graph.strokeStyle = cell.borderColor;
        graph.lineWidth = 6;
        
        // Si la célula está protegida o tiene escudo, cambiar el estilo visual
        if (cell.isProtected || cell.hasShield) {
            // Efecto de protección: borde brillante y pulsante
            const time = Date.now() / 1000;
            const pulse = Math.sin(time * 3) * 0.3 + 0.7; // Efecto pulsante
            graph.strokeStyle = `rgba(255, 255, 0, ${pulse})`; // Amarillo pulsante
            graph.lineWidth = 8;
            
            // Agregar un halo de protección
            graph.shadowColor = 'rgba(255, 255, 0, 0.5)';
            graph.shadowBlur = 10;
        } else {
            graph.shadowBlur = 0;
        }

        // Efecto especial para escudo activo
        if (cell.hasShield) {
            const time = Date.now() / 1000;
            const rotation = time * 2; // Rotación constante
            
            // Dibujar anillos giratorios alrededor de la célula
            for (let i = 0; i < 3; i++) {
                const ringRadius = cell.radius + 8 + (i * 4);
                const ringAlpha = 0.6 - (i * 0.15);
                const ringRotation = rotation + (i * Math.PI / 3);
                
                graph.strokeStyle = `rgba(0, 150, 255, ${ringAlpha})`; // Azul para escudo
                graph.lineWidth = 3;
                graph.setLineDash([5, 5]); // Línea punteada
                
                graph.beginPath();
                graph.arc(cell.x, cell.y, ringRadius, ringRotation, ringRotation + Math.PI * 1.5);
                graph.stroke();
            }
            
            // Restaurar línea sólida
            graph.setLineDash([]);
            
            // Agregar símbolo de escudo giratorio en el centro
            const shieldSize = cell.radius * 0.4;
            graph.save();
            graph.translate(cell.x, cell.y);
            graph.rotate(rotation);
            graph.fillStyle = 'rgba(0, 150, 255, 0.8)';
            graph.font = `${shieldSize}px Arial`;
            graph.textAlign = 'center';
            graph.textBaseline = 'middle';
            graph.fillText('🛡️', 0, 0);
            graph.restore();
        }
        
        if (cellTouchingBorders(cell, borders)) {
            // Asssemble the cell from lines
            drawCellWithLines(cell, borders, graph);
        } else {
            // Dibujar célula con skin si está disponible, sino con color
            if (cell.skinId && skinImagesLoaded[cell.skinId]) {
                drawCellWithSkin(cell, graph);
            } else {
                // Border corrections are not needed, the cell can be drawn as a circle
                drawRoundObject(cell, cell.radius, graph);
            }
        }
        
        // Restaurar sombra
        graph.shadowBlur = 0;

        // Draw the name of the player
        let fontSize = Math.max(cell.radius / 3, 12);
        graph.lineWidth = playerConfig.textBorderSize;
        graph.fillStyle = playerConfig.textColor;
        graph.strokeStyle = playerConfig.textBorder;
        graph.miterLimit = 1;
        graph.lineJoin = 'round';
        graph.textAlign = 'center';
        graph.textBaseline = 'middle';
        graph.font = 'bold ' + fontSize + 'px sans-serif';
        graph.strokeText(cell.name, cell.x, cell.y);
        graph.fillText(cell.name, cell.x, cell.y);

        // Draw the mass (if enabled)
        if (toggleMassState === 1) {
            graph.font = 'bold ' + Math.max(fontSize / 3 * 2, 10) + 'px sans-serif';
            if (cell.name.length === 0) fontSize = 0;
            graph.strokeText(Math.round(cell.mass), cell.x, cell.y + fontSize);
            graph.fillText(Math.round(cell.mass), cell.x, cell.y + fontSize);
        }

        // Draw the money (if available)
        if (cell.gameMoney && cell.gameMoney > 0) {
            // Log para debug del dinero por célula (solo cuando está activado)
            if (global.debugMoney) {
                console.log(`[RENDER] Célula en (${cell.x.toFixed(0)}, ${cell.y.toFixed(0)}) tiene $${cell.gameMoney}`);
                console.log(`[RENDER_DEBUG] Información completa de célula:`, cell);
            }
            const moneyFontSize = Math.max(fontSize / 3 * 2, 10);
            graph.font = 'bold ' + moneyFontSize + 'px sans-serif';
            graph.fillStyle = '#FFD700'; // Color dorado para el dinero
            graph.strokeStyle = '#B8860B';
            graph.lineWidth = 2;
            
            const moneyText = '$' + cell.gameMoney;
            const moneyY = cell.y + fontSize + (toggleMassState === 1 ? moneyFontSize : 0);
            
            graph.strokeText(moneyText, cell.x, moneyY);
            graph.fillText(moneyText, cell.x, moneyY);
        }

        // Draw protection time (if protected)
        if (cell.isProtected && cell.protectionTimeLeft > 0) {
            const protectionFontSize = Math.max(fontSize / 3 * 2, 10);
            graph.font = 'bold ' + protectionFontSize + 'px sans-serif';
            graph.fillStyle = '#FFD700'; // Color dorado para protección
            graph.strokeStyle = '#B8860B';
            graph.lineWidth = 2;
            
            const protectionText = `🛡️ ${cell.protectionTimeLeft}s`;
            const protectionY = cell.y + fontSize + (toggleMassState === 1 ? protectionFontSize : 0) + (cell.gameMoney && cell.gameMoney > 0 ? protectionFontSize : 0);
            
            graph.strokeText(protectionText, cell.x, protectionY);
            graph.fillText(protectionText, cell.x, protectionY);
        }
    }
};

const drawGrid = (global, player, screen, graph) => {
    graph.lineWidth = 1;
    graph.strokeStyle = global.lineColor;
    graph.globalAlpha = 0.15;
    graph.beginPath();

    for (let x = -player.x; x < screen.width; x += screen.height / 18) {
        graph.moveTo(x, 0);
        graph.lineTo(x, screen.height);
    }

    for (let y = -player.y; y < screen.height; y += screen.height / 18) {
        graph.moveTo(0, y);
        graph.lineTo(screen.width, y);
    }

    graph.stroke();
    graph.globalAlpha = 1;
};

const drawBorder = (borders, graph) => {
    graph.lineWidth = 1;
    graph.strokeStyle = '#000000'
    graph.beginPath()
    graph.moveTo(borders.left, borders.top);
    graph.lineTo(borders.right, borders.top);
    graph.lineTo(borders.right, borders.bottom);
    graph.lineTo(borders.left, borders.bottom);
    graph.closePath()
    graph.stroke();
};

const drawErrorMessage = (message, graph, screen) => {
    graph.fillStyle = '#333333';
    graph.fillRect(0, 0, screen.width, screen.height);
    graph.textAlign = 'center';
    graph.fillStyle = '#FFFFFF';
    graph.font = 'bold 30px sans-serif';
    graph.fillText(message, screen.width / 2, screen.height / 2);
}

const drawRedZone = (redZone, player, screen, graph) => {
    // Convertir coordenadas del mundo a coordenadas de pantalla
    const zoneCenterX = redZone.centerX - player.x + screen.width / 2;
    const zoneCenterY = redZone.centerY - player.y + screen.height / 2;
    
    // Dibujar la zona roja con color sólido hasta exactamente la línea del círculo
    graph.fillStyle = 'rgba(255, 0, 0, 0.4)';
    graph.fillRect(0, 0, screen.width, screen.height);
    
    // Crear un "agujero" transparente para la zona segura usando composición
    graph.globalCompositeOperation = 'destination-out';
    graph.beginPath();
    graph.arc(zoneCenterX, zoneCenterY, redZone.radius, 0, 2 * Math.PI);
    graph.fill();
    graph.globalCompositeOperation = 'source-over'; // Restaurar operación de composición
    
    // Dibujar el borde de la zona segura (círculo interior)
    graph.strokeStyle = 'rgba(255, 0, 0, 0.8)';
    graph.lineWidth = 3;
    graph.setLineDash([10, 5]); // Línea punteada
    graph.beginPath();
    graph.arc(zoneCenterX, zoneCenterY, redZone.radius, 0, 2 * Math.PI);
    graph.stroke();
    graph.setLineDash([]); // Resetear el patrón de línea
    
    // Dibujar texto de advertencia
    graph.fillStyle = 'rgba(255, 0, 0, 0.9)';
    graph.font = 'bold 16px sans-serif';
    graph.textAlign = 'center';
    graph.fillText('ZONA DE PELIGRO', zoneCenterX, zoneCenterY - redZone.radius - 20);
    graph.fillText('¡MANTENTE DENTRO DEL CÍRCULO!', zoneCenterX, zoneCenterY - redZone.radius - 5);
};

const drawCashOutProgress = (progress, screen, graph) => {
    const barWidth = 300;
    const barHeight = 20;
    const barX = (screen.width - barWidth) / 2;
    const barY = screen.height - 100;
    
    // Fondo de la barra
    graph.fillStyle = 'rgba(0, 0, 0, 0.7)';
    graph.fillRect(barX, barY, barWidth, barHeight);
    
    // Borde de la barra
    graph.strokeStyle = '#FFD700';
    graph.lineWidth = 2;
    graph.strokeRect(barX, barY, barWidth, barHeight);
    
    // Progreso de la barra
    const progressWidth = barWidth * progress;
    graph.fillStyle = '#FFD700';
    graph.fillRect(barX, barY, progressWidth, barHeight);
    
    // Texto de la barra
    graph.fillStyle = '#FFFFFF';
    graph.font = 'bold 14px sans-serif';
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    
    const progressText = progress >= 1 ? 'CASH OUT COMPLETADO!' : `CASH OUT: ${Math.round(progress * 100)}%`;
    graph.fillText(progressText, screen.width / 2, barY + barHeight / 2);
    
    // Instrucciones
    graph.fillStyle = '#FFD700';
    graph.font = '12px sans-serif';
    graph.fillText('Mantén presionada la tecla C', screen.width / 2, barY - 10);
};

const drawBomb = (position, bomb, graph) => {
    // Efecto de parpadeo para las bombas
    const time = Date.now() / 1000;
    const blink = Math.sin(time * 8) * 0.3 + 0.7; // Parpadeo rápido
    
    // Color rojo con efecto de parpadeo
    graph.fillStyle = `rgba(255, 0, 0, ${blink})`;
    graph.strokeStyle = 'rgba(255, 0, 0, 0.8)';
    graph.lineWidth = 3;
    
    // Agregar efecto de brillo
    graph.shadowColor = 'rgba(255, 0, 0, 0.8)';
    graph.shadowBlur = 10;
    
    // Dibujar la bomba como un círculo
    drawRoundObject(position, bomb.radius, graph);
    
    // Restaurar sombra
    graph.shadowBlur = 0;
    
    // Agregar símbolo de bomba en el centro
    graph.fillStyle = 'white';
    graph.font = `${bomb.radius * 0.6}px Arial`;
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    graph.fillText('💣', position.x, position.y);
    
    // Agregar efecto de ondas de explosión
    const waveRadius = bomb.radius + Math.sin(time * 6) * 5;
    graph.strokeStyle = `rgba(255, 0, 0, ${0.3 * blink})`;
    graph.lineWidth = 1;
    graph.setLineDash([5, 5]);
    graph.beginPath();
    graph.arc(position.x, position.y, waveRadius, 0, 2 * Math.PI);
    graph.stroke();
    graph.setLineDash([]);
};

// Función para dibujar la brújula que apunta hacia células cercanas (ahora con detección extendida)
const drawCompass = (player, users, screen, graph, globalConfig) => {
    if (!player) return;
    
    // Configuración de la brújula
    const compassRadius = 60;
    const compassX = 80; // Posición en la esquina superior izquierda
    const compassY = 80;
    const arrowLength = 40;
    const arrowWidth = 8;
    const maxDetectionRange = 10000; // Rango muy extendido usando datos del radar
    
    // Usar datos del radar si están disponibles, sino usar datos visibles
    const radarData = globalConfig && globalConfig.radarData ? globalConfig.radarData : users;
    if (!radarData || radarData.length === 0) {
        console.log('[COMPASS_DEBUG] No hay datos de radar disponibles');
        return;
    }
    
    console.log('[COMPASS_DEBUG] Usando datos de radar con', radarData.length, 'jugadores');
    console.log('[COMPASS_DEBUG] Jugador actual en:', player.x, player.y);
    
    // Verificar si hay un objetivo de combate activo
    let bestCell = null;
    if (globalConfig && globalConfig.combatTarget && globalConfig.combatTarget.id) {
        const combatTarget = globalConfig.combatTarget;
        
        // Buscar al jugador objetivo en los datos del radar usando su ID
        let targetPlayer = null;
        if (radarData && radarData.length > 0) {
            targetPlayer = radarData.find(user => user.id === combatTarget.id);
        }
        
        if (targetPlayer && targetPlayer.cells && targetPlayer.cells.length > 0) {
            // Calcular la posición promedio de todas las células del jugador objetivo
            let totalX = 0;
            let totalY = 0;
            let cellCount = 0;
            
            for (let cell of targetPlayer.cells) {
                totalX += cell.x;
                totalY += cell.y;
                cellCount++;
            }
            
            const targetX = cellCount > 0 ? totalX / cellCount : 0;
            const targetY = cellCount > 0 ? totalY / cellCount : 0;
            const distance = Math.hypot(targetX - player.x, targetY - player.y);
            
            // Si el objetivo de combate está dentro del rango, priorizarlo
            if (distance <= maxDetectionRange && distance > 0) {
                bestCell = {
                    x: targetX,
                    y: targetY,
                    playerName: combatTarget.name,
                    distance: distance,
                    score: 999999, // Puntuación muy alta para priorizar
                    isCombatTarget: true // Marcar como objetivo de combate
                };
                console.log('[COMPASS_DEBUG] Objetivo de combate detectado en tiempo real:', combatTarget.name, 'en', targetX.toFixed(0), targetY.toFixed(0), 'distancia:', distance.toFixed(0));
            } else {
                console.log('[COMPASS_DEBUG] Objetivo de combate fuera de rango:', combatTarget.name, 'distancia:', distance.toFixed(0));
            }
        } else {
            console.log('[COMPASS_DEBUG] Objetivo de combate no encontrado en radar:', combatTarget.name, '(ID:', combatTarget.id + ')');
        }
    }
    
    // Si no hay objetivo de combate, encontrar la célula más importante
    if (!bestCell) {
        let bestScore = -Infinity;
        
        for (let user of radarData) {
            if (user.id === player.id) continue; // Saltar al propio jugador
            
            for (let cell of user.cells) {
                const distance = Math.hypot(cell.x - player.x, cell.y - player.y);
                
                // Solo considerar células dentro del rango extendido
                if (distance <= maxDetectionRange && distance > 0) {
                    // Calcular puntuación basada en distancia, masa y dinero
                    const moneyBonus = (cell.gameMoney || 0) * 3; // Más peso al dinero
                    const massBonus = cell.mass / 30;
                    const distancePenalty = distance / 2000; // Menos penalización por distancia
                    const score = moneyBonus + massBonus - distancePenalty;
                    
                    if (score > bestScore) {
                        bestScore = score;
                        bestCell = {
                            ...cell,
                            playerName: user.name,
                            playerHue: user.hue,
                            distance: distance,
                            score: score
                        };
                    }
                }
            }
        }
    }
    
    if (!bestCell) {
        console.log('[COMPASS_DEBUG] No se encontró ninguna célula importante');
        return; // No hay células detectadas
    }
    
    console.log('[COMPASS_DEBUG] Célula más importante:', bestCell.playerName, 'en', bestCell.x, bestCell.y, 'distancia:', bestCell.distance);
    
    // Calcular ángulo hacia la célula más importante
    const deltaX = bestCell.x - player.x;
    const deltaY = bestCell.y - player.y;
    const angle = Math.atan2(deltaY, deltaX);
    
    // Dibujar el círculo base de la brújula
    graph.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    graph.fillStyle = 'rgba(0, 0, 0, 0.7)';
    graph.lineWidth = 3;
    graph.beginPath();
    graph.arc(compassX, compassY, compassRadius, 0, 2 * Math.PI);
    graph.fill();
    graph.stroke();
    
    // Dibujar los puntos cardinales
    graph.fillStyle = 'rgba(255, 255, 255, 0.6)';
    graph.font = 'bold 12px sans-serif';
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    
    // Norte
    graph.fillText('N', compassX, compassY - compassRadius + 15);
    // Sur
    graph.fillText('S', compassX, compassY + compassRadius - 15);
    // Este
    graph.fillText('E', compassX + compassRadius - 15, compassY);
    // Oeste
    graph.fillText('W', compassX - compassRadius + 15, compassY);
    
    // Dibujar la flecha que apunta hacia la célula
    const arrowEndX = compassX + Math.cos(angle) * arrowLength;
    const arrowEndY = compassY + Math.sin(angle) * arrowLength;
    
    // Color de la flecha basado en las características de la célula
    let arrowColor;
    if (bestCell.isCombatTarget) {
        arrowColor = '#FF0000'; // Rojo intenso para objetivo de combate
    } else if (bestCell.gameMoney && bestCell.gameMoney > 0) {
        arrowColor = '#FFD700'; // Dorado para células con dinero
    } else if (bestCell.distance < 500) {
        arrowColor = '#FF4444'; // Rojo para células muy cercanas
    } else if (bestCell.distance < 1000) {
        arrowColor = '#FF8800'; // Naranja para células cercanas
    } else if (bestCell.mass > 200) {
        arrowColor = '#00AAFF'; // Azul para células grandes
    } else {
        arrowColor = '#44FF44'; // Verde para células lejanas
    }
    
    graph.strokeStyle = arrowColor;
    graph.fillStyle = arrowColor;
    graph.lineWidth = arrowWidth;
    
    // Dibujar la línea principal de la flecha
    graph.beginPath();
    graph.moveTo(compassX, compassY);
    graph.lineTo(arrowEndX, arrowEndY);
    graph.stroke();
    
    // Dibujar la punta de la flecha
    const arrowHeadLength = 12;
    const arrowHeadAngle = Math.PI / 6; // 30 grados
    
    graph.beginPath();
    graph.moveTo(arrowEndX, arrowEndY);
    graph.lineTo(
        arrowEndX - arrowHeadLength * Math.cos(angle - arrowHeadAngle),
        arrowEndY - arrowHeadLength * Math.sin(angle - arrowHeadAngle)
    );
    graph.moveTo(arrowEndX, arrowEndY);
    graph.lineTo(
        arrowEndX - arrowHeadLength * Math.cos(angle + arrowHeadAngle),
        arrowEndY - arrowHeadLength * Math.sin(angle + arrowHeadAngle)
    );
    graph.stroke();
    
    // Dibujar información de la célula objetivo
    const infoX = compassX;
    const infoY = compassY + compassRadius + 30;
    
    graph.fillStyle = 'rgba(0, 0, 0, 0.8)';
    graph.fillRect(infoX - 80, infoY - 25, 160, 50);
    
    graph.fillStyle = 'rgba(255, 255, 255, 0.9)';
    graph.font = 'bold 12px sans-serif';
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    
    // Nombre del jugador
    if (bestCell.isCombatTarget) {
        graph.fillStyle = '#FF0000';
        graph.font = 'bold 12px sans-serif';
        graph.fillText(`⚔️ ${bestCell.playerName}`, infoX, infoY - 8);
    } else {
        graph.fillText(bestCell.playerName, infoX, infoY - 8);
    }
    
    // Distancia
    const distanceText = `${Math.round(bestCell.distance)}px`;
    graph.font = '10px sans-serif';
    graph.fillText(distanceText, infoX, infoY + 8);
    
    // Indicador especial para objetivo de combate
    if (bestCell.isCombatTarget) {
        graph.fillStyle = '#FF0000';
        graph.font = 'bold 10px sans-serif';
        graph.fillText('OBJETIVO DE COMBATE', infoX, infoY + 22);
    } else if (bestCell.gameMoney && bestCell.gameMoney > 0) {
        // Mostrar dinero si está disponible
        graph.fillStyle = '#FFD700';
        graph.font = 'bold 10px sans-serif';
        graph.fillText(`$${bestCell.gameMoney}`, infoX, infoY + 22);
    } else if (bestCell.mass > 100) {
        graph.fillStyle = '#FFD700';
        graph.font = 'bold 10px sans-serif';
        graph.fillText(`${Math.round(bestCell.mass)}`, infoX, infoY + 22);
    }
    
    // Efecto pulsante para células muy cercanas, con dinero o objetivo de combate
    if (bestCell.isCombatTarget) {
        // Efecto pulsante intenso para objetivo de combate
        const pulse = Math.sin(Date.now() / 100) * 0.5 + 0.5;
        graph.strokeStyle = `rgba(255, 0, 0, ${pulse})`;
        graph.lineWidth = 4;
        graph.beginPath();
        graph.arc(compassX, compassY, compassRadius + 8, 0, 2 * Math.PI);
        graph.stroke();
        
        // Efecto adicional de brillo rojo
        graph.shadowColor = 'rgba(255, 0, 0, 0.8)';
        graph.shadowBlur = 15;
        graph.beginPath();
        graph.arc(compassX, compassY, compassRadius + 5, 0, 2 * Math.PI);
        graph.stroke();
        graph.shadowBlur = 0;
    } else if (bestCell.distance < 300 || (bestCell.gameMoney && bestCell.gameMoney > 50)) {
        const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
        const pulseColor = bestCell.gameMoney && bestCell.gameMoney > 50 ? 
            `rgba(255, 215, 0, ${pulse})` : `rgba(255, 68, 68, ${pulse})`;
        graph.strokeStyle = pulseColor;
        graph.lineWidth = 2;
        graph.beginPath();
        graph.arc(compassX, compassY, compassRadius + 5, 0, 2 * Math.PI);
        graph.stroke();
    }
};

// Función para dibujar una brújula avanzada que muestra múltiples células importantes
const drawAdvancedCompass = (player, users, screen, graph, globalConfig) => {
    if (!player) return;
    
    // Configuración de la brújula avanzada
    const compassRadius = 80;
    const compassX = screen.width - 100; // Posición en la esquina superior derecha
    const compassY = 120;
    const maxArrows = 5; // Aumentado para mostrar más células
    const maxDetectionRange = 15000; // Rango muy extendido
    
    // Usar datos del radar si están disponibles, sino usar datos visibles
    const radarData = globalConfig && globalConfig.radarData ? globalConfig.radarData : users;
    if (!radarData || radarData.length === 0) return;
    
    // Encontrar las células más importantes en todo el mapa
    let importantCells = [];
    
    for (let user of radarData) {
        if (user.id === player.id) continue; // Saltar al propio jugador
        
        for (let cell of user.cells) {
            const distance = Math.hypot(cell.x - player.x, cell.y - player.y);
            
            // Solo considerar células dentro del rango extendido
            if (distance <= maxDetectionRange && distance > 0) {
                // Fórmula de importancia mejorada que considera masa, distancia y dinero
                const moneyBonus = (cell.gameMoney || 0) * 4; // Más peso al dinero
                const massBonus = cell.mass / 50;
                const distanceBonus = 2000 / Math.max(distance, 1); // Bonus por proximidad
                const importance = massBonus + distanceBonus + moneyBonus;
                
                importantCells.push({
                    ...cell,
                    playerName: user.name,
                    playerHue: user.hue,
                    distance: distance,
                    importance: importance
                });
            }
        }
    }
    
    // Ordenar por importancia y tomar las más importantes
    importantCells.sort((a, b) => b.importance - a.importance);
    importantCells = importantCells.slice(0, maxArrows);
    
    if (importantCells.length === 0) return;
    
    // Dibujar el círculo base de la brújula
    graph.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    graph.fillStyle = 'rgba(0, 0, 0, 0.8)';
    graph.lineWidth = 3;
    graph.beginPath();
    graph.arc(compassX, compassY, compassRadius, 0, 2 * Math.PI);
    graph.fill();
    graph.stroke();
    
    // Dibujar los puntos cardinales
    graph.fillStyle = 'rgba(255, 255, 255, 0.7)';
    graph.font = 'bold 14px sans-serif';
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    
    // Norte
    graph.fillText('N', compassX, compassY - compassRadius + 18);
    // Sur
    graph.fillText('S', compassX, compassY + compassRadius - 18);
    // Este
    graph.fillText('E', compassX + compassRadius - 18, compassY);
    // Oeste
    graph.fillText('W', compassX - compassRadius + 18, compassY);
    
    // Dibujar flechas para cada célula importante
    importantCells.forEach((cell, index) => {
        const deltaX = cell.x - player.x;
        const deltaY = cell.y - player.y;
        const angle = Math.atan2(deltaY, deltaX);
        
        // Longitud de flecha basada en la importancia
        const arrowLength = 35 + (cell.importance / 10);
        const arrowWidth = 6 - index; // Flechas más gruesas para células más importantes
        
        // Color de la flecha basado en la distancia, masa y dinero
        let arrowColor;
        if (cell.gameMoney && cell.gameMoney > 0) {
            arrowColor = '#FFD700'; // Dorado para células con dinero
        } else if (cell.distance < 400) {
            arrowColor = '#FF4444'; // Rojo para células muy cercanas
        } else if (cell.distance < 800) {
            arrowColor = '#FF8800'; // Naranja para células cercanas
        } else if (cell.mass > 200) {
            arrowColor = '#00AAFF'; // Azul para células grandes
        } else {
            arrowColor = '#44FF44'; // Verde para células lejanas
        }
        
        const arrowEndX = compassX + Math.cos(angle) * arrowLength;
        const arrowEndY = compassY + Math.sin(angle) * arrowLength;
        
        graph.strokeStyle = arrowColor;
        graph.fillStyle = arrowColor;
        graph.lineWidth = arrowWidth;
        
        // Dibujar la línea principal de la flecha
        graph.beginPath();
        graph.moveTo(compassX, compassY);
        graph.lineTo(arrowEndX, arrowEndY);
        graph.stroke();
        
        // Dibujar la punta de la flecha
        const arrowHeadLength = 10;
        const arrowHeadAngle = Math.PI / 6;
        
        graph.beginPath();
        graph.moveTo(arrowEndX, arrowEndY);
        graph.lineTo(
            arrowEndX - arrowHeadLength * Math.cos(angle - arrowHeadAngle),
            arrowEndY - arrowHeadLength * Math.sin(angle - arrowHeadAngle)
        );
        graph.moveTo(arrowEndX, arrowEndY);
        graph.lineTo(
            arrowEndX - arrowHeadLength * Math.cos(angle + arrowHeadAngle),
            arrowEndY - arrowHeadLength * Math.sin(angle + arrowHeadAngle)
        );
        graph.stroke();
        
        // Agregar un pequeño indicador de masa o dinero en la punta de la flecha
        if (cell.gameMoney && cell.gameMoney > 0) {
            // Mostrar dinero si está disponible
            graph.fillStyle = 'rgba(0, 0, 0, 0.8)';
            graph.fillRect(arrowEndX - 20, arrowEndY - 8, 40, 16);
            graph.fillStyle = '#FFD700';
            graph.font = 'bold 10px sans-serif';
            graph.textAlign = 'center';
            graph.textBaseline = 'middle';
            graph.fillText(`$${cell.gameMoney}`, arrowEndX, arrowEndY);
        } else if (cell.mass > 150) {
            // Mostrar masa si no hay dinero
            graph.fillStyle = 'rgba(0, 0, 0, 0.8)';
            graph.fillRect(arrowEndX - 15, arrowEndY - 8, 30, 16);
            graph.fillStyle = '#FFD700';
            graph.font = 'bold 10px sans-serif';
            graph.textAlign = 'center';
            graph.textBaseline = 'middle';
            graph.fillText(`${Math.round(cell.mass)}`, arrowEndX, arrowEndY);
        }
    });
    
    // Dibujar información general en la parte inferior
    const infoX = compassX;
    const infoY = compassY + compassRadius + 40;
    
    graph.fillStyle = 'rgba(0, 0, 0, 0.8)';
    graph.fillRect(infoX - 90, infoY - 20, 180, 40);
    
    graph.fillStyle = 'rgba(255, 255, 255, 0.9)';
    graph.font = 'bold 12px sans-serif';
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    
    const closestCell = importantCells[0];
    graph.fillText(`${closestCell.playerName}`, infoX, infoY - 5);
    
    graph.font = '10px sans-serif';
    graph.fillText(`${Math.round(closestCell.distance)}px`, infoX, infoY + 8);
    
    // Mostrar dinero si está disponible
    if (closestCell.gameMoney && closestCell.gameMoney > 0) {
        graph.fillStyle = '#FFD700';
        graph.font = 'bold 10px sans-serif';
        graph.fillText(`$${closestCell.gameMoney}`, infoX, infoY + 22);
    }
    
    // Efecto pulsante para células muy cercanas o con mucho dinero
    const veryCloseCells = importantCells.filter(cell => cell.distance < 300);
    const richCells = importantCells.filter(cell => cell.gameMoney && cell.gameMoney > 50);
    
    if (richCells.length > 0) {
        // Efecto dorado pulsante para células con dinero
        const pulse = Math.sin(Date.now() / 200) * 0.5 + 0.5;
        graph.strokeStyle = `rgba(255, 215, 0, ${pulse})`;
        graph.lineWidth = 4;
        graph.beginPath();
        graph.arc(compassX, compassY, compassRadius + 10, 0, 2 * Math.PI);
        graph.stroke();
        
        // Efecto adicional de brillo
        graph.shadowColor = 'rgba(255, 215, 0, 0.8)';
        graph.shadowBlur = 15;
        graph.beginPath();
        graph.arc(compassX, compassY, compassRadius + 5, 0, 2 * Math.PI);
        graph.stroke();
        graph.shadowBlur = 0;
    } else if (veryCloseCells.length > 0) {
        // Efecto rojo pulsante para células muy cercanas
        const pulse = Math.sin(Date.now() / 150) * 0.4 + 0.6;
        graph.strokeStyle = `rgba(255, 68, 68, ${pulse})`;
        graph.lineWidth = 3;
        graph.beginPath();
        graph.arc(compassX, compassY, compassRadius + 8, 0, 2 * Math.PI);
        graph.stroke();
    }
};

// Función para dibujar una brújula de radar que detecta células a larga distancia
const drawRadarCompass = (player, users, screen, graph, globalConfig) => {
    console.log('[RADAR_COMPASS] Iniciando drawRadarCompass');
    if (!player || !users || users.length === 0) {
        console.log('[RADAR_COMPASS] Retornando - player:', !!player, 'users:', !!users, 'users.length:', users?.length);
        return;
    }
    
    // Configuración del radar
    const radarRadius = 100;
    const radarX = screen.width - 120; // Posición en la esquina superior derecha
    const radarY = 150;
    const maxDetectionRange = (globalConfig && globalConfig.radarRange) || 5000; // Rango máximo de detección configurable
    
    // Encontrar todas las células dentro del rango de radar
    let detectedCells = [];
    
    for (let user of users) {
        if (user.id === player.id) continue; // Saltar al propio jugador
        
        for (let cell of user.cells) {
            const distance = Math.hypot(cell.x - player.x, cell.y - player.y);
            
            // Solo incluir células dentro del rango de radar
            if (distance <= maxDetectionRange && distance > 0) {
                const importance = (cell.mass / 100) + (1000 / Math.max(distance, 1));
                const moneyBonus = (cell.gameMoney || 0) * 3; // El dinero tiene más peso en el radar
                
                detectedCells.push({
                    ...cell,
                    playerName: user.name,
                    playerHue: user.hue,
                    distance: distance,
                    importance: importance + moneyBonus
                });
            }
        }
    }
    
    console.log('[RADAR_COMPASS] Células detectadas:', detectedCells.length);
    if (detectedCells.length === 0) {
        console.log('[RADAR_COMPASS] No hay células detectadas, retornando');
        return;
    } // No hay células detectadas
    
    // Ordenar por importancia y tomar las más importantes
    detectedCells.sort((a, b) => b.importance - a.importance);
    const maxArrows = Math.min(detectedCells.length, 5); // Mostrar hasta 5 flechas
    const topCells = detectedCells.slice(0, maxArrows);
    
    // Dibujar el círculo base del radar
    graph.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    graph.fillStyle = 'rgba(0, 0, 0, 0.9)';
    graph.lineWidth = 3;
    graph.beginPath();
    graph.arc(radarX, radarY, radarRadius, 0, 2 * Math.PI);
    graph.fill();
    graph.stroke();
    
    // Dibujar círculos concéntricos para indicar rangos
    for (let i = 1; i <= 3; i++) {
        const radius = (radarRadius * i) / 3;
        graph.strokeStyle = `rgba(0, 255, 0, ${0.3 - i * 0.1})`;
        graph.lineWidth = 1;
        graph.beginPath();
        graph.arc(radarX, radarY, radius, 0, 2 * Math.PI);
        graph.stroke();
    }
    
    // Dibujar los puntos cardinales
    graph.fillStyle = 'rgba(0, 255, 0, 0.8)';
    graph.font = 'bold 14px sans-serif';
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    
    // Norte
    graph.fillText('N', radarX, radarY - radarRadius + 20);
    // Sur
    graph.fillText('S', radarX, radarY + radarRadius - 20);
    // Este
    graph.fillText('E', radarX + radarRadius - 20, radarY);
    // Oeste
    graph.fillText('W', radarX - radarRadius + 20, radarY);
    
    // Dibujar flechas para cada célula detectada
    topCells.forEach((cell, index) => {
        const deltaX = cell.x - player.x;
        const deltaY = cell.y - player.y;
        const angle = Math.atan2(deltaY, deltaX);
        
        // Longitud de flecha basada en la distancia (flechas más largas para células más lejanas)
        const normalizedDistance = cell.distance / maxDetectionRange;
        const arrowLength = 30 + (normalizedDistance * 50);
        const arrowWidth = 8 - index; // Flechas más gruesas para células más importantes
        
        // Color de la flecha basado en la distancia y características
        let arrowColor;
        if (cell.gameMoney && cell.gameMoney > 0) {
            arrowColor = '#FFD700'; // Dorado para células con dinero
        } else if (cell.distance < 1000) {
            arrowColor = '#FF4444'; // Rojo para células cercanas
        } else if (cell.distance < 2000) {
            arrowColor = '#FF8800'; // Naranja para células medianas
        } else if (cell.mass > 300) {
            arrowColor = '#00AAFF'; // Azul para células grandes
        } else {
            arrowColor = '#44FF44'; // Verde para células lejanas
        }
        
        const arrowEndX = radarX + Math.cos(angle) * arrowLength;
        const arrowEndY = radarY + Math.sin(angle) * arrowLength;
        
        graph.strokeStyle = arrowColor;
        graph.fillStyle = arrowColor;
        graph.lineWidth = arrowWidth;
        
        // Dibujar la línea principal de la flecha
        graph.beginPath();
        graph.moveTo(radarX, radarY);
        graph.lineTo(arrowEndX, arrowEndY);
        graph.stroke();
        
        // Dibujar la punta de la flecha
        const arrowHeadLength = 12;
        const arrowHeadAngle = Math.PI / 6;
        
        graph.beginPath();
        graph.moveTo(arrowEndX, arrowEndY);
        graph.lineTo(
            arrowEndX - arrowHeadLength * Math.cos(angle - arrowHeadAngle),
            arrowEndY - arrowHeadLength * Math.sin(angle - arrowHeadAngle)
        );
        graph.moveTo(arrowEndX, arrowEndY);
        graph.lineTo(
            arrowEndX - arrowHeadLength * Math.cos(angle + arrowHeadAngle),
            arrowEndY - arrowHeadLength * Math.sin(angle + arrowHeadAngle)
        );
        graph.stroke();
        
        // Agregar indicador de información en la punta de la flecha
        if (cell.gameMoney && cell.gameMoney > 0) {
            // Mostrar dinero
            graph.fillStyle = 'rgba(0, 0, 0, 0.9)';
            graph.fillRect(arrowEndX - 25, arrowEndY - 10, 50, 20);
            graph.fillStyle = '#FFD700';
            graph.font = 'bold 10px sans-serif';
            graph.textAlign = 'center';
            graph.textBaseline = 'middle';
            graph.fillText(`$${cell.gameMoney}`, arrowEndX, arrowEndY);
        } else if (cell.mass > 200) {
            // Mostrar masa
            graph.fillStyle = 'rgba(0, 0, 0, 0.9)';
            graph.fillRect(arrowEndX - 20, arrowEndY - 10, 40, 20);
            graph.fillStyle = '#FFD700';
            graph.font = 'bold 10px sans-serif';
            graph.textAlign = 'center';
            graph.textBaseline = 'middle';
            graph.fillText(`${Math.round(cell.mass)}`, arrowEndX, arrowEndY);
        }
        
        // Agregar indicador de distancia en la base de la flecha
        const distanceText = `${Math.round(cell.distance)}px`;
        graph.fillStyle = 'rgba(0, 0, 0, 0.8)';
        graph.fillRect(arrowEndX - 30, arrowEndY + 5, 60, 15);
        graph.fillStyle = 'white';
        graph.font = '9px sans-serif';
        graph.textAlign = 'center';
        graph.textBaseline = 'middle';
        graph.fillText(distanceText, arrowEndX, arrowEndY + 12);
    });
    
    // Dibujar información del radar en la parte inferior
    const infoX = radarX;
    const infoY = radarY + radarRadius + 50;
    
    graph.fillStyle = 'rgba(0, 0, 0, 0.9)';
    graph.fillRect(infoX - 100, infoY - 25, 200, 50);
    
    graph.fillStyle = 'rgba(0, 255, 0, 0.9)';
    graph.font = 'bold 12px sans-serif';
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    
    graph.fillText('RADAR ACTIVO', infoX, infoY - 8);
    
    const closestCell = topCells[0];
    graph.fillStyle = 'rgba(255, 255, 255, 0.9)';
    graph.font = '10px sans-serif';
    graph.fillText(`${closestCell.playerName} - ${Math.round(closestCell.distance)}px`, infoX, infoY + 8);
    
    // Mostrar rango de detección
    graph.fillStyle = 'rgba(0, 255, 0, 0.7)';
    graph.font = '9px sans-serif';
    graph.fillText(`Rango: ${maxDetectionRange/1000}km`, infoX, infoY + 22);
    
    // Mostrar instrucciones de ajuste
    graph.fillStyle = 'rgba(255, 255, 255, 0.6)';
    graph.font = '8px sans-serif';
    graph.fillText(`+/- para ajustar rango`, infoX, infoY + 35);
    
    // Efecto de escaneo del radar
    const scanAngle = (Date.now() / 100) % (2 * Math.PI);
    graph.strokeStyle = 'rgba(0, 255, 0, 0.6)';
    graph.lineWidth = 2;
    graph.beginPath();
    graph.moveTo(radarX, radarY);
    graph.lineTo(
        radarX + Math.cos(scanAngle) * radarRadius,
        radarY + Math.sin(scanAngle) * radarRadius
    );
    graph.stroke();
    
    // Efecto pulsante para células con mucho dinero
    const richCells = topCells.filter(cell => cell.gameMoney && cell.gameMoney > 100);
    if (richCells.length > 0) {
        const pulse = Math.sin(Date.now() / 300) * 0.6 + 0.4;
        graph.strokeStyle = `rgba(255, 215, 0, ${pulse})`;
        graph.lineWidth = 4;
        graph.beginPath();
        graph.arc(radarX, radarY, radarRadius + 12, 0, 2 * Math.PI);
        graph.stroke();
        
        // Efecto de brillo dorado
        graph.shadowColor = 'rgba(255, 215, 0, 0.8)';
        graph.shadowBlur = 20;
        graph.beginPath();
        graph.arc(radarX, radarY, radarRadius + 8, 0, 2 * Math.PI);
        graph.stroke();
        graph.shadowBlur = 0;
    }
};

// Función para dibujar un radar de segundo plano que siempre detecta células
const drawBackgroundRadar = (player, users, screen, graph, globalConfig) => {
    if (!player) return;
    
    // Configuración del radar de fondo
    const radarRadius = 40;
    const radarX = 60; // Posición en la esquina superior izquierda
    const radarY = 60;
    const maxDetectionRange = 20000; // Rango muy amplio usando datos del radar
    
    // Usar datos del radar si están disponibles, sino usar datos visibles
    const radarData = globalConfig && globalConfig.radarData ? globalConfig.radarData : users;
    if (!radarData || radarData.length === 0) return;
    
    // Encontrar la célula más valiosa en todo el mapa
    let mostValuableCell = null;
    let bestValue = -Infinity;
    
    for (let user of radarData) {
        if (user.id === player.id) continue;
        
        for (let cell of user.cells) {
            const distance = Math.hypot(cell.x - player.x, cell.y - player.y);
            
            if (distance <= maxDetectionRange && distance > 0) {
                // Calcular valor basado en dinero, masa y distancia
                const moneyValue = (cell.gameMoney || 0) * 8; // Más peso al dinero
                const massValue = cell.mass / 15;
                const distanceValue = 2000 / Math.max(distance, 1);
                const totalValue = moneyValue + massValue + distanceValue;
                
                if (totalValue > bestValue) {
                    bestValue = totalValue;
                    mostValuableCell = {
                        ...cell,
                        playerName: user.name,
                        distance: distance,
                        value: totalValue
                    };
                }
            }
        }
    }
    
    if (!mostValuableCell) return;
    
    // Dibujar radar de fondo pequeño
    graph.strokeStyle = 'rgba(0, 255, 255, 0.6)';
    graph.fillStyle = 'rgba(0, 0, 0, 0.5)';
    graph.lineWidth = 2;
    graph.beginPath();
    graph.arc(radarX, radarY, radarRadius, 0, 2 * Math.PI);
    graph.fill();
    graph.stroke();
    
    // Efecto de escaneo
    const scanAngle = (Date.now() / 150) % (2 * Math.PI);
    graph.strokeStyle = 'rgba(0, 255, 255, 0.8)';
    graph.lineWidth = 1;
    graph.beginPath();
    graph.moveTo(radarX, radarY);
    graph.lineTo(
        radarX + Math.cos(scanAngle) * radarRadius,
        radarY + Math.sin(scanAngle) * radarRadius
    );
    graph.stroke();
    
    // Calcular ángulo hacia la célula más valiosa
    const deltaX = mostValuableCell.x - player.x;
    const deltaY = mostValuableCell.y - player.y;
    const angle = Math.atan2(deltaY, deltaX);
    
    // Dibujar flecha pequeña
    const arrowLength = 25;
    const arrowEndX = radarX + Math.cos(angle) * arrowLength;
    const arrowEndY = radarY + Math.sin(angle) * arrowLength;
    
    // Color basado en el valor
    let arrowColor;
    if (mostValuableCell.gameMoney && mostValuableCell.gameMoney > 0) {
        arrowColor = '#FFD700';
    } else if (mostValuableCell.distance < 1000) {
        arrowColor = '#FF4444';
    } else {
        arrowColor = '#00FFFF';
    }
    
    graph.strokeStyle = arrowColor;
    graph.lineWidth = 3;
    graph.beginPath();
    graph.moveTo(radarX, radarY);
    graph.lineTo(arrowEndX, arrowEndY);
    graph.stroke();
    
    // Indicador de valor
    if (mostValuableCell.gameMoney && mostValuableCell.gameMoney > 0) {
        graph.fillStyle = 'rgba(0, 0, 0, 0.8)';
        graph.fillRect(radarX - 20, radarY + 15, 40, 15);
        graph.fillStyle = '#FFD700';
        graph.font = 'bold 9px sans-serif';
        graph.textAlign = 'center';
        graph.textBaseline = 'middle';
        graph.fillText(`$${mostValuableCell.gameMoney}`, radarX, radarY + 22);
    }
    
    // Efecto pulsante si es muy valiosa
    if (mostValuableCell.gameMoney && mostValuableCell.gameMoney > 100) {
        const pulse = Math.sin(Date.now() / 200) * 0.5 + 0.5;
        graph.strokeStyle = `rgba(255, 215, 0, ${pulse})`;
        graph.lineWidth = 2;
        graph.beginPath();
        graph.arc(radarX, radarY, radarRadius + 3, 0, 2 * Math.PI);
        graph.stroke();
    }
};

// Función simplificada para probar la detección de células lejanas
const drawSimpleRadarCompass = (player, screen, graph, globalConfig) => {
    // Configuración simple
    const compassX = screen.width - 100;
    const compassY = 100;
    const compassRadius = 50;
    
    // Verificar si hay datos disponibles
    if (!player) return;
    if (!globalConfig) return;
    if (!globalConfig.radarData) return;
    
    const radarData = globalConfig.radarData;
    console.log('[SIMPLE_RADAR] ✅ Datos disponibles:', radarData.length, 'jugadores');
    
    // Dibujar indicador de estado
    graph.fillStyle = 'rgba(0, 0, 0, 0.8)';
    graph.fillRect(compassX - 80, compassY - 30, 160, 60);
    
    graph.fillStyle = 'rgba(255, 255, 255, 0.9)';
    graph.font = 'bold 12px sans-serif';
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    graph.fillText(`Radar: ${radarData.length} jugadores`, compassX, compassY - 10);
    
    // Encontrar cualquier célula que no sea del jugador actual
    let targetCell = null;
    let otherPlayersCount = 0;
    
    for (let user of radarData) {
        if (user.id === player.id) continue;
        
        otherPlayersCount++;
        console.log(`[SIMPLE_RADAR] Jugador ${user.name} en (${user.x}, ${user.y}) con ${user.cells.length} células`);
        
        for (let cell of user.cells) {
            const distance = Math.hypot(cell.x - player.x, cell.y - player.y);
            console.log(`[SIMPLE_RADAR] Célula de ${user.name} en (${cell.x}, ${cell.y}) - Distancia: ${distance}`);
            
            if (distance > 0) {
                targetCell = {
                    ...cell,
                    playerName: user.name,
                    distance: distance
                };
                break;
            }
        }
        if (targetCell) break;
    }
    
    graph.fillText(`Otros: ${otherPlayersCount}`, compassX, compassY + 10);
    
    if (!targetCell) {
        graph.fillStyle = '#FF4444';
        graph.fillText('No hay objetivos', compassX, compassY + 30);
        console.log('[SIMPLE_RADAR] No se encontró ninguna célula objetivo');
        return;
    }
    
    console.log('[SIMPLE_RADAR] Célula objetivo encontrada:', targetCell.playerName, 'en', targetCell.x, targetCell.y);
    
    // Dibujar brújula simple
    graph.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    graph.fillStyle = 'rgba(0, 0, 0, 0.7)';
    graph.lineWidth = 3;
    graph.beginPath();
    graph.arc(compassX, compassY + 80, compassRadius, 0, 2 * Math.PI);
    graph.fill();
    graph.stroke();
    
    // Calcular ángulo
    const deltaX = targetCell.x - player.x;
    const deltaY = targetCell.y - player.y;
    const angle = Math.atan2(deltaY, deltaX);
    
    // Dibujar flecha
    const arrowLength = 35;
    const arrowEndX = compassX + Math.cos(angle) * arrowLength;
    const arrowEndY = (compassY + 80) + Math.sin(angle) * arrowLength;
    
    graph.strokeStyle = '#FF4444';
    graph.lineWidth = 5;
    graph.beginPath();
    graph.moveTo(compassX, compassY + 80);
    graph.lineTo(arrowEndX, arrowEndY);
    graph.stroke();
    
    // Información
    graph.fillStyle = 'rgba(0, 0, 0, 0.8)';
    graph.fillRect(compassX - 60, compassY + 130, 120, 40);
    
    graph.fillStyle = 'rgba(255, 255, 255, 0.9)';
    graph.font = 'bold 10px sans-serif';
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    graph.fillText(targetCell.playerName, compassX, compassY + 145);
    graph.fillText(`${Math.round(targetCell.distance)}px`, compassX, compassY + 160);
    
    console.log('[SIMPLE_RADAR] Brújula dibujada hacia', targetCell.playerName);
};

// Función para dibujar el ping de latencia
const drawPing = (ping, screen, graph) => {
    if (!ping || ping <= 0) return;
    
    // Posición en la esquina superior derecha
    const x = screen.width - 80;
    const y = 30;
    
    // Color basado en la latencia
    let color;
    if (ping < 50) {
        color = '#00FF00'; // Verde - excelente
    } else if (ping < 100) {
        color = '#FFFF00'; // Amarillo - bueno
    } else if (ping < 200) {
        color = '#FFA500'; // Naranja - regular
    } else {
        color = '#FF0000'; // Rojo - malo
    }
    
    // Fondo semi-transparente
    graph.fillStyle = 'rgba(0, 0, 0, 0.7)';
    graph.fillRect(x - 10, y - 15, 70, 30);
    
    // Borde
    graph.strokeStyle = color;
    graph.lineWidth = 2;
    graph.strokeRect(x - 10, y - 15, 70, 30);
    
    // Texto del ping
    graph.fillStyle = color;
    graph.font = 'bold 14px Arial';
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    graph.fillText(`${ping}ms`, x + 25, y);
    
    // Indicador de calidad
    const quality = ping < 50 ? 'Excelente' : ping < 100 ? 'Bueno' : ping < 200 ? 'Regular' : 'Malo';
    graph.font = '10px Arial';
    graph.fillText(quality, x + 25, y + 15);
};

module.exports = {
    drawFood,
    drawPowerFood,
    drawVirus,
    drawFireFood,
    drawCells,
    drawErrorMessage,
    drawGrid,
    drawBorder,
    drawRedZone,
    drawCashOutProgress,
    drawBomb,
    drawCompass,
    drawAdvancedCompass,
    drawRadarCompass,
    drawBackgroundRadar,
    drawSimpleRadarCompass,
    drawPing
};