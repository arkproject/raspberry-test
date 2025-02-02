const { BLEScanner } = require('./src/scanner');
const { getUserInput } = require('./src/utils/inputUtils');
const settings = require('./src/config/settings');

async function showMainMenu() {
    console.log('\n=== Menu Principale ===');
    console.log('1. Ricerca automatica dispositivo APTIS');
    console.log('2. Scansione manuale e selezione dispositivo');
    console.log('q. Esci');
    console.log('=====================');

    const choice = await getUserInput('Seleziona un\'opzione: ');
    return choice.toLowerCase();
}

async function handleManualScan(scanner) {
    try {
        console.log('Avvio scansione dispositivi...');
        await scanner.startScan(3000);

        // Attendi che la scansione sia completamente terminata
        await new Promise(resolve => setTimeout(resolve, 1000));

        const devices = scanner.getDiscoveredDevices();
        if (devices.length === 0) {
            console.log('Nessun dispositivo trovato');
            return null;
        }

        console.log('\nDispositivi disponibili:');
        devices.forEach((device, index) => {
            console.log(`${index + 1}. ${device.name} (${device.address})`);
            // console.log(`   RSSI: ${device.rssi}`);
            // console.log(`   Ultimo aggiornamento: ${device.timestamp}`);
            // console.log('------------------------');
        });

        const deviceIndex = parseInt(await getUserInput('\nInserisci il numero del dispositivo da connettere (0 per tornare al menu): ')) - 1;
        
        if (deviceIndex === -1) return null;
        if (deviceIndex >= 0 && deviceIndex < devices.length) {
            return devices[deviceIndex];
        } else {
            console.log('Selezione non valida');
            return null;
        }
    } catch (error) {
        console.error('Errore durante la scansione manuale:', error);
        return null;
    }
}

async function startDataAcquisition(scanner, activeDevice) {
    console.log('\nAcquisizione dati avviata');
    console.log('Comandi disponibili:');
    console.log('q - Esci');
    console.log('s - Mostra statistiche');
    console.log('r - Riconnetti');
    console.log('h - Mostra questo menu');
    console.log('m - Torna al menu principale');

    // Configura l'input
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    return new Promise((resolve) => {
        process.stdin.on('data', async (key) => {
            switch(key) {
                case 'q':
                    await scanner.disconnect();
                    process.exit(0);
                    break;

                case 's':
                    const stats = scanner.getStatistics();
                    const connStatus = scanner.getConnectionStatus();
                    console.log('\n=== Statistiche ===');
                    console.log(`Stato connessione: ${connStatus.isConnected ? 'Connesso' : 'Disconnesso'}`);
                    console.log(`Dispositivo: ${connStatus.deviceName}`);
                    console.log(`Indirizzo: ${connStatus.deviceAddress}`);
                    console.log(`Connesso da: ${connStatus.connectionTime}`);
                    console.log(`Campioni ricevuti: ${stats.dataCounter}`);
                    console.log(`File corrente: ${stats.session.currentFile}`);
                    console.log('=================\n');
                    break;

                case 'r':
                    console.log('\nTentativo di riconnessione...');
                    await scanner.disconnect();
                    if (activeDevice) {
                        await scanner.connectAndSetup(activeDevice);
                    } else {
                        await scanner.autoConnectToTarget();
                    }
                    break;

                case 'h':
                    console.log('\nComandi disponibili:');
                    console.log('q - Esci');
                    console.log('s - Mostra statistiche');
                    console.log('r - Riconnetti');
                    console.log('h - Mostra questo menu');
                    console.log('m - Torna al menu principale');
                    break;

                case 'm':
                    await scanner.disconnect();
                    resolve('menu');
                    break;

                case '\u0003': // Ctrl+C
                    await scanner.disconnect();
                    process.exit(0);
                    break;
            }
        });
    });
}

async function main() {
    const scanner = new BLEScanner();
    let activeDevice = null;

    while (true) {
        const choice = await showMainMenu();
        
        switch(choice) {
            case '1':
                console.log(`\nAvvio ricerca automatica dispositivo ${settings.TARGET_DEVICE.NAME}...`);
                const connected = await scanner.autoConnectToTarget();
                
                if (connected) {
                    const result = await startDataAcquisition(scanner, null);
                    if (result === 'menu') continue;
                } else {
                    console.log('Impossibile connettersi al dispositivo.');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                break;

            case '2':
                activeDevice = await handleManualScan(scanner);
                if (activeDevice) {
                    console.log(`\nConnessione a: ${activeDevice.name}`);
                    if (await scanner.connectAndSetup(activeDevice)) {
                        const result = await startDataAcquisition(scanner, activeDevice);
                        if (result === 'menu') continue;
                    }
                }
                break;

            case 'q':
                await scanner.disconnect();
                console.log('Programma terminato.');
                process.exit(0);
                break;

            default:
                console.log('Opzione non valida');
                await new Promise(resolve => setTimeout(resolve, 1000));
                break;
        }
    }
}

// Gestione della chiusura pulita
process.on('SIGINT', async () => {
    console.log('\nChiusura del programma...');
    await scanner.disconnect();
    process.exit(0);
});

main().catch(async error => {
    console.error('Errore critico:', error);
    if (scanner) await scanner.disconnect();
    process.exit(1);
});