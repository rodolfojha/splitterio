const { BotManager } = require('./src/server/bot-manager');

const botManager = new BotManager();

console.log('🤖 Iniciando bots simples...');

// Función para agregar bots gradualmente
function addBotsGradually(count, delay = 2000) {
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

// Agregar bots gradualmente (3 bots cada 2 segundos)
addBotsGradually(6, 2000);

// Mostrar estado cada 10 segundos
setInterval(() => {
    const aliveBots = botManager.getAliveBots();
    const connectedBots = botManager.getConnectedBots();
    console.log(`📈 Estado: ${connectedBots.length} conectados, ${aliveBots.length} vivos`);
    
    if (aliveBots.length > 0) {
        console.log(`   Bots activos: ${aliveBots.map(bot => bot.name).join(', ')}`);
    }
}, 10000);

// Manejar cierre
process.on('SIGINT', () => {
    console.log('\n👋 Desconectando bots...');
    botManager.disconnectAllBots();
    process.exit(0);
});

console.log('🛑 Presiona Ctrl+C para detener los bots');
