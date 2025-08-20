const { BotManager } = require('./src/server/bot-manager');

const botManager = new BotManager();

console.log('🤖 Agregando bots de prueba...');

// Agregar 5 bots para probar la zona roja
for (let i = 0; i < 5; i++) {
    const bot = botManager.createBot();
    botManager.connectBot(bot);
    console.log(`✅ Bot ${bot.name} creado`);
}

console.log('\n🎮 Bots agregados! Ahora puedes ver cómo la zona roja se expande.');
console.log('📊 Para ver el estado, ejecuta: node bot-controller.js');
console.log('🛑 Para detener los bots, presiona Ctrl+C');

// Mantener el proceso vivo
setInterval(() => {
    const aliveBots = botManager.getAliveBots();
    console.log(`📈 Bots vivos: ${aliveBots.length}`);
}, 10000);

// Manejar cierre
process.on('SIGINT', () => {
    console.log('\n👋 Desconectando bots...');
    botManager.disconnectAllBots();
    process.exit(0);
});
