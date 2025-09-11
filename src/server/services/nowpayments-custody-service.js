const fetch = require('node-fetch');

const tokenStore = require("../tokenStore"); //TOKEN JWT

//Refrescar nuevo token
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
class NowPaymentsCustodyService {
    constructor() {
        this.apiKey = process.env.NOWPAYMENTS_API_KEY;
        this.apiUrl = 'https://api.nowpayments.io/v1';
    }

    /**
     * Crear un nuevo subuser custody en NOWPayments
     * @param {string} userName - Nombre único del usuario (máximo 30 caracteres, NO email)
     * @returns {Promise<Object>} - Respuesta de la API con el ID del custody
     */
    async createCustodyUser(userName) {
        const token = await getValidToken();
        try {
            console.log(`[NOWPAYMENTS_CUSTODY] Creando custody user para: ${userName}`);
        
            if (!this.apiKey) {
                throw new Error('NOWPAYMENTS_API_KEY no está configurada');
            }

            // Validar que el nombre no sea un email y no exceda 30 caracteres
            if (typeof userName !== 'string' || userName.trim() === '') {
                throw new Error('El nombre del custody es inválido');
            }

            if (userName.includes('@')) {
                throw new Error('El nombre del custody no puede ser un email');
            }

            if (userName.length > 30) {
                throw new Error('El nombre del custody no puede exceder 30 caracteres');
            }

            // 1. Comprobar si el usuario existe
            const searchResponse = await fetch(`${this.apiUrl}/sub-partner`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            const searchResult = await searchResponse.json();

            // Recorremos los usuarios existentes
            const existingUser = searchResult.result.find(u => u.name === userName);

            if (existingUser) {
                console.log(`[NOWPAYMENTS_CUSTODY] El usuario ya existe:`, existingUser);
                return {
                    success: true,
                    custodyId: existingUser.id,
                    alreadyExists: true
                };
            }

            // 2. Crear el usuario si no existe
            const createResponse = await fetch(`${this.apiUrl}/sub-partner/balance`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: userName })
            });

            if (!createResponse.ok) {
                //Usuario ya existía
                const errorData = await createResponse.text();
                console.error(`[NOWPAYMENTS_CUSTODY] Error en la respuesta:`, errorData);
                throw new Error(`Error creando custody user: ${createResponse.status} - ${errorData}`);
            }

            const result = await createResponse.json();
            console.log(`[NOWPAYMENTS_CUSTODY] Custody user creado exitosamente:`, result);

            return {
                success: true,
                custodyId: result.result.id,
                alreadyExists: false
            };

        } catch (error) {
            console.error(`[NOWPAYMENTS_CUSTODY] Error creando custody user:`, error);
            throw error;
        }
    }

    /**
     * Obtener el balance de un usuario custody
     * @param {string} custodyId - ID del custody user
     * @returns {Promise<Object>} - Balance del usuario
     */
    async getCustodyBalance(custodyId) {

        try {
            console.log(`[NOWPAYMENTS_CUSTODY] Obteniendo balance para custody ID: ${custodyId}`);

            if (!this.apiKey) {
                throw new Error('NOWPAYMENTS_API_KEY no está configurada');
            }

            const response = await fetch(`${this.apiUrl}/sub-partner/balance/${custodyId}`, {
                method: 'GET',
                headers: {
                    'x-api-key': this.apiKey
                }
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error(`[NOWPAYMENTS_CUSTODY] Error obteniendo balance:`, errorData);
                throw new Error(`Error obteniendo balance: ${response.status} - ${errorData}`);
            }

            const result = await response.json();
            console.log(`[NOWPAYMENTS_CUSTODY] Balance obtenido:`, result);

            return result.result;

        } catch (error) {
            console.error(`[NOWPAYMENTS_CUSTODY] Error obteniendo balance:`, error);
            throw error;
        }
    }

    /**
     * Obtener lista de usuarios custody
     * @param {Object} options - Opciones de filtrado
     * @returns {Promise<Object>} - Lista de usuarios custody
     */
    async getCustodyUsers(options = {}) {

	    const token = await getValidToken();
        try {
            console.log(`[NOWPAYMENTS_CUSTODY] Obteniendo lista de custody users`);

            const params = new URLSearchParams();
            if (options.id) params.append('id', options.id);
            if (options.offset) params.append('offset', options.offset);
            if (options.limit) params.append('limit', options.limit);
            if (options.order) params.append('order', options.order);

            const url = `${this.apiUrl}/sub-partner?${params.toString()}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error(`[NOWPAYMENTS_CUSTODY] Error obteniendo lista:`, errorData);
                throw new Error(`Error obteniendo lista: ${response.status} - ${errorData}`);
            }

            const result = await response.json();
            console.log(`[NOWPAYMENTS_CUSTODY] Lista obtenida:`, result);

            return result.result;

        } catch (error) {
            console.error(`[NOWPAYMENTS_CUSTODY] Error obteniendo lista:`, error);
            throw error;
        }
    }

    /**
     * Crear un depósito para un usuario custody
     * @param {string} custodyId - ID del custody user
     * @param {string} currency - Moneda del depósito
     * @param {number} amount - Cantidad a depositar
     * @returns {Promise<Object>} - Resultado del depósito
     */
    async createCustodyDeposit(custodyId, currency, amount) {

	    const token = await getValidToken();
        try {
            console.log(`[NOWPAYMENTS_CUSTODY] Creando depósito: ${amount} ${currency} para custody ID: ${custodyId}`);

            const response = await fetch(`${this.apiUrl}/sub-partner/deposit`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    currency: currency,
                    amount: amount,
                    sub_partner_id: custodyId
                })
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error(`[NOWPAYMENTS_CUSTODY] Error creando depósito:`, errorData);
                throw new Error(`Error creando depósito: ${response.status} - ${errorData}`);
            }

            const result = await response.json();
            console.log(`[NOWPAYMENTS_CUSTODY] Depósito creado:`, result);

            return result.result;

        } catch (error) {
            console.error(`[NOWPAYMENTS_CUSTODY] Error creando depósito:`, error);
            throw error;
        }
    }
}

module.exports = new NowPaymentsCustodyService();


