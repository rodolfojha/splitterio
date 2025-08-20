const FULL_ANGLE = 2 * Math.PI;

const drawRoundObject = (position, radius, graph) => {
    graph.beginPath();
    graph.arc(position.x, position.y, radius, 0, FULL_ANGLE);
    graph.closePath();
    graph.fill();
    graph.stroke();
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
            // Border corrections are not needed, the cell can be drawn as a circle
            drawRoundObject(cell, cell.radius, graph);
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
    
    // Crear gradiente para la zona roja
    const gradient = graph.createRadialGradient(zoneCenterX, zoneCenterY, 0, zoneCenterX, zoneCenterY, redZone.radius);
    gradient.addColorStop(0, 'rgba(255, 0, 0, 0.1)');
    gradient.addColorStop(0.7, 'rgba(255, 0, 0, 0.3)');
    gradient.addColorStop(1, 'rgba(255, 0, 0, 0.6)');
    
    // Dibujar el área de la zona roja (todo lo que está fuera del círculo)
    graph.fillStyle = gradient;
    graph.fillRect(0, 0, screen.width, screen.height);
    
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
    drawBomb
};