const db = require("../sql.js");

const logChatMessage = async (username, message, ipAddress) => {
    const timestamp = new Date().getTime();

    try {
        const connection = await db.getConnection();
        await connection.execute(
            "INSERT INTO chat_messages (username, message, ip_address, timestamp) VALUES (?, ?, ?, ?)",
            [username, message, ipAddress, timestamp]
        );
        connection.release();
    } catch (err) {
        console.error(err);
    }
};

module.exports = {
    logChatMessage,
};
