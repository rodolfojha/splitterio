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
