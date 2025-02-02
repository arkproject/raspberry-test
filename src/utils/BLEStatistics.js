const { getCurrentTimestamp } = require('../utils/dateUtils');

class BLEStatistics {
    constructor() {
        this.stats = {
            discoveredDevices: 0,
            dataCounter: 0,
            connectionState: null,
            lastUpdate: null,
            session: {
                startTime: getCurrentTimestamp(),
                currentFile: null
            }
        };
    }

    incrementDiscoveredDevices() {
        this.stats.discoveredDevices++;
        this.stats.lastUpdate = getCurrentTimestamp();
    }

    incrementDataCounter() {
        this.stats.dataCounter++;
        this.stats.lastUpdate = getCurrentTimestamp();
    }

    updateConnectionState(state) {
        this.stats.connectionState = state;
        this.stats.lastUpdate = getCurrentTimestamp();
    }

    setCurrentFile(filename) {
        this.stats.session.currentFile = filename;
        this.stats.lastUpdate = getCurrentTimestamp();
    }

    getStats() {
        return {
            ...this.stats,
            uptime: this._calculateUptime()
        };
    }

    reset() {
        this.stats = {
            discoveredDevices: 0,
            dataCounter: 0,
            connectionState: null,
            lastUpdate: null,
            session: {
                startTime: getCurrentTimestamp(),
                currentFile: null
            }
        };
    }

    _calculateUptime() {
        if (!this.stats.session.startTime) return 0;
        const now = new Date();
        const start = new Date(this.stats.session.startTime);
        return Math.floor((now - start) / 1000); // uptime in seconds
    }
}

module.exports = BLEStatistics;