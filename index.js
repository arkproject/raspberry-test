const BLEScanner = require('./src/bluetooth/BLEScanner');
const { getUserInput } = require('./src/utils/inputUtils');
const settings = require('./src/config/settings');
const { getCurrentTimestamp } = require('./src/utils/dateUtils');

// Informazioni applicazione
const APP_INFO = {
    startTime: '2025-01-31 19:58:33',
    user: 'arkproject',
    version: '2.0.0'
};

class BLEApplication {
    constructor() {
        this.scanner = new BLEScanner();
        this.activeDevice = null;
        this.isRunning = true;
    }

    async showMainMenu() {
        console.log('\n=== Menu Principale ===');
        console.log('1. Ricerca automatica dispositivo APTIS');
        console.log('2. Scansione manuale e selezione dispositivo');
        console.log('q. Esci');
        console.log('=====================');

        const choice = await getUserInput('Seleziona un\'opzione: ');
        return choice.toLowerCase();
    }

    async handleManualScan() {
        try {
            console.log('Avvio scansione dispositivi...');

            // Aumenta il tempo di scansione per una migliore rilevazione
            const devices = await this.scanner.startScan(10000);

            if (devices.length === 0) {
                console.log('Nessun dispositivo trovato');
                return null;
            }

            while (true) {
                const deviceIndex = parseInt(await getUserInput('\nInserisci il numero del dispositivo da connettere (0 per tornare al menu): ')) - 1;

                if (deviceIndex === -1) return null;
                if (deviceIndex >= 0 && deviceIndex < devices.length) {
                    const selectedDevice = devices[deviceIndex];
                    console.log('\nDispositivo selezionato:');
                    console.log(`Nome: ${selectedDevice.name}`);
                    console.log(`Indirizzo: ${selectedDevice.address}`);
                    console.log(`RSSI: ${selectedDevice.rssi}`);
                    console.log(`Qualità segnale: ${selectedDevice.signalQuality}`);

                    const confirm = await getUserInput('\nConfermi la selezione? (s/n): ');
                    if (confirm.toLowerCase() === 's') {
                        return selectedDevice;
                    }
                } else {
                    console.log('Selezione non valida');
                }
            }
        } catch (error) {
            handleError(
                new BLEError(
                    'Errore durante la scansione manuale',
                    ErrorCodes.BLE.SCAN_FAILED,
                    { error: error.message }
                ),
                'BLEApplication.handleManualScan'
            );
            return null;
        }
    }

    async startDataAcquisition() {
        console.log('\nAcquisizione dati avviata');
        this.showCommandMenu();

        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        return new Promise((resolve) => {
            const handleKey = async (key) => {
                switch (key) {
                    case 'q':
                        await this.scanner.disconnect();
                        process.exit(0);
                        break;

                    case 's':
                        this.showStatistics();
                        break;

                    case 'r':
                        await this.handleReconnection();
                        break;

                    case 'h':
                        this.showCommandMenu();
                        break;

                    case 'm':
                        await this.scanner.disconnect();
                        process.stdin.removeListener('data', handleKey);
                        resolve('menu');
                        break;

                    case '\u0003': // Ctrl+C
                        await this.cleanup();
                        process.exit(0);
                        break;
                }
            };

            process.stdin.on('data', handleKey);
        });
    }

    showCommandMenu() {
        console.log('\nComandi disponibili:');
        console.log('q - Esci');
        console.log('s - Mostra statistiche');
        console.log('r - Riconnetti');
        console.log('h - Mostra questo menu');
        console.log('m - Torna al menu principale');
    }

    showStatistics() {
        const stats = this.scanner.getStatistics();
        const connStatus = this.scanner.getConnectionStatus();

        console.log('\n=== Statistiche ===');
        console.log(`Stato connessione: ${connStatus.isConnected ? 'Connesso' : 'Disconnesso'}`);
        console.log(`Dispositivo: ${connStatus.deviceName}`);
        console.log(`Indirizzo: ${connStatus.deviceAddress}`);
        console.log(`Connesso da: ${connStatus.connectionTime}`);
        console.log(`Campioni ricevuti: ${stats.dataCounter}`);
        console.log(`File corrente: ${stats.session.currentFile}`);
        console.log('=================\n');
    }

    async handleReconnection() {
        console.log('\nTentativo di riconnessione...');
        await this.scanner.disconnect();
        if (this.activeDevice) {
            await this.scanner.handleConnection(this.activeDevice);
        } else {
            await this.scanner.autoConnectToTarget();
        }
    }

    async run() {
        console.log(`\n=== BLE Scanner Application ===`);
        console.log(`Version: ${APP_INFO.version}`);
        console.log(`Start Time: ${APP_INFO.startTime}`);
        console.log(`User: ${APP_INFO.user}`);
        console.log('==============================\n');

        while (this.isRunning) {
            const choice = await this.showMainMenu();

            switch (choice) {
                case '1':
                    console.log(`\nAvvio ricerca automatica dispositivo ${settings.TARGET_DEVICE.NAME}...`);
                    const connected = await this.scanner.autoConnectToTarget();

                    if (connected) {
                        const result = await this.startDataAcquisition();
                        if (result === 'menu') continue;
                    } else {
                        console.log('Impossibile connettersi al dispositivo.');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    break;

                case '2':
                    this.activeDevice = await this.handleManualScan();
                    if (this.activeDevice) {
                        console.log(`\nConnessione a: ${this.activeDevice.name}`);
                        if (await this.scanner.handleConnection(this.activeDevice)) {
                            const result = await this.startDataAcquisition();
                            if (result === 'menu') continue;
                        }
                    }
                    break;

                case 'q':
                    await this.cleanup();
                    return;

                default:
                    console.log('Opzione non valida');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    break;
            }
        }
    }

    async cleanup() {
        this.isRunning = false;
        await this.scanner.disconnect();
        console.log('Programma terminato.');
    }
}

// Creazione e avvio dell'applicazione
const app = new BLEApplication();

// Gestione della chiusura pulita
process.on('SIGINT', async () => {
    console.log('\nChiusura del programma...');
    await app.cleanup();
    process.exit(0);
});

process.on('uncaughtException', async (error) => {
    console.error('Errore non gestito:', error);
    await app.cleanup();
    process.exit(1);
});

// Avvio dell'applicazione
app.run().catch(async error => {
    console.error('Errore critico:', error);
    await app.cleanup();
    process.exit(1);
});