require('dotenv').config()

function isDeveloper(uid) {
    switch (uid) {
        case '638290398665768961': //Reformed
        case '213081486583136256': //Aubit
        case '579837533098344450': //j scrambles
            return true;
        default:
            return false;
    }
}

module.exports = {
    isDeveloper: isDeveloper,
    guildId: process.env.GUILD,
    logChannel: process.env.LOG_CHANNEL,
    clientId: process.env.CLIENT_ID,
    token: process.env.TOKEN,
};