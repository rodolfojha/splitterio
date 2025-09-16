// Configuración para separar frontend del backend
module.exports = {
    // URL del backend (VPS actual)
    BACKEND_URL: 'https://usa.backspitta.xyz',
    
    // Configuración CORS para permitir conexiones desde el frontend
    CORS_ORIGINS: [
        'https://splittaio.com',
        'https://www.splittaio.com'
    ],
    
    // Configuración de Socket.io para conexiones externas
    SOCKET_CONFIG: {
        pingInterval: 10000,
        pingTimeout: 60000,
        cors: {
            origin: ['https://splittaio.com', 'https://www.splittaio.com'],
            methods: ['GET', 'POST'],
            allowedHeaders: ['Content-Type', 'Authorization'],
            credentials: true
        }
    }
};
