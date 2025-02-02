/**
 * test_new.js
 * Test del nuovo BLEScanner con BLEEventManager
 * 
 * Created: 2025-02-01 19:04:40
 * Author: arkproject
 */

const BLEScanner = require('./src/bluetooth/BLEScanner');
const BLEEventManager = require('./src/bluetooth/BLEEventManager');
const { getCurrentTimestamp } = require('./src/utils/dateUtils');

const APP_INFO = {
    startTime: '2025-02-01 11:28:50',
    user: 'arkproject',
    version: '2.0.0'
};

async function main() {
    let scanner;

    try {
        // Crea l'event manager
        const eventManager = new BLEEventManager();
        const discoveredDevices = new Map();

        // // Configura i listener per il debug
        eventManager.on('bluetooth:initializing', (data) => {
            console.log('Bluetooth initializing...', data);
        });

        eventManager.on('bluetooth:initialized', (data) => {
            console.log('Bluetooth initialized:', data);
        });

        eventManager.on('bluetooth:error', (data) => {
            console.error('Bluetooth error:', data);
        });

        // Listener specifici per la discovery
        eventManager.on('discovery:starting', () => {
            console.log('\nAvvio scansione dispositivi...');
        });

        eventManager.on('discovery:device_found', (data) => {
            const { address, name, rssi, timestamp } = data;
            discoveredDevices.set(address, { name, address, rssi, timestamp });
            // console.log(`\nDispositivo trovato: ${name} (${address}) - RSSI: ${rssi}`);
            console.log('Nuovo dispositivo trovato:');
            console.log(`Indirizzo: ${address}`);
            console.log(`Nome: ${name}`);
            console.log(`RSSI: ${rssi}`);
            console.log(`Timestamp: ${timestamp}`);
            console.log('------------------------');


        });

        eventManager.on('discovery:stopped', (data) => {
            console.log('\nScansione completata:', data);
        });

        // Crea lo scanner passando l'event manager
        scanner = new BLEScanner(eventManager);

        console.log(`\n=== BLE Scanner Test ===`);
        console.log(`Version: ${APP_INFO.version}`);
        console.log(`Start Time: ${APP_INFO.startTime}`);
        console.log(`User: ${APP_INFO.user}`);
        console.log('========================\n');

        // Test 1: Inizializzazione
        // console.log('Test 1: Inizializzazione...');
        const initResult = await scanner.initialize();
        console.log('Inizializzazione:', initResult ? 'OK' : 'FALLITA');

        // Test 2: Scansione dispositivi
        // console.log('\nTest 2: Scansione dispositivi...');
        
        // Avvia la scansione e attendi
        await scanner.startScan(5000); // Aumentato a 10 secondi
        
        // Attendi che la scansione sia completata
        await new Promise(resolve => setTimeout(resolve, 5000)); // Attendi 11 secondi

        // Recupera i dispositivi trovati
        const devices = Array.from(discoveredDevices.values());
        console.log(`\nRiepilogo dispositivi trovati: ${devices.length}`);

        if (devices.length > 0) {
            console.log('\nDettaglio dispositivi:');
            devices.forEach((device, index) => {
                console.log(
                    `[${index + 1}] ${device.name} (${device.address}) - RSSI: ${device.rssi} @ ${device.timestamp}`
                );
            });
        }

        // Test 3: Cleanup
        console.log('\nTest: Cleanup...');
        await scanner.cleanup();
        console.log('Cleanup completato');

    } catch (error) {
        console.error('Errore durante il test:', error);
    } finally {
        if (scanner) {
            try {
                await scanner.cleanup();
            } catch (error) {
                console.error('Errore durante il cleanup finale:', error);
            }
        }
        // Attendi un po' prima di uscire per assicurare il cleanup completo
        await new Promise(resolve => setTimeout(resolve, 2000));
        process.exit(0);
    }
}

// Gestione della chiusura pulita
process.on('SIGINT', async () => {
    console.log('\nChiusura del programma...');
    process.exit(0);
});

main().catch(async error => {
    console.error('Errore critico:', error);
    process.exit(1);
});