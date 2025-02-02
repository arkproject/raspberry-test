const { BLEScanner } = require('./src/scanner');
const { getUserInput } = require('./src/utils/inputUtils');
const settings = require('./src/config/settings');

async function handleExit(scanner, activeDevice) {
    console.log('\nChiusura del programma...');
    if (activeDevice) {
        try {
            await activeDevice.disconnect();
            console.log('Dispositivo disconnesso');
        } catch (error) {
            console.error('Errore durante la disconnessione:', error);
        }
    }
    await scanner.cleanup();
    process.exit(0);
}

async function main() {
    const scanner = new BLEScanner();
    this.settings = settings;
    let activeDevice = null;
    let isRunning = true;

    // Gestione della chiusura pulita
    process.on('SIGINT', async () => {
        await handleExit(scanner, activeDevice);
    });

    try {
        // Avvia la scansione per 3 secondi
        console.log('Avvio scansione dispositivi...');
        await scanner.startScan(this.settings.SCAN_DURATION);

        // Attendi che la scansione sia completamente terminata
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Mostra i dispositivi trovati
        const devices = scanner.getDiscoveredDevices();
        if (devices.length === 0) {
            console.log('Nessun dispositivo trovato');
            await scanner.cleanup();
            process.exit(0);
        }

        console.log('\nDispositivi disponibili:');
        devices.forEach((device, index) => {
            console.log(`${index + 1}. ${device.name} (${device.address})`);
        });

        // Chiedi all'utente quale dispositivo vuole leggere
        const deviceIndex = parseInt(await getUserInput('\nInserisci il numero del dispositivo da leggere: ')) - 1;

        if (deviceIndex >= 0 && deviceIndex < devices.length) {
            const selectedDevice = devices[deviceIndex];
            console.log(`\nConfigurazione notifiche per il dispositivo: ${selectedDevice.name}`);

            try {
                await scanner.initialize();
                activeDevice = await scanner.readCharacteristicValue(selectedDevice.address);

                console.log('\nAcquisizione dati in corso...');
                console.log('Comandi disponibili:');
                console.log('q - Esci');
                console.log('h - Mostra questo menu');
                console.log('\nIn attesa di notifiche...\n');

                // Gestione input utente durante l'acquisizione
                // Configura l'input
                const stdin = process.stdin;
                stdin.setRawMode(true);
                stdin.resume();
                stdin.setEncoding('utf8');

                // Gestione degli input da tastiera
                // Gestione degli input da tastiera
                process.stdin.on('keypress', (str, key) => {
                    if (key.ctrl && key.name === 'c') {
                        handleExit(scanner, activeDevice);
                        return;
                    }

                    switch (str) {
                        case 'q':
                            handleExit(scanner, activeDevice);
                            break;

                        case '\u0003': // Ctrl+C
                            handleExit(scanner, activeDevice);
                            break;
                    }
                });

                // Mantieni il programma in esecuzione fino a quando isRunning è true
                while (isRunning) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

            } catch (error) {
                console.error('Errore durante la configurazione delle notifiche:', error);
                await handleExit(scanner, activeDevice);
            }
        } else {
            console.log('Selezione non valida');
            await handleExit(scanner, activeDevice);
        }

    } catch (error) {
        console.error('Errore nel programma principale:', error);
        await handleExit(scanner, activeDevice);
    }
}

main().catch(console.error);