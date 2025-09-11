const { IndependentBotManager } = require('./src/server/map/independent-bot');
const config = require('./config');

console.log('🧪 Probando sistema de bots independientes...');

// Configuración de prueba
const testConfig = {
    botCount: 5,
    botSpeed: 2.0,
    botSize: 15,
    botColor: "#00ff00",
    initialMass: 20,
    respawnDelay: 10000,
    maxBots: 15,
    minBots: 3
};

// Crear el gestor de bots
const botManager = new IndependentBotManager(testConfig);

// Activar el sistema
botManager.activate(7000, 7000);

console.log(`✅ Sistema activado con ${botManager.getBotCount()} bots`);

// Función async para simular updates
async function simulateUpdates() {
    for (let i = 0; i < 10; i++) {
        console.log(`\n🔄 Update ${i + 1}:`);
        
        // Simular datos del juego
        const visibleFood = [
            { x: 100, y: 100, mass: 1 },
            { x: 200, y: 200, mass: 1 },
            { x: 300, y: 300, mass: 1 }
        ];
        
        const visiblePlayers = [
            { x: 500, y: 500, mass: 50, name: "TestPlayer" }
        ];
        
        const visibleViruses = [];
        
        // Actualizar bots
        botManager.update(7000, 7000, visibleFood, visiblePlayers, visibleViruses);
        
        // Mostrar estado de los bots
        const bots = botManager.getBots();
        console.log(`📊 Bots activos: ${bots.length}`);
        
        bots.forEach((bot, index) => {
            console.log(`  Bot ${index + 1}: ${bot.name} - Pos: (${Math.round(bot.x)}, ${Math.round(bot.y)}) - Masa: ${Math.round(bot.mass)}`);
        });
        
        // Simular delay
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

// Ejecutar la simulación
simulateUpdates().then(() => {
    // Probar agregar un bot específico
    console.log('\n➕ Agregando bot específico...');
    const newBot = botManager.addBot(1000, 1000, "TestBot");
    console.log(`✅ Bot agregado: ${newBot.name} en (${newBot.x}, ${newBot.y})`);

    // Probar remover un bot
    console.log('\n➖ Removiendo bot...');
    const removedBot = botManager.removeBot(newBot.id);
    if (removedBot) {
        console.log(`✅ Bot removido: ${removedBot.name}`);
    } else {
        console.log('❌ No se pudo remover el bot');
    }

    // Desactivar el sistema
    console.log('\n🛑 Desactivando sistema...');
    botManager.deactivate();
    console.log('✅ Sistema desactivado');

    console.log('\n🎉 Prueba completada exitosamente!');
});

// Probar agregar un bot específico
console.log('\n➕ Agregando bot específico...');
const newBot = botManager.addBot(1000, 1000, "TestBot");
console.log(`✅ Bot agregado: ${newBot.name} en (${newBot.x}, ${newBot.y})`);

// Probar remover un bot
console.log('\n➖ Removiendo bot...');
const removedBot = botManager.removeBot(newBot.id);
if (removedBot) {
    console.log(`✅ Bot removido: ${removedBot.name}`);
} else {
    console.log('❌ No se pudo remover el bot');
}

// Desactivar el sistema
console.log('\n🛑 Desactivando sistema...');
botManager.deactivate();
console.log('✅ Sistema desactivado');

console.log('\n🎉 Prueba completada exitosamente!');
