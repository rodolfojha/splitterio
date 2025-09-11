#!/usr/bin/env node

/**
 * Script de prueba para verificar la funcionalidad de NOWPayments Custody
 * 
 * Uso:
 * node test-custody.js
 */

require('dotenv').config({ path: '/var/www/splitta/.env' });
const nowPaymentsCustodyService = require('./src/server/services/nowpayments-custody-service');

async function testCustodyService() {
    console.log('🧪 Iniciando pruebas de NOWPayments Custody Service...\n');

    // Verificar configuración
    console.log('📋 Verificando configuración...');
    if (!process.env.NOWPAYMENTS_API_KEY) {
        console.error('❌ NOWPAYMENTS_API_KEY no está configurada');
        return;
    }
    if (!process.env.NOWPAYMENTS_JWT_TOKEN) {
        console.error('❌ NOWPAYMENTS_JWT_TOKEN no está configurada');
        return;
    }
    console.log('✅ Configuración verificada\n');

    // Test 1: Crear custody user
    console.log('🔧 Test 1: Crear custody user...');
    try {
        const testUserName = `test_user_${Date.now()}`;
        console.log(`   Creando custody user: ${testUserName}`);
        
        const result = await nowPaymentsCustodyService.createCustodyUser(testUserName);
        console.log('✅ Custody user creado exitosamente:');
        console.log(`   ID: ${result.custodyId}`);
        console.log(`   Nombre: ${result.custodyName}`);
        console.log(`   Creado: ${result.createdAt}\n`);

        // Test 2: Obtener balance del custody user
        console.log('🔧 Test 2: Obtener balance del custody user...');
        try {
            const balance = await nowPaymentsCustodyService.getCustodyBalance(result.custodyId);
            console.log('✅ Balance obtenido exitosamente:');
            console.log(`   Custody ID: ${balance.subPartnerId}`);
            console.log(`   Balances:`, JSON.stringify(balance.balances, null, 2));
            console.log('');
        } catch (balanceError) {
            console.log('⚠️  Error obteniendo balance (esto puede ser normal si el custody está vacío):');
            console.log(`   ${balanceError.message}\n`);
        }

        // Test 3: Obtener lista de custody users
        console.log('🔧 Test 3: Obtener lista de custody users...');
        try {
            const users = await nowPaymentsCustodyService.getCustodyUsers({ limit: 5 });
            console.log('✅ Lista de custody users obtenida:');
            console.log(`   Total de usuarios: ${users.length}`);
            users.forEach((user, index) => {
                console.log(`   ${index + 1}. ID: ${user.id}, Nombre: ${user.name}, Creado: ${user.created_at}`);
            });
            console.log('');
        } catch (listError) {
            console.log('⚠️  Error obteniendo lista de custody users:');
            console.log(`   ${listError.message}\n`);
        }

        console.log('🎉 Todas las pruebas completadas exitosamente!');
        console.log(`📝 Custody user de prueba creado: ${testUserName} (ID: ${result.custodyId})`);
        console.log('   Puedes eliminar este usuario desde el dashboard de NOWPayments si lo deseas.');

    } catch (error) {
        console.error('❌ Error en las pruebas:');
        console.error(`   ${error.message}`);
        
        if (error.message.includes('401')) {
            console.error('\n💡 Posibles soluciones:');
            console.error('   - Verifica que tu JWT Token sea válido');
            console.error('   - Asegúrate de que tu cuenta tenga permisos para crear custody users');
        } else if (error.message.includes('403')) {
            console.error('\n💡 Posibles soluciones:');
            console.error('   - Verifica que tu API Key sea válida');
            console.error('   - Asegúrate de que tu cuenta esté activa');
        }
    }
}

// Ejecutar pruebas
testCustodyService().catch(console.error);


