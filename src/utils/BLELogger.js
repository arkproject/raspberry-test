const FileLogger = require('../logger/FileLogger');
const { getCurrentTimestamp } = require('./dateUtils');
const path = require('path');

class BLELogger extends FileLogger {
    constructor() {
        super();
        this.dataBuffer = [];
        this.errorBuffer = [];
        this.bufferSize = 100; // Numero di record prima del flush su file
        this.logBasePath = path.join(process.cwd(), 'logs');
    }

    writeData(data) {
        this.dataBuffer.push({
            ...data,
            timestamp: data.timestamp || getCurrentTimestamp()
        });

        if (this.dataBuffer.length >= this.bufferSize) {
            this.flush();
        }
    }

    writeError(error) {
        this.errorBuffer.push({
            ...error,
            timestamp: error.timestamp || getCurrentTimestamp()
        });

        // Gli errori vengono scritti immediatamente
        this.flushErrors();
    }

    async flush() {
        try {
            if (this.dataBuffer.length > 0) {
                const dataFilePath = this.getDataFilePath();
                await this.writeToFile(dataFilePath, this.dataBuffer);
                this.dataBuffer = [];
            }

            await this.flushErrors();
        } catch (error) {
            console.error('Error during log flush:', error);
        }
    }

    async flushErrors() {
        if (this.errorBuffer.length > 0) {
            const errorFilePath = this.getErrorFilePath();
            await this.writeToFile(errorFilePath, this.errorBuffer);
            this.errorBuffer = [];
        }
    }

    getDataFilePath() {
        const date = new Date();
        return path.join(
            this.logBasePath,
            'data',
            `ble_data_${date.toISOString().split('T')[0]}.json`
        );
    }

    getErrorFilePath() {
        const date = new Date();
        return path.join(
            this.logBasePath,
            'errors',
            `ble_errors_${date.toISOString().split('T')[0]}.json`
        );
    }
}

module.exports = BLELogger;