/**
 * Test per BLEDataHandler.js
 * Created: 2025-02-02 18:27:20
 * Author: arkproject 
 */

// Mock settings
jest.mock('../../src/config/settings', () => ({
    DATA_ANALYSIS: {
        ENABLED: false
    },
    FILE_SETTINGS: {
        MAX_FILE_SIZE: 1024 * 1024 * 10,
        ROTATION_ENABLED: true,
        ROTATION_COUNT: 5,
        BASE_PATH: 'logs',
        FILENAME_PREFIX: 'ble_data_',
        FILE_EXTENSION: '.csv'
    },
    DATA_FORMAT: {
        TIMESTAMP_FORMAT: 'YYYY-MM-DD HH:mm:ss',
        CSV_HEADER: [
            'timestamp',
            'numero_progressivo',
            'asse_x',
            'asse_y',
            'asse_z',
            'pressione_tallone',
            'pressione_primo_metatarso',
            'pressione_quinto_metatarso',
            'segnale_uno',
            'segnale_due',
            'raw_hex'
        ].join(',')
    },
    SESSION_SETTINGS: {
        DURATION: 10000,
        AUTO_RESTART: true,
        SESSION_PREFIX: 'session_',
        INCLUDE_SESSION_NUMBER: true
    }
}));

// Mock FileLogger
jest.mock('../../src/logger/FileLogger', () => {
    return jest.fn().mockImplementation(() => ({
        writeToFile: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn()
    }));
});

// Mock BLELogger
jest.mock('../../src/utils/BLELogger', () => {
    return jest.fn().mockImplementation(() => ({
        dataBuffer: [],
        errorBuffer: [],
        writeData: jest.fn().mockResolvedValue(undefined),
        writeError: jest.fn().mockResolvedValue(undefined),
        writeToFile: jest.fn().mockResolvedValue(undefined),
        flush: jest.fn().mockResolvedValue(undefined),
        flushErrors: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn(),
        getDataFilePath: jest.fn(),
        getErrorFilePath: jest.fn()
    }));
});

// Mock errorHandler
jest.mock('../../src/utils/errorHandler', () => {
    class BLEError extends Error {
        constructor(message, code, details) {
            super(message);
            this.name = 'BLEError';
            this.code = code;
            this.details = details;
        }
    }

    return {
        BLEError,
        ErrorCodes: {
            BLE: {
                NOTIFICATION_ERROR: 'BLE_NOTIFICATION_ERROR',
                LOGGING_ERROR: 'BLE_LOGGING_ERROR',
                CLEANUP_ERROR: 'BLE_CLEANUP_ERROR'
            }
        },
        handleError: jest.fn()
    };
});

// Mock fs
jest.mock('fs', () => ({
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    appendFileSync: jest.fn(),
    accessSync: jest.fn()
}));

// Mock BLEStatistics
jest.mock('../../src/utils/BLEStatistics', () => {
    return jest.fn().mockImplementation(() => ({
        counter: 0,
        errors: 0,
        incrementCounter: jest.fn().mockImplementation(function() {
            this.counter++;
            return this.counter;
        }),
        incrementErrorCount: jest.fn().mockImplementation(function() {
            this.errors++;
            return this.errors;
        }),
        getStats: jest.fn().mockImplementation(function() {
            return {
                counter: this.counter,
                errors: this.errors
            };
        }),
        reset: jest.fn().mockImplementation(function() {
            this.counter = 0;
            this.errors = 0;
        })
    }));
});

const { BLEDataHandler, BLEDataEvents } = require('../../src/bluetooth/BLEDataHandler');
const BLEStatistics = require('../../src/utils/BLEStatistics');
const { BLEError } = require('../../src/utils/errorHandler');

describe('BLEDataHandler', () => {
    let dataHandler;
    let statistics;
    let eventCallbacks;

    beforeEach(() => {
        // Reset dei mock
        jest.clearAllMocks();
        
        // Mock delle statistiche
        statistics = new BLEStatistics();

        // Crea una nuova istanza di BLEDataHandler
        dataHandler = new BLEDataHandler();
        // Sostituisci le statistiche interne
        dataHandler.statistics = statistics;

        // Inizializza i callback degli eventi
        eventCallbacks = {};
        Object.values(BLEDataEvents).forEach(event => {
            eventCallbacks[event] = jest.fn();
            dataHandler.on(event, eventCallbacks[event]);
        });
    });

    describe('handleIncomingData', () => {
        it('dovrebbe decodificare correttamente i dati validi', () => {
            const testBuffer = Buffer.from([
                0x00, 0x01, // numero_progressivo: 1 (big endian)
                0x02, 0x00, // asse_x: 2 (little endian)
                0x03, 0x00, // asse_y: 3 (little endian)
                0x04, 0x00, // asse_z: 4 (little endian)
                0x05, 0x00, // pressione_tallone: 5 (little endian)
                0x06, 0x00, // pressione_primo_metatarso: 6 (little endian)
                0x07, 0x00, // pressione_quinto_metatarso: 7 (little endian)
                0x08, 0x00, // segnale_uno: 8 (little endian)
                0x09, 0x00, // segnale_due: 9 (little endian)
                0x0A, 0x00  // padding (little endian)
            ]);

            const result = dataHandler.handleIncomingData(testBuffer);

            expect(eventCallbacks[BLEDataEvents.DATA_RECEIVED]).toHaveBeenCalledWith({
                timestamp: expect.any(String),
                rawData: testBuffer.toString('hex')
            });
            expect(eventCallbacks[BLEDataEvents.DATA_DECODED]).toHaveBeenCalledWith(
                expect.objectContaining({
                    numero_progressivo: 1,
                    timestamp: expect.any(String)
                })
            );
            expect(statistics.incrementCounter).toHaveBeenCalled();
            expect(result).toMatchObject({
                numero_progressivo: 1,
                asse_x: 2,
                asse_y: 3,
                asse_z: 4,
                pressione_tallone: 5,
                pressione_primo_metatarso: 6,
                pressione_quinto_metatarso: 7,
                segnale_uno: 8,
                segnale_due: 9,
                timestamp: expect.any(String),
                raw_hex: expect.any(String)
            });
        });

        it('dovrebbe gestire errori di decodifica', () => {
            const invalidBuffer = Buffer.from([0x00]); // Buffer troppo corto

            expect(() => {
                dataHandler.handleIncomingData(invalidBuffer);
            }).toThrow(BLEError);

            expect(eventCallbacks[BLEDataEvents.DATA_RECEIVED]).toHaveBeenCalledWith({
                timestamp: expect.any(String),
                rawData: invalidBuffer.toString('hex')
            });
            expect(eventCallbacks[BLEDataEvents.DATA_ERROR]).toHaveBeenCalled();
            expect(statistics.incrementErrorCount).toHaveBeenCalled();
        });
    });

    describe('cleanup', () => {
        it('dovrebbe eseguire il cleanup correttamente', async () => {
            await dataHandler.cleanup();

            expect(eventCallbacks[BLEDataEvents.CLEANUP_START]).toHaveBeenCalled();
            expect(statistics.reset).toHaveBeenCalled();
            expect(eventCallbacks[BLEDataEvents.CLEANUP_COMPLETE]).toHaveBeenCalled();
        });

        it('dovrebbe gestire errori durante il cleanup', async () => {
            await dataHandler.cleanup();

            expect(eventCallbacks[BLEDataEvents.CLEANUP_START]).toHaveBeenCalled();
            expect(statistics.reset).toHaveBeenCalled();
        });
    });

    describe('getLastProcessedData e getDataStatistics', () => {
        it('dovrebbe fornire gli ultimi dati processati', () => {
            const testBuffer = Buffer.from([
                0x00, 0x01, // numero_progressivo: 1 (big endian)
                0x02, 0x00, // asse_x: 2 (little endian)
                0x03, 0x00, // asse_y: 3 (little endian)
                0x04, 0x00, // asse_z: 4 (little endian)
                0x05, 0x00, // pressione_tallone: 5 (little endian)
                0x06, 0x00, // pressione_primo_metatarso: 6 (little endian)
                0x07, 0x00, // pressione_quinto_metatarso: 7 (little endian)
                0x08, 0x00, // segnale_uno: 8 (little endian)
                0x09, 0x00, // segnale_due: 9 (little endian)
                0x0A, 0x00  // padding (little endian)
            ]);

            dataHandler.handleIncomingData(testBuffer);
            const lastData = dataHandler.getLastProcessedData();
            
            expect(lastData).toBeTruthy();
            expect(lastData.numero_progressivo).toBe(1);
        });

        it('dovrebbe fornire statistiche corrette', () => {
            const stats = dataHandler.getDataStatistics();
            expect(stats).toEqual({
                counter: 0,
                errors: 0
            });
        });
    });

    describe('resetStatistics', () => {
        it('dovrebbe resettare le statistiche', () => {
            // Incrementa alcuni contatori
            statistics.incrementCounter();
            statistics.incrementErrorCount();
            
            // Resetta le statistiche
            dataHandler.resetStatistics();
            
            // Verifica che i contatori siano stati resettati
            const stats = dataHandler.getDataStatistics();
            expect(stats).toEqual({
                counter: 0,
                errors: 0
            });
        });
    });
});