/**
 * BLEDataHandler.js
 * Gestisce la decodifica e il salvataggio dei dati ricevuti dal dispositivo BLE
 * Created: 2025-02-02 17:19:59
 * Author: arkproject
 * Version: 2.1.0
 */

const { BLEError, handleError, ErrorCodes } = require('../utils/errorHandler');
const BLELogger = require('../utils/BLELogger');
const { getCurrentTimestamp } = require('../utils/dateUtils');
const BLEStatistics = require('../utils/BLEStatistics');
const settings = require('../config/settings');
const EventEmitter = require('events');

/**
 * Eventi emessi da BLEDataHandler
 * @readonly
 * @enum {string}
 */
const BLEDataEvents = {
    DATA_RECEIVED: 'data:received',      // Quando arrivano nuovi dati raw
    DATA_DECODED: 'data:decoded',        // Quando i dati sono stati decodificati con successo
    DATA_ERROR: 'data:error',           // Quando c'è un errore nella decodifica
    SEQUENCE_ERROR: 'data:sequence_error', // Quando viene rilevato un errore di sequenza
    LOG_ERROR: 'data:log_error',        // Quando c'è un errore nel logging
    CLEANUP_START: 'data:cleanup_start', // Quando inizia il cleanup
    CLEANUP_COMPLETE: 'data:cleanup_complete' // Quando il cleanup è completato
};

class BLEDataHandler extends EventEmitter {
    constructor(logger = new BLELogger(), statistics = new BLEStatistics()) {
        super();
        this.logger = new BLELogger();
        this.statistics = new BLEStatistics();
        this.lastProcessedData = null;
        this.dataValidationRules = {
            minBufferLength: 20,
            maxBufferLength: 20,
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

    /**
     * Gestisce i dati in arrivo dal dispositivo BLE
     * @param {Buffer} buffer - Buffer contenente i dati raw
     * @returns {Object} Dati decodificati
     */
    handleIncomingData(buffer) {
        this.emit(BLEDataEvents.DATA_RECEIVED, {
            timestamp: getCurrentTimestamp(),
            rawData: buffer.toString('hex')
        });
        
        try {
            const decodedData = this.decodeData(buffer);
            this.emit(BLEDataEvents.DATA_DECODED, decodedData);
            return decodedData;
        } catch (error) {
            this.emit(BLEDataEvents.DATA_ERROR, error);
            throw error;
        }
    }

    /**
     * Decodifica i dati dal buffer
     * @private
     */
    decodeData(buffer) {
        const timestamp = getCurrentTimestamp();

        try {
            this.validateBuffer(buffer);
            const decodedData = this.parseBuffer(buffer);
            this.validateDecodedData(decodedData);
            
            // Controllo sequenza
            this.checkSequence(decodedData);

            // Arricchimento dati
            decodedData.timestamp = timestamp;
            decodedData.raw_hex = buffer.toString('hex');

            // Salvataggio e statistiche
            this.logData(decodedData);
            this.updateStatistics(decodedData);
            
            this.lastProcessedData = decodedData;
            return decodedData;

        } catch (error) {
            this.handleDecodingError(error, buffer, timestamp);
            throw error;
        }
    }

    /**
     * Verifica la sequenza dei dati
     * @private
     */
    checkSequence(currentData) {
        if (this.lastProcessedData) {
            const expectedSequence = (this.lastProcessedData.numero_progressivo + 1) % 65536;
            if (currentData.numero_progressivo !== expectedSequence) {
                this.emit(BLEDataEvents.SEQUENCE_ERROR, {
                    expected: expectedSequence,
                    received: currentData.numero_progressivo,
                    timestamp: currentData.timestamp
                });
            }
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
        // Utilizzo di Uint8Array per una gestione più sicura del buffer
        const uint8Array = new Uint8Array(buffer);
        const view = new DataView(uint8Array.buffer);

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
        
        if (settings.DATA_ANALYSIS.ENABLED) {
            this.updateDataAnalysis(decodedData);
        }
    }

    updateDataAnalysis(decodedData) {
        // Per ora solo placeholder, implementeremo l'analisi più avanti
        // quando avremo definito meglio i requisiti di analisi
    }

    logData(decodedData) {
        try {
            this.logger.writeData(decodedData);
        } catch (error) {
            this.emit(BLEDataEvents.LOG_ERROR, error);
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

        this.logger.writeError(errorData);
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
        this.emit(BLEDataEvents.CLEANUP_START);
        
        try {
            await Promise.all([
                this.logger.flush(),
                new Promise(resolve => {
                    this.resetStatistics();
                    this.lastProcessedData = null;
                    resolve();
                })
            ]);
            
            this.emit(BLEDataEvents.CLEANUP_COMPLETE);
        } catch (error) {
            handleError(
                new BLEError(
                    'Errore durante il cleanup',
                    ErrorCodes.BLE.CLEANUP_ERROR,
                    { error: error.message }
                ),
                'BLEDataHandler.cleanup'
            );
        }
    }
}

module.exports = {
    BLEDataHandler,
    BLEDataEvents
};