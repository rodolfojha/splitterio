const db = require('../sql');
const crypto = require('crypto');

class AuthRepository {
    // Funciones de autenticación tradicional eliminadas - solo Google OAuth

    // Verificar sesión
    verifySession(sessionToken) {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT u.id, u.email, u.username, u.balance, s.expires_at 
                 FROM users u 
                 JOIN sessions s ON u.id = s.user_id 
                 WHERE s.session_token = ? AND s.expires_at > datetime('now')`,
                [sessionToken],
                (err, result) => {
                    if (err) {
                        reject(err);
                    } else if (!result) {
                        reject(new Error('Sesión inválida o expirada'));
                    } else {
                        resolve(result);
                    }
                }
            );
        });
    }

    // Cerrar sesión
    logoutUser(sessionToken) {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM sessions WHERE session_token = ?',
                [sessionToken],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    // Obtener balance del usuario
    getUserBalance(userId) {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT balance FROM users WHERE id = ?',
                [userId],
                (err, result) => {
                    if (err) {
                        reject(err);
                    } else if (!result) {
                        reject(new Error('Usuario no encontrado'));
                    } else {
                        resolve(result.balance);
                    }
                }
            );
        });
    }

    // Actualizar balance del usuario
    updateUserBalance(userId, newBalance) {
        return new Promise((resolve, reject) => {
            db.run(
                'UPDATE users SET balance = ? WHERE id = ?',
                [newBalance, userId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    // Limpiar sesiones expiradas
    cleanupExpiredSessions() {
        return new Promise((resolve, reject) => {
            db.run(
                "DELETE FROM sessions WHERE expires_at < datetime('now')",
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    // Descontar apuesta del balance del usuario
    deductBet(userId, betAmount) {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT balance FROM users WHERE id = ?',
                [userId],
                (err, result) => {
                    if (err) {
                        reject(err);
                    } else if (!result) {
                        reject(new Error('Usuario no encontrado'));
                    } else if (result.balance < betAmount) {
                        reject(new Error('Saldo insuficiente para la apuesta'));
                    } else {
                        const newBalance = result.balance - betAmount;
                        db.run(
                            'UPDATE users SET balance = ? WHERE id = ?',
                            [newBalance, userId],
                            function(err) {
                                if (err) {
                                    reject(err);
                                } else {
                                    resolve(newBalance);
                                }
                            }
                        );
                    }
                }
            );
        });
    }

    // Agregar ganancias al balance del usuario
    addWinnings(userId, amount) {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT balance FROM users WHERE id = ?',
                [userId],
                (err, result) => {
                    if (err) {
                        reject(err);
                    } else if (!result) {
                        reject(new Error('Usuario no encontrado'));
                    } else {
                        const newBalance = result.balance + amount;
                        db.run(
                            'UPDATE users SET balance = ? WHERE id = ?',
                            [newBalance, userId],
                            function(err) {
                                if (err) {
                                    reject(err);
                                } else {
                                    resolve(newBalance);
                                }
                            }
                        );
                    }
                }
            );
        });
    }

    // Obtener usuario por ID
    getUserById(id) {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT id, email, username, balance, google_id, display_name, avatar FROM users WHERE id = ?',
                [id],
                (err, user) => {
                    if (err) {
                        reject(err);
                    } else if (!user) {
                        reject(new Error('Usuario no encontrado'));
                    } else {
                        resolve(user);
                    }
                }
            );
        });
    }

    // Obtener usuario por Google ID
    getUserByGoogleId(googleId) {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT id, email, username, balance, google_id, display_name, avatar FROM users WHERE google_id = ?',
                [googleId],
                (err, user) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(user || null);
                    }
                }
            );
        });
    }

    // Obtener usuario por email
    getUserByEmail(email) {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT id, email, username, balance, google_id, display_name, avatar FROM users WHERE email = ?',
                [email],
                (err, user) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(user || null);
                    }
                }
            );
        });
    }

    // Crear usuario de Google
    createGoogleUser(userData) {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO users (google_id, email, password, username, display_name, avatar, balance) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userData.googleId, userData.email, null, userData.username, userData.displayName, userData.avatar, userData.balance],
                function(err) {
                    if (err) {
                        if (err.message.includes('UNIQUE constraint failed')) {
                            if (err.message.includes('email')) {
                                reject(new Error('Email ya está registrado'));
                            } else if (err.message.includes('username')) {
                                reject(new Error('Nombre de usuario ya está en uso'));
                            } else {
                                reject(new Error('Error de base de datos'));
                            }
                        } else {
                            reject(err);
                        }
                    } else {
                        resolve({
                            id: this.lastID,
                            googleId: userData.googleId,
                            email: userData.email,
                            username: userData.username,
                            displayName: userData.displayName,
                            avatar: userData.avatar,
                            balance: userData.balance
                        });
                    }
                }
            );
        });
    }

    // Actualizar Google ID de usuario existente
    updateUserGoogleId(userId, googleId) {
        return new Promise((resolve, reject) => {
            db.run(
                'UPDATE users SET google_id = ? WHERE id = ?',
                [googleId, userId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }
}

module.exports = new AuthRepository();
