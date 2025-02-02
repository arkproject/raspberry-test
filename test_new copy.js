const BLEScanner = require('./src/bluetooth/BLEScanner');
const BLEEventManager  = require('./src/bluetooth/BLEEventManager');
const { getCurrentTimestamp } = require('./src/utils/dateUtils');

const APP_INFO = {
    startTime: '2025-02-01 11:28:50',
    user: 'arkproject',
    version: '2.0.0'
};

async function main() {


    try {
        // Crea l'event manager
        const eventManager = new BLEEventManager();

        // Configura i listener per il debug
        eventManager.on('bluetooth:initializing', (data) => {
            console.log('Bluetooth initializing...', data);
        });

        eventManager.on('bluetooth:initialized', (data) => {
            console.log('Bluetooth initialized:', data);
        });

        eventManager.on('bluetooth:error', (data) => {
            console.log('Bluetooth error:', data);
        });

        // Crea lo scanner passando l'event manager
        const scanner = new BLEScanner(eventManager);

        console.log(`\n=== BLE Scanner Test ===`);
        console.log(`Version: ${APP_INFO.version}`);
        console.log(`Start Time: ${APP_INFO.startTime}`);
        console.log(`User: ${APP_INFO.user}`);
        console.log('========================\n');

        // Test 1: Inizializzazione
        console.log('Test 1: Inizializzazione...');
        const initResult = await scanner.initialize();
        console.log('Inizializzazione:', initResult ? 'OK' : 'FALLITA');

        // Test 2: Scansione dispositivi
        console.log('\nTest 2: Scansione dispositivi...');
        await scanner.startScan(5000); // 5 secondi di scansione
        await new Promise(resolve => setTimeout(resolve, 5500));
        // const devices = scanner.getDiscoveredDevices();
        // console.log(`\nRiepilogo dispositivi trovati: ${devices.length}`);

        if (devices.length > 0) {
            console.log('\nDettaglio dispositivi:');
            devices.forEach((device, index) => {
                // Formato: [1] Nome (Indirizzo) - RSSI: -XX dBm @ Timestamp
                console.log(
                    `[${index + 1}] ${device.name} (${device.address}) - RSSI: ${device.rssi} @ ${device.timestamp}`
                );
                // console.log(`\nDispositivo ${index + 1}:`);
                // console.log(`Nome: ${device.name}`);
                // console.log(`Indirizzo: ${device.address}`);
                // console.log(`RSSI: ${device.rssi}`);
                // console.log(`Timestamp: ${device.timestamp}`);
                // console.log('-'.repeat(40));
            });
        }

        // Test 3: Cleanup
        console.log('\nTest 3: Cleanup...');
        await scanner.cleanup();
        console.log('Cleanup completato');

    } catch (error) {
        console.error('Errore durante il test:', error);
    } finally {
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