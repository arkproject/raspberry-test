class BLELogger {
    constructor() {
        this.data = [];
        this.errors = [];
    }

    writeData(data) {
        this.data.push(data);
    }

    writeError(error) {
        this.errors.push(error);
    }

    async flush() {
        return Promise.resolve();
    }

    // Metodi helper per i test
    getData() {
        return this.data;
    }

    getErrors() {
        return this.errors;
    }

    clear() {
        this.data = [];
        this.errors = [];
    }
}

module.exports = BLELogger;