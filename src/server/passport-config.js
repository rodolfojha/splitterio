const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const authConfig = require('../../config/google-auth');
const authRepository = require('./repositories/auth-repository');

// Serializar usuario para la sesión
passport.serializeUser((user, done) => {
    console.log('[PASSPORT] Serializando usuario con ID:', user.id);
    done(null, user.id);
});

// Deserializar usuario de la sesión
passport.deserializeUser(async (id, done) => {
    try {
        console.log('[PASSPORT] Deserializando usuario con ID:', id);
        const user = await authRepository.getUserById(id);
        console.log('[PASSPORT] Usuario deserializado:', user ? user.username : 'no encontrado');
        done(null, user);
    } catch (error) {
        console.error('[PASSPORT] Error al deserializar usuario:', error);
        done(error, null);
    }
});

// Configurar estrategia de Google OAuth
passport.use(new GoogleStrategy({
    clientID: authConfig.google.clientID,
    clientSecret: authConfig.google.clientSecret,
    callbackURL: authConfig.google.callbackURL
}, async (accessToken, refreshToken, profile, done) => {
    try {
        console.log('[GOOGLE_AUTH] Perfil recibido:', {
            id: profile.id,
            displayName: profile.displayName,
            email: profile.emails[0].value,
            provider: profile.provider
        });

        // Buscar usuario existente por Google ID
        let user = await authRepository.getUserByGoogleId(profile.id);
        
        if (!user) {
            // Buscar por email
            user = await authRepository.getUserByEmail(profile.emails[0].value);
            
            if (user) {
                // Usuario existe pero no tiene Google ID, actualizarlo
                await authRepository.updateUserGoogleId(user.id, profile.id);
                console.log('[GOOGLE_AUTH] Usuario existente vinculado con Google ID');
            } else {
                // Crear nuevo usuario
                const userData = {
                    googleId: profile.id,
                    email: profile.emails[0].value,
                    username: profile.displayName || profile.emails[0].value.split('@')[0],
                    displayName: profile.displayName,
                    avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
                    balance: 100.00 // Balance inicial
                };
                
                user = await authRepository.createGoogleUser(userData);
                console.log('[GOOGLE_AUTH] Nuevo usuario creado:', user.username);
            }
        }

        return done(null, user);
    } catch (error) {
        console.error('[GOOGLE_AUTH] Error en estrategia de Google:', error);
        return done(error, null);
    }
}));

module.exports = passport;
