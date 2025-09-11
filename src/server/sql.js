require('dotenv').config({ path: '/var/www/splitta/.env' });
const mysql = require('mysql2/promise');
const config = require('../../config');

// Crear pool de conexiones MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000,
  acquireTimeout: 60000,
  timeout: 60000
});

// Función para verificar la conexión y las tablas existentes
async function verifyConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('Connected to the MySQL database successfully.');

    // Verificar que las tablas existen
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('Available tables:');
    tables.forEach(table => {
      console.log(`- ${Object.values(table)[0]}`);
    });

    connection.release();
    console.log('Database connection verified successfully.');

  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
}

// Verificar la conexión al cargar el módulo
verifyConnection().catch(console.error);

// Manejar cierre del proceso
process.on('beforeExit', async () => {
  try {
    await pool.end();
    console.log('Closed the database connection pool.');
  } catch (error) {
    console.error('Error closing the database connection pool:', error);
  }
});

module.exports = pool;
