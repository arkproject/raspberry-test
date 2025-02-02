/**
 * Test per BLEDataHandler.js
 * Created: 2025-02-02 17:28:40
 * Author: arkproject 
 */

const { BLEDataHandler, BLEDataEvents } = require('../../src/bluetooth/BLEDataHandler');
const { BLEError } = require('../../src/utils/errorHandler');

describe('BLEDataHandler', () => {
    let dataHandler;
    let eventCallbacks;

    // Setup prima di ogni test
    beforeEach(() => {
        dataHandler = new BLEDataHandler();
        eventCallbacks = {
            dataReceived: jest.fn(),
            dataDecoded: jest.fn(),
            dataError: jest.fn(),
            sequenceError: jest.fn()
        };

        // Registra i callback per gli eventi
        dataHandler.on(BLEDataEvents.DATA_RECEIVED, eventCallbacks.dataReceived);
        dataHandler.on(BLEDataEvents.DATA_DECODED, eventCallbacks.dataDecoded);
        dataHandler.on(BLEDataEvents.DATA_ERROR, eventCallbacks.dataError);
        dataHandler.on(BLEDataEvents.SEQUENCE_ERROR, eventCallbacks.sequenceError);
    });

    describe('handleIncomingData', () => {
        it('dovrebbe decodificare correttamente i dati validi', () => {
            // Crea un buffer di test valido (20 byte)
            const testBuffer = Buffer.from([
                0x00, 0x01, // numero_progressivo: 1
                0x00, 0x02, // asse_x: 2
                0x00, 0x03, // asse_y: 3
                0x00, 0x04, // asse_z: 4
                0x00, 0x05, // pressione_tallone: 5
                0x00, 0x06, // pressione_primo_metatarso: 6
                0x00, 0x07, // pressione_quinto_metatarso: 7
                0x00, 0x08, // segnale_uno: 8
                0x00, 0x09, // segnale_due: 9
                0x00, 0x0A  // padding
            ]);

            const result = dataHandler.handleIncomingData(testBuffer);

            // Verifica che gli eventi corretti siano stati emessi
            expect(eventCallbacks.dataReceived).toHaveBeenCalled();
            expect(eventCallbacks.dataDecoded).toHaveBeenCalled();
            expect(eventCallbacks.dataError).not.toHaveBeenCalled();

            // Verifica i dati decodificati
            expect(result).toMatchObject({
                numero_progressivo: 1,
                asse_x: 2,
                asse_y: 3,
                asse_z: 4,
                pressione_tallone: 5,
                pressione_primo_metatarso: 6,
                pressione_quinto_metatarso: 7,
                segnale_uno: 8,
                segnale_due: 9
            });
        });

        it('dovrebbe rilevare errori di sequenza', () => {
            // Primo pacchetto
            const buffer1 = Buffer.from([
                0x00, 0x01, // numero_progressivo: 1
                ...new Array(18).fill(0) // riempimento
            ]);

            // Secondo pacchetto con sequenza errata
            const buffer2 = Buffer.from([
                0x00, 0x03, // numero_progressivo: 3 (dovrebbe essere 2)
                ...new Array(18).fill(0) // riempimento
            ]);

            dataHandler.handleIncomingData(buffer1);
            dataHandler.handleIncomingData(buffer2);

            expect(eventCallbacks.sequenceError).toHaveBeenCalledWith({
                expected: 2,
                received: 3,
                timestamp: expect.any(String)
            });
        });

        it('dovrebbe gestire buffer non validi', () => {
            const invalidBuffer = Buffer.from([0x00, 0x01]); // Buffer troppo corto

            expect(() => {
                dataHandler.handleIncomingData(invalidBuffer);
            }).toThrow(BLEError);

            expect(eventCallbacks.dataError).toHaveBeenCalled();
        });

        it('dovrebbe gestire valori fuori range', () => {
            const bufferWithInvalidValues = Buffer.from([
                0xFF, 0xFF, // numero_progressivo: 65535 (ok)
                0x80, 0x00, // asse_x: -32768 (ok)
                0x7F, 0xFF, // asse_y: 32767 (ok)
                0x80, 0x01, // asse_z: fuori range
                ...new Array(12).fill(0) // riempimento
            ]);

            expect(() => {
                dataHandler.handleIncomingData(bufferWithInvalidValues);
            }).toThrow(BLEError);

            expect(eventCallbacks.dataError).toHaveBeenCalled();
        });
    });

    describe('cleanup', () => {
        it('dovrebbe eseguire il cleanup correttamente', async () => {
            const cleanupStartSpy = jest.fn();
            const cleanupCompleteSpy = jest.fn();

            dataHandler.on(BLEDataEvents.CLEANUP_START, cleanupStartSpy);
            dataHandler.on(BLEDataEvents.CLEANUP_COMPLETE, cleanupCompleteSpy);

            await dataHandler.cleanup();

            expect(cleanupStartSpy).toHaveBeenCalled();
            expect(cleanupCompleteSpy).toHaveBeenCalled();
            expect(dataHandler.getLastProcessedData()).toBeNull();
        });
    });
});