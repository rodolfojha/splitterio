// tokenStore.js
let tokenData = {
  accessToken: null,
  expiresAt: null // timestamp en segundos
};

module.exports = {
  setToken: (token, expiresIn) => {
    const now = Math.floor(Date.now() / 1000); // segundos actuales
    tokenData.accessToken = token;
    tokenData.expiresAt = now + expiresIn; // expiresIn = segundos que dura el token
  },
  getToken: () => tokenData.accessToken,
  isExpired: () => {
    if (!tokenData.expiresAt) return true;
    const now = Math.floor(Date.now() / 1000);
    return now >= tokenData.expiresAt;
  },
  getExpiryDate: () => tokenData.expiresAt
};
