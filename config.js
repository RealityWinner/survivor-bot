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
    clientId: '1016712297214902333', //survivor dev bot
    logChannel: '1016911305585737811', //survivor dev bot #logs
    token: process.env.TOKEN,
};