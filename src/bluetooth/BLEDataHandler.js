const { BLEError, handleError, ErrorCodes } = require('../utils/errorHandler');
const BLELogger = require('../utils/BLELogger');
const { getCurrentTimestamp } = require('../utils/dateUtils');
const BLEStatistics = require('../utils/BLEStatistics');
const settings = require('../config/settings');
const EventEmitter = require('events');

// (gestione dati)
class BLEDataHandler extends EventEmitter {
    constructor() {
        super ();
        this.logger = new BLELogger();
        this.statistics = new BLEStatistics();
        this.lastProcessedData = null;
        this.dataValidationRules = {
            minBufferLength: 20,
            maxBufferLength: 20,
            validDataTypes: new Set(['Int16', 'Uint16']),
            valueRanges: {
                numero_progressivo: { min: 0, max: 65535 },
                asse_x: { min: -32768, max: 32767 },
                asse_y: { min: -32768, max: 32767 },
                asse_z: { min: -32768, max: 32767 },
                pressione_tallone: { min: 0, max: 65535 },
                pressione_primo_metatarso: { min: 0, max: 65535 },
                pressione_quinto_metatarso: { min: 0, max: 65535 },
                segnale_uno: { min: 0, max: 65535 },
                segnale_due: { min: 0, max: 65535 }
            }
        };
    }

    decodeData(buffer) {
        const timestamp = getCurrentTimestamp();

        try {
            this.validateBuffer(buffer);
            const decodedData = this.parseBuffer(buffer);
            this.validateDecodedData(decodedData);

            // Aggiungi timestamp e raw hex
            decodedData.timestamp = timestamp;
            decodedData.raw_hex = buffer.toString('hex');

            // Aggiorna statistiche e log
            this.updateStatistics(decodedData);
            this.logData(decodedData);

            this.lastProcessedData = decodedData;
            return decodedData;

        } catch (error) {
            this.handleDecodingError(error, buffer, timestamp);
            throw error;
        }
    }

    validateBuffer(buffer) {
        if (!buffer || !(buffer instanceof Buffer)) {
            throw new BLEError(
                'Buffer non valido',
                ErrorCodes.BLE.NOTIFICATION_ERROR,
                { error: 'Buffer non definito o di tipo non valido' }
            );
        }

        if (buffer.length !== this.dataValidationRules.minBufferLength) {
            throw new BLEError(
                'Dimensione buffer non valida',
                ErrorCodes.BLE.NOTIFICATION_ERROR,
                {
                    expectedLength: this.dataValidationRules.minBufferLength,
                    actualLength: buffer.length,
                    buffer: buffer.toString('hex')
                }
            );
        }
    }

    parseBuffer(buffer) {
        const view = new DataView(buffer.buffer, buffer.byteOffset);

        try {
            return {
                numero_progressivo: view.getUint16(0, false),
                asse_x: view.getInt16(2, true),
                asse_y: view.getInt16(4, true),
                asse_z: view.getInt16(6, true),
                pressione_tallone: view.getUint16(8, true),
                pressione_primo_metatarso: view.getUint16(10, true),
                pressione_quinto_metatarso: view.getUint16(12, true),
                segnale_uno: view.getUint16(14, true),
                segnale_due: view.getUint16(16, true)
            };
        } catch (error) {
            throw new BLEError(
                'Errore nel parsing del buffer',
                ErrorCodes.BLE.NOTIFICATION_ERROR,
                {
                    error: error.message,
                    buffer: buffer.toString('hex')
                }
            );
        }
    }

    validateDecodedData(data) {
        for (const [field, range] of Object.entries(this.dataValidationRules.valueRanges)) {
            if (data[field] === undefined) {
                throw new BLEError(
                    'Campo dati mancante',
                    ErrorCodes.BLE.NOTIFICATION_ERROR,
                    { field }
                );
            }

            if (data[field] < range.min || data[field] > range.max) {
                throw new BLEError(
                    'Valore fuori range',
                    ErrorCodes.BLE.NOTIFICATION_ERROR,
                    {
                        field,
                        value: data[field],
                        range
                    }
                );
            }
        }
    }

    updateStatistics(decodedData) {
        this.statistics.incrementCounter();

        // Aggiorna altre statistiche se necessario
        if (settings.DATA_ANALYSIS.ENABLED) {
            this.updateDataAnalysis(decodedData);
        }
    }

    updateDataAnalysis(decodedData) {
        // Implementa qui l'analisi dei dati in tempo reale se richiesta
        // Ad esempio: calcolo medie mobili, rilevamento anomalie, ecc.
    }

    logData(decodedData) {
        try {
            this.logger.writeData(decodedData);
        } catch (error) {
            handleError(
                new BLEError(
                    'Errore durante il logging dei dati',
                    ErrorCodes.BLE.LOGGING_ERROR,
                    { error: error.message }
                ),
                'BLEDataHandler.logData'
            );
        }
    }

    handleDecodingError(error, buffer, timestamp) {
        const errorData = {
            timestamp,
            error: error.message,
            buffer: buffer ? buffer.toString('hex') : 'buffer non disponibile'
        };

        // Log dell'errore
        this.logger.writeError(errorData);

        // Aggiorna statistiche errori se necessario
        this.statistics.incrementErrorCount();

        handleError(
            error instanceof BLEError ? error :
                new BLEError(
                    'Errore nella decodifica dei dati',
                    ErrorCodes.BLE.NOTIFICATION_ERROR,
                    errorData
                ),
            'BLEDataHandler.decodeData'
        );
    }

    getLastProcessedData() {
        return this.lastProcessedData;
    }

    getDataStatistics() {
        return this.statistics.getStats();
    }

    resetStatistics() {
        this.statistics.reset();
    }

    async cleanup() {
        try {
            await this.logger.flush();
            this.resetStatistics();
            this.lastProcessedData = null;
        } catch (error) {
            console.error('Error during BLEDataHandler cleanup:', error);
        }
    }
}

module.exports = BLEDataHandler;