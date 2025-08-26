const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const config = require('../../config');

const sqlInfo = config.sqlinfo;
const dbPath = path.join(__dirname, 'db', sqlInfo.fileName);

// Ensure the database folder exists
const dbFolder = path.dirname(dbPath);
if (!fs.existsSync(dbFolder)) {
  fs.mkdirSync(dbFolder, { recursive: true });
  console.log(`Created the database folder: ${dbFolder}`);
}

// Create the database connection
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error(err);
  } else {
    console.log('Connected to the SQLite database.');

    // Perform any necessary table creations
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS failed_login_attempts (
        username TEXT,
        ip_address TEXT
      )`, (err) => {
        if (err) {
          console.error(err);
        }
        else {
          console.log("Created failed_login_attempts table");
        }
      });

      db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
        username TEXT,
        message TEXT,
        ip_address TEXT,
        timestamp INTEGER
      )`, (err) => {
        if (err) {
          console.error(err);
        }
        else {
          console.log("Created chat_messages table");
        }
      });

      // Nueva tabla para usuarios
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT,
        username TEXT UNIQUE NOT NULL,
        balance REAL DEFAULT 100.0,
        google_id TEXT,
        display_name TEXT,
        avatar TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error(err);
        }
        else {
          console.log("Created users table");
        }
      });

      // Agregar columnas de Google si no existen (sin UNIQUE constraint)
      db.run(`ALTER TABLE users ADD COLUMN google_id TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding google_id column:', err);
        }
      });

      db.run(`ALTER TABLE users ADD COLUMN display_name TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding display_name column:', err);
        }
      });

      db.run(`ALTER TABLE users ADD COLUMN avatar TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding avatar column:', err);
        }
      });

      // Nueva tabla para sesiones
      db.run(`CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        session_token TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`, (err) => {
        if (err) {
          console.error(err);
        }
        else {
          console.log("Created sessions table");
        }
      });

      // Nueva tabla para historial de partidas
      db.run(`CREATE TABLE IF NOT EXISTS game_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        bet_amount REAL,
        final_amount REAL,
        returned_amount REAL,
        result_type TEXT, -- 'win', 'loss', 'tie'
        commission_applied REAL DEFAULT 0,
        start_time DATETIME,
        end_time DATETIME,
        duration_seconds INTEGER,
        max_mass_reached REAL DEFAULT 0,
        disconnect_reason TEXT, -- 'manual_cashout', 'disconnect', 'auto_cashout', 'kicked'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`, (err) => {
        if (err) {
          console.error(err);
        }
        else {
          console.log("Created game_history table");
        }
      });

      // Nueva tabla para pagos con NOWPayments (nueva implementación)
      db.run(`CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        payment_id TEXT UNIQUE,
        amount REAL,
        currency TEXT DEFAULT 'USD',
        pay_currency TEXT,
        pay_amount REAL,
        pay_address TEXT,
        order_id TEXT,
        status TEXT DEFAULT 'pending', -- 'waiting', 'confirming', 'confirmed', 'finished', 'failed', 'expired'
        qr_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`, (err) => {
        if (err) {
          console.error(err);
        }
        else {
          console.log("Created payments table (new implementation)");
        }
      });

      // Agregar columna qr_code si no existe
      db.run(`ALTER TABLE payments ADD COLUMN qr_code TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding qr_code column:', err);
        } else {
          console.log("Added qr_code column to payments table");
        }
      });

      // Nueva tabla para retiros con NOWPayments
      db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        withdrawal_id TEXT UNIQUE,
        payout_id TEXT,
        amount REAL,
        currency TEXT DEFAULT 'USD',
        crypto_currency TEXT,
        crypto_amount REAL,
        wallet_address TEXT,
        status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'cancelled'
        transaction_hash TEXT,
        fee REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`, (err) => {
        if (err) {
          console.error(err);
        }
        else {
          console.log("Created withdrawals table");
        }
      });

      // Agregar columna payout_id si no existe
      db.run(`ALTER TABLE withdrawals ADD COLUMN payout_id TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding payout_id column:', err);
        } else {
          console.log("Added payout_id column to withdrawals table");
        }
      });

      // Nueva tabla para estadísticas globales
      db.run(`CREATE TABLE IF NOT EXISTS global_stats (
        id INTEGER PRIMARY KEY,
        total_winnings REAL DEFAULT 0,
        total_bets_placed REAL DEFAULT 0,
        total_games_played INTEGER DEFAULT 0,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error(err);
        }
        else {
          console.log("Created global_stats table");
        }
      });

      // Insertar registro inicial si no existe
      db.run(`INSERT OR IGNORE INTO global_stats (id, total_winnings, total_bets_placed, total_games_played) VALUES (1, 0, 0, 0)`, (err) => {
        if (err) {
          console.error('Error inserting initial global stats:', err);
        } else {
          console.log("Initialized global_stats record");
        }
      });

      // Nueva tabla para leaderboard de jugadores
      db.run(`CREATE TABLE IF NOT EXISTS player_leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT NOT NULL,
        total_winnings REAL DEFAULT 0,
        total_games_played INTEGER DEFAULT 0,
        total_games_won INTEGER DEFAULT 0,
        total_games_lost INTEGER DEFAULT 0,
        total_games_tied INTEGER DEFAULT 0,
        biggest_win REAL DEFAULT 0,
        total_bets_placed REAL DEFAULT 0,
        win_rate REAL DEFAULT 0,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`, (err) => {
        if (err) {
          console.error(err);
        }
        else {
          console.log("Created player_leaderboard table");
        }
      });

      // Crear índice para mejorar el rendimiento de consultas del leaderboard
      db.run(`CREATE INDEX IF NOT EXISTS idx_leaderboard_winnings ON player_leaderboard (total_winnings DESC)`, (err) => {
        if (err) {
          console.error('Error creating leaderboard index:', err);
        } else {
          console.log("Created leaderboard index");
        }
      });

    });
  }
});

process.on('beforeExit', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing the database connection. ', err);
    } else {
      console.log('Closed the database connection.');
    }
  });
});

module.exports = db;
