module.exports = {
    // Keys and other mathematical constants
    KEY_ESC: 27,
    KEY_ENTER: 13,
    KEY_CHAT: 13,
    KEY_FIREFOOD: 119,
    KEY_SPLIT: 32,
    KEY_LEFT: 37,
    KEY_UP: 38,
    KEY_RIGHT: 39,
    KEY_DOWN: 40,
    borderDraw: false,
    mobile: false,
    // Canvas
    screen: {
        width: window.innerWidth,
        height: window.innerHeight
    },
    game: {
        width: 0,
        height: 0
    },
    gameStart: false,
    disconnected: false,
    kicked: false,
    continuity: false,
    startPingTime: 0,
    toggleMassState: 0,
    showRedZone: true,
    backgroundColor: '#f2fbff',
    lineColor: '#000000',
    // Betting system variables
    betAmount: 0, // Stores the current player's bet amount
    originalBetAmount: 0, // Stores the original bet amount
    voluntaryExit: false, // Flag for voluntary disconnection
    // Cash out system variables
    cashOutProgress: 0,
    isCashOutActive: false,
    cashOutStartTime: 0,
    cashOutDuration: 2000, // 2 seconds to complete cash out
};
