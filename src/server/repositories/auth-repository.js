const db = require('../sql');
require('dotenv').config();
const nowPaymentsCustodyService = require('../services/nowpayments-custody-service');

class AuthRepository {
    constructor() {
        this.db = db;
    }

    // Crear usuario
    createUser(userData) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                const [result] = await connection.execute(
                    'INSERT INTO users (email, password, username, balance) VALUES (?, ?, ?, ?)',
                    [userData.email, userData.password, userData.username, userData.balance]
                );
                connection.release();
                resolve({
                    id: result.insertId,
                    email: userData.email,
                    username: userData.username,
                    balance: userData.balance
                });
            } catch (err) {
                if (err.message.includes('Duplicate entry')) {
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
            }
        });
    }

    // Verificar credenciales
    verifyCredentials(email, password) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                const [rows] = await connection.execute(
                    'SELECT id, email, username, balance, google_id, display_name, avatar, nowpayments_custody_id FROM users WHERE email = ? AND password = ?',
                    [email, password]
                );
                connection.release();
                
                if (rows.length === 0) {
                    resolve(null);
                } else {
                    resolve(rows[0]);
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    // Crear sesión
    createSession(userId, sessionToken, expiresAt) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                await connection.execute(
                    'INSERT INTO sessions (user_id, session_token, expires_at) VALUES (?, ?, ?)',
                    [userId, sessionToken, expiresAt]
                );
                connection.release();
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    // Obtener sesión por token
    getSessionByToken(sessionToken) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                const [rows] = await connection.execute(
                    'SELECT s.*, u.id, u.email, u.username, u.balance, u.google_id, u.display_name, u.avatar, u.nowpayments_custody_id FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = ? AND s.expires_at > NOW()',
                    [sessionToken]
                );
                connection.release();
                
                if (rows.length === 0) {
                    resolve(null);
                } else {
                    resolve(rows[0]);
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    // Eliminar sesión
    deleteSession(sessionToken) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                await connection.execute(
                    'DELETE FROM sessions WHERE session_token = ?',
                    [sessionToken]
                );
                connection.release();
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    // Actualizar balance
    updateBalance(userId, amount) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                
                // Obtener balance actual
                const [currentRows] = await connection.execute(
                    'SELECT balance FROM users WHERE id = ?',
                    [userId]
                );
                
                if (currentRows.length === 0) {
                    connection.release();
                    reject(new Error('Usuario no encontrado'));
                    return;
                }
                
                const newBalance = currentRows[0].balance + amount;
                
                // Actualizar balance
                await connection.execute(
                    'UPDATE users SET balance = ? WHERE id = ?',
                    [newBalance, userId]
                );
                
                connection.release();
                resolve(newBalance);
            } catch (err) {
                reject(err);
            }
        });
    }

    // Obtener usuario por ID
    getUserById(id) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                const [rows] = await connection.execute(
                    'SELECT id, email, username, balance, google_id, display_name, avatar, nowpayments_custody_id FROM users WHERE id = ?',
                    [id]
                );
                connection.release();
                
                if (rows.length === 0) {
                    reject(new Error('Usuario no encontrado'));
                } else {
                    resolve(rows[0]);
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    // Obtener usuario por Google ID
    getUserByGoogleId(googleId) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                const [rows] = await connection.execute(
                    'SELECT id, email, username, balance, google_id, display_name, avatar, nowpayments_custody_id FROM users WHERE google_id = ?',
                    [googleId]
                );
                connection.release();
                
                if (rows.length === 0) {
                    resolve(null);
                } else {
                    resolve(rows[0]);
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    // Obtener usuario por email
    getUserByEmail(email) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                const [rows] = await connection.execute(
                    'SELECT id, email, username, balance, google_id, display_name, avatar, nowpayments_custody_id FROM users WHERE email = ?',
                    [email]
                );
                connection.release();
                
                if (rows.length === 0) {
                    resolve(null);
                } else {
                    resolve(rows[0]);
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    // Crear usuario de Google
    createGoogleUser(userData) {
        return new Promise(async (resolve, reject) => {
            try {
                console.log('[AUTH_REPO] Creando usuario de Google:', userData.username);
                
                // Crear custody user en NOWPayments
                let custodyId = null;
                try {
                    const custodyResult = await nowPaymentsCustodyService.createCustodyUser(userData.googleId);
                    custodyId = custodyResult.custodyId;
                    console.log('[AUTH_REPO] Custody user creado exitosamente:', custodyId);
                } catch (custodyError) {
                    console.error('[AUTH_REPO] Error creando custody user:', custodyError);
                    // Continuar con la creación del usuario aunque falle el custody
                    // El custody se puede crear después manualmente
                }

                const connection = await this.db.getConnection();
                const [result] = await connection.execute(
                    'INSERT INTO users (google_id, email, password, username, display_name, avatar, balance, nowpayments_custody_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [userData.googleId, userData.email, null, userData.username, userData.displayName, userData.avatar, userData.balance, custodyId]
                );
                connection.release();
                
                const newUser = {
                    id: result.insertId,
                    googleId: userData.googleId,
                    email: userData.email,
                    username: userData.username,
                    displayName: userData.displayName,
                    avatar: userData.avatar,
                    balance: userData.balance,
                    nowpaymentsCustodyId: custodyId
                };

                console.log('[AUTH_REPO] Usuario creado exitosamente:', newUser.id);
                resolve(newUser);
            } catch (err) {
                console.error('[AUTH_REPO] Error creando usuario:', err);
                if (err.message.includes('Duplicate entry')) {
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
            }
        });
    }

    // Actualizar usuario de Google
    updateGoogleUser(userId, userData) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                await connection.execute(
                    'UPDATE users SET google_id = ?, display_name = ?, avatar = ? WHERE id = ?',
                    [userData.googleId, userData.displayName, userData.avatar, userId]
                );
                connection.release();
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    // Limpiar sesiones expiradas
    cleanupExpiredSessions() {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                await connection.execute(
                    'DELETE FROM sessions WHERE expires_at < NOW()'
                );
                connection.release();
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    // Verificar sesión
    verifySession(sessionToken) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                const [rows] = await connection.execute(
                    `SELECT u.id, u.email, u.username, u.balance, s.expires_at 
                     FROM users u 
                     JOIN sessions s ON u.id = s.user_id 
                     WHERE s.session_token = ? AND s.expires_at > NOW()`,
                    [sessionToken]
                );
                connection.release();
                
                if (rows.length === 0) {
                    reject(new Error('Sesión inválida o expirada'));
                } else {
                    resolve(rows[0]);
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    // Cerrar sesión
    logoutUser(sessionToken) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                await connection.execute(
                    'DELETE FROM sessions WHERE session_token = ?',
                    [sessionToken]
                );
                connection.release();
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    // Obtener balance del usuario
    getUserBalance(userId) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                const [rows] = await connection.execute(
                    'SELECT balance FROM users WHERE id = ?',
                    [userId]
                );
                connection.release();
                
                if (rows.length === 0) {
                    reject(new Error('Usuario no encontrado'));
                } else {
                    resolve(rows[0].balance);
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    // Actualizar balance del usuario
    updateUserBalance(userId, newBalance) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                await connection.execute(
                    'UPDATE users SET balance = ? WHERE id = ?',
                    [newBalance, userId]
                );
                connection.release();
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    // Descontar apuesta del balance del usuario
    deductBet(userId, betAmount) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                
                // Obtener balance actual
                const [currentRows] = await connection.execute(
                    'SELECT balance, nowpayments_custody_id FROM users WHERE id = ?',
                    [userId]
                );
                
                if (currentRows.length === 0) {
                    connection.release();
                    reject(new Error('Usuario no encontrado'));
                    return;
                }
                /*
                let currentBalance = Number(currentRows[0].balance) || 0;
                const custodyBalance = await nowPaymentsCustodyService.getCustodyBalance(currentRows[0].nowpayments_custody_id);
                const custodyBalance2 = await nowPaymentsCustodyService.getCustodyBalance(process.env.NOWPAYMENTS_PLAYING_ID);

                let currentCustodyBalance = (custodyBalance.balances.usdtmatic)?(custodyBalance.balances.usdtmatic.amount+custodyBalance.balances.usdtmatic.pendingAmount):12;
                console.log(JSON.stringify(custodyBalance, null, 2));
                console.log(JSON.stringify(custodyBalance2, null, 2));


                if(currentCustodyBalance != currentBalance){ //Priorizamos el custodyBalance
                    currentBalance = currentCustodyBalance;
                    //reject(new Error('Saldos incorrectos. Reasignando.'));
                }*/
                if (currentBalance < betAmount) {
                    connection.release();
                    reject(new Error('Saldo insuficiente para la apuesta'));
                    return;
                }
                //await nowPaymentsCustodyService.transferCustodyBalance(process.env.NOWPAYMENTS_PLAYING_ID, currentRows[0].nowpayments_custody_id, betAmount);
                
                const newBalance = Number((currentBalance - betAmount).toFixed(2));
                
                // Actualizar balance
                await connection.execute(
                    'UPDATE users SET balance = ? WHERE id = ?',
                    [newBalance, userId]
                );
                
                connection.release();
                resolve(newBalance);
            } catch (err) {
                reject(err);
            }
        });
    }

    // Agregar ganancias al balance del usuario
    addWinnings(userId, amount, comision = 0, playing = true) { 
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await this.db.getConnection();
                
                // Obtener balance actual
                const [currentRows] = await connection.execute(
                    'SELECT balance, nowpayments_custody_id FROM users WHERE id = ?',
                    [userId]
                );             
                
                if (currentRows.length === 0) {
                    connection.release();
                    reject(new Error('Usuario no encontrado'));
                    return;
                }                
                
                const currentBalance = Number(currentRows[0].balance) || 0;
                const newBalance = (parseFloat(currentBalance) + parseFloat(amount)).toFixed(2);
                
                if(comision>0){
                    await nowPaymentsCustodyService.transferCustodyBalance(process.env.NOWPAYMENTS_COMISSIONS_ID, process.env.NOWPAYMENTS_PLAYING_ID, comision);
                }
                if(!playing){
                    await nowPaymentsCustodyService.createCustodyDeposit(process.env.NOWPAYMENTS_PLAYING_ID,"usdtmatic",amount); //Añadir a jugadores ese saldo(discernir)
                }
                
                // Actualizar balance
                await connection.execute(
                    'UPDATE users SET balance = ? WHERE id = ?',
                    [newBalance, userId]
                );
                
                connection.release();
                resolve(newBalance);
            } catch (err) {
                reject(err);
            }
        });
    }

    // Actualizar custody ID de un usuario
    updateUserCustodyId(userId, custodyId) {
        return new Promise(async (resolve, reject) => {
            try {
                console.log(`[AUTH_REPO] Actualizando custody ID para usuario ${userId}: ${custodyId}`);
                
                const connection = await this.db.getConnection();
                await connection.execute(
                    'UPDATE users SET nowpayments_custody_id = ? WHERE id = ?',
                    [custodyId, userId]
                );
                connection.release();
                
                console.log(`[AUTH_REPO] Custody ID actualizado exitosamente para usuario ${userId}`);
                resolve();
            } catch (err) {
                console.error(`[AUTH_REPO] Error actualizando custody ID:`, err);
                reject(err);
            }
        });
    }

    // Crear custody para un usuario existente que no tiene custody ID
    createCustodyForExistingUser(userId) {
        return new Promise(async (resolve, reject) => {
            try {
                console.log(`[AUTH_REPO] Creando custody para usuario existente: ${userId}`);
                
                // Obtener información del usuario
                const user = await this.getUserById(userId);
                if (!user) {
                    reject(new Error('Usuario no encontrado'));
                    return;
                }

                // Verificar si ya tiene custody ID
                if (user.nowpayments_custody_id) {
                    console.log(`[AUTH_REPO] Usuario ${userId} ya tiene custody ID: ${user.nowpayments_custody_id}`);
                    resolve(user.nowpayments_custody_id);
                    return;
                }

                // Crear custody user en NOWPayments
                const custodyResult = await nowPaymentsCustodyService.createCustodyUser(user.googleId);
                const custodyId = custodyResult.custodyId;
                
                // Actualizar el usuario con el custody ID
                await this.updateUserCustodyId(userId, custodyId);
                
                console.log(`[AUTH_REPO] Custody creado exitosamente para usuario ${userId}: ${custodyId}`);
                resolve(custodyId);
            } catch (err) {
                console.error(`[AUTH_REPO] Error creando custody para usuario existente:`, err);
                reject(err);
            }
        });
    }
}

module.exports = AuthRepository;
