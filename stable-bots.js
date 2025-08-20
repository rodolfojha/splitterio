const { BotManager } = require('./src/server/bot-manager');

const botManager = new BotManager();

console.log('🤖 Iniciando bots estables...');

// Función para agregar bots gradualmente con mejor control
function addBotsGradually(count, delay = 3000) {
    let added = 0;
    
    const interval = setInterval(() => {
        if (added < count) {
            const bot = botManager.createBot();
            botManager.connectBot(bot);
            console.log(`✅ Bot ${bot.name} agregado (${added + 1}/${count})`);
            added++;
        } else {
            clearInterval(interval);
            console.log('\n🎮 Todos los bots agregados!');
            console.log('📊 Observa cómo la zona roja se expande con más jugadores.');
        }
    }, delay);
}

// Agregar solo 3 bots para empezar
addBotsGradually(3, 3000);

// Mostrar estado cada 15 segundos
setInterval(() => {
    const aliveBots = botManager.getAliveBots();
    const connectedBots = botManager.getConnectedBots();
    console.log(`📈 Estado: ${connectedBots.length} conectados, ${aliveBots.length} vivos`);
    
    if (aliveBots.length > 0) {
        console.log(`   Bots activos: ${aliveBots.map(bot => bot.name).join(', ')}`);
    }
    
    // Mostrar zona roja esperada
    const totalPlayers = aliveBots.length + 1; // +1 por el jugador real
    let expectedRadius;
    if (totalPlayers <= 1) {
        expectedRadius = '15% del mapa (zona pequeña)';
    } else if (totalPlayers <= 3) {
        expectedRadius = '30% del mapa (zona media)';
    } else {
        expectedRadius = '30%+ del mapa (zona expandida)';
    }
    console.log(`   Zona roja esperada: ${expectedRadius}`);
}, 15000);

// Manejar cierre
process.on('SIGINT', () => {
    console.log('\n👋 Desconectando bots...');
    botManager.disconnectAllBots();
    process.exit(0);
});

console.log('🛑 Presiona Ctrl+C para detener los bots');
console.log('💡 Los bots ahora deberían mantenerse conectados más tiempo');
