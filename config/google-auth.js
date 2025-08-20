module.exports = {
    google: {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: 'https://splittaio.com/auth/google/callback'
    },
    session: {
        secret: 'splitta-io-session-secret-key-2024',
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: false, // Temporalmente false para debug
            maxAge: 24 * 60 * 60 * 1000, // 24 horas
            sameSite: 'lax',
            httpOnly: true
        }
    }
};
