#!/usr/bin/env node

/**
 * Script para crear custody en NOWPayments para todos los usuarios existentes
 * que no tienen custody_id
 * 
 * Uso:
 * node create-custody-for-existing-users.js
 */

require('dotenv').config({ path: '/var/www/splitta/.env' });
const db = require('./src/server/sql');
const tokenStore = require('./src/server/tokenStore');

// Función para refrescar token
async function refreshToken() {
    try {
        const response = await fetch("https://api.nowpayments.io/v1/auth", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: process.env.NOWPAYMENTS_EMAIL,
                password: process.env.NOWPAYMENTS_PASSWORD
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log("✅ Token recibido:", data.token);

        // Guardamos el token en memoria con expiración de 280 segundos
        const EXPIRATION_SECONDS = 280;
        tokenStore.setToken(data.token, EXPIRATION_SECONDS);
        console.log(`✅ Token renovado y válido por ${EXPIRATION_SECONDS} segundos`);

        return data.token;

    } catch (error) {
        console.error("❌ Error al renovar token:", error.message);
        return null;
    }
}

// Función que siempre devuelve un token válido
async function getValidToken() {
    if (!tokenStore.getToken() || tokenStore.isExpired()) {
        return await refreshToken();
    }
    return tokenStore.getToken();
}

// Función para crear custody user usando el token automático
async function createCustodyUser(userName) {
    try {
        console.log(`[NOWPAYMENTS_CUSTODY] Creando custody user para: ${userName}`);

        // Obtener token automáticamente
        const jwtToken = await getValidToken();
        if (!jwtToken) {
            throw new Error('No se pudo obtener token de NOWPayments');
        }

        // Validar que el nombre no sea un email y no exceda 30 caracteres
        if (userName.includes('@')) {
            throw new Error('El nombre del custody no puede ser un email');
        }

        if (userName.length > 30) {
            throw new Error('El nombre del custody no puede exceder 30 caracteres');
        }

        const response = await fetch('https://api.nowpayments.io/v1/sub-partner/balance', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwtToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: userName
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error(`[NOWPAYMENTS_CUSTODY] Error en la respuesta:`, errorData);
            throw new Error(`Error creando custody user: ${response.status} - ${errorData}`);
        }

        const result = await response.json();
        console.log(`[NOWPAYMENTS_CUSTODY] Custody user creado exitosamente:`, result);

        return {
            success: true,
            custodyId: result.result.id,
            custodyName: result.result.name,
            createdAt: result.result.created_at,
            updatedAt: result.result.updated_at
        };

    } catch (error) {
        console.error(`[NOWPAYMENTS_CUSTODY] Error creando custody user:`, error);
        throw error;
    }
}

async function createCustodyForExistingUsers() {
    console.log('🔄 Iniciando creación de custody para usuarios existentes...\n');

    try {
        // Obtener todos los usuarios que no tienen custody_id
        const connection = await db.getConnection();
        const [users] = await connection.execute(
            'SELECT id, username, email FROM users WHERE nowpayments_custody_id IS NULL'
        );
        connection.release();

        console.log(`📊 Encontrados ${users.length} usuarios sin custody_id\n`);

        if (users.length === 0) {
            console.log('✅ Todos los usuarios ya tienen custody_id');
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        for (const user of users) {
            try {
                console.log(`🔧 Procesando usuario: ${user.username} (ID: ${user.id})`);
                
                // Crear custody user en NOWPayments usando el sistema automático
                const custodyResult = await createCustodyUser(user.username);
                const custodyId = custodyResult.custodyId;
                
                // Actualizar el usuario con el custody ID
                const updateConnection = await db.getConnection();
                await updateConnection.execute(
                    'UPDATE users SET nowpayments_custody_id = ? WHERE id = ?',
                    [custodyId, user.id]
                );
                updateConnection.release();
                
                console.log(`✅ Custody creado para ${user.username}: ${custodyId}`);
                successCount++;
                
                // Pequeña pausa para no sobrecargar la API
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error(`❌ Error creando custody para ${user.username}: ${error.message}`);
                errorCount++;
            }
        }

        console.log('\n📈 Resumen:');
        console.log(`✅ Custody creados exitosamente: ${successCount}`);
        console.log(`❌ Errores: ${errorCount}`);
        console.log(`📊 Total procesados: ${users.length}`);

    } catch (error) {
        console.error('❌ Error general:', error.message);
    }
}

// Ejecutar el script
createCustodyForExistingUsers().catch(console.error);


