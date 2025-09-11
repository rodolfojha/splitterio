const db = require("../sql.js");

const logFailedLoginAttempt = async (username, ipAddress) => {
    try {
        const connection = await db.getConnection();
        await connection.execute(
            "INSERT INTO failed_login_attempts (username, ip_address) VALUES (?, ?)",
            [username, ipAddress]
        );
        connection.release();
    } catch (err) {
        console.error(err);
    }
};

module.exports = {
    logFailedLoginAttempt,
};
