module.exports = {
    google: {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: 'https://splittaio.com/auth/google/callback'
    },
    session: {
        secret: 'splitta-io-session-secret-key-2024',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false, // Temporalmente false para debug
            maxAge: 24 * 60 * 60 * 1000, // 24 horas
            sameSite: 'lax',
            httpOnly: false // Cambiar a false para permitir acceso desde JavaScript
        }
    }
};
