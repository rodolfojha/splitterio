#!/usr/bin/env node

const { BotManager } = require('./src/server/bot-manager');
const readline = require('readline');

const botManager = new BotManager();
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('🤖 Controlador de Bots para Agar.io Clone');
console.log('==========================================');
console.log('Comandos disponibles:');
console.log('  add <número>     - Agregar N bots');
console.log('  remove <número>  - Remover N bots');
console.log('  list             - Mostrar bots conectados');
console.log('  clear            - Remover todos los bots');
console.log('  status           - Estado de la zona roja');
console.log('  help             - Mostrar esta ayuda');
console.log('  exit             - Salir');
console.log('');

function showPrompt() {
    rl.question('🤖 Bot Controller > ', (input) => {
        const args = input.trim().split(' ');
        const command = args[0].toLowerCase();
        const number = parseInt(args[1]) || 1;

        switch (command) {
            case 'add':
                if (number > 0 && number <= 20) {
                    console.log(`🟢 Agregando ${number} bot(s)...`);
                    for (let i = 0; i < number; i++) {
                        const bot = botManager.createBot();
                        botManager.connectBot(bot);
                    }
                    console.log(`✅ ${number} bot(s) agregado(s)`);
                } else {
                    console.log('❌ Número inválido. Debe ser entre 1 y 20');
                }
                break;

            case 'remove':
                if (number > 0 && number <= botManager.bots.length) {
                    console.log(`🔴 Removiendo ${number} bot(s)...`);
                    const botsToRemove = botManager.bots.slice(-number);
                    botsToRemove.forEach(bot => botManager.disconnectBot(bot));
                    console.log(`✅ ${number} bot(s) removido(s)`);
                } else {
                    console.log(`❌ Número inválido. Hay ${botManager.bots.length} bots disponibles`);
                }
                break;

            case 'list':
                const connectedBots = botManager.getConnectedBots();
                const aliveBots = botManager.getAliveBots();
                console.log(`📊 Estado de los bots:`);
                console.log(`   Total: ${botManager.bots.length}`);
                console.log(`   Conectados: ${connectedBots.length}`);
                console.log(`   Vivos: ${aliveBots.length}`);
                if (connectedBots.length > 0) {
                    console.log(`   Nombres: ${connectedBots.map(bot => bot.name).join(', ')}`);
                }
                break;

            case 'clear':
                console.log('🗑️ Removiendo todos los bots...');
                botManager.disconnectAllBots();
                console.log('✅ Todos los bots removidos');
                break;

            case 'status':
                const totalPlayers = botManager.getAliveBots().length + 1; // +1 por el jugador real
                console.log(`🎮 Estado del juego:`);
                console.log(`   Jugadores totales: ${totalPlayers}`);
                console.log(`   Bots vivos: ${botManager.getAliveBots().length}`);
                
                // Calcular zona roja esperada
                let expectedRadius;
                if (totalPlayers <= 1) {
                    expectedRadius = '15% del mapa (zona pequeña)';
                } else if (totalPlayers <= 3) {
                    expectedRadius = '30% del mapa (zona media)';
                } else {
                    expectedRadius = '30%+ del mapa (zona expandida)';
                }
                console.log(`   Zona roja esperada: ${expectedRadius}`);
                break;

            case 'help':
                console.log('🤖 Comandos disponibles:');
                console.log('  add <número>     - Agregar N bots');
                console.log('  remove <número>  - Remover N bots');
                console.log('  list             - Mostrar bots conectados');
                console.log('  clear            - Remover todos los bots');
                console.log('  status           - Estado de la zona roja');
                console.log('  help             - Mostrar esta ayuda');
                console.log('  exit             - Salir');
                break;

            case 'exit':
                console.log('👋 Desconectando bots y saliendo...');
                botManager.disconnectAllBots();
                rl.close();
                process.exit(0);
                break;

            default:
                console.log('❌ Comando no reconocido. Escribe "help" para ver los comandos disponibles.');
                break;
        }

        console.log('');
        showPrompt();
    });
}

// Manejar cierre del programa
process.on('SIGINT', () => {
    console.log('\n👋 Desconectando bots y saliendo...');
    botManager.disconnectAllBots();
    rl.close();
    process.exit(0);
});

// Iniciar el prompt
showPrompt();
