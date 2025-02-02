const { createBluetooth } = require('node-ble');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

class BLEScanner {
    constructor() {
        this.bluetooth = null;
        this.adapter = null;
        this.isScanning = false;
        this.discoveredDevices = new Map();
        this.TARGET_SERVICE_UUID = "00000000-cc7a-482a-984a-7f2ed5b3e58f";
        this.scanTimer = null;
        this.dataCounter = 0;        // Inizializzazione esplicita
        this.startTime = null;       // Inizializzazione esplicita

        // Crea cartella logs se non esiste
        this.logsDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir);
        }

        // Crea il nome del file con timestamp
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').split('T')[0];
        this.logFileName = path.join(this.logsDir, `ble_data_${timestamp}.csv`);

        // Crea/Apri il file di log e scrivi l'intestazione
        if (!fs.existsSync(this.logFileName)) {
            const header = 'timestamp,numero_progressivo,asse_x,asse_y,asse_z,pressione_tallone,pressione_primo_metatarso,pressione_quinto_metatarso,segnale_uno,segnale_due,raw_hex\n';
            fs.writeFileSync(this.logFileName, header);
        }
    }

    // Funzione per convertire due byte in un intero (little endian)
    bytesToInt(byte1, byte2) {
        return (byte2 << 8) | byte1;
    }

    // Funzione per convertire due byte in un intero con segno (complemento a due)
    bytesToSignedInt(byte1, byte2) {
        let value = this.bytesToInt(byte1, byte2);
        if (value & 0x8000) {  // Se il bit più significativo è 1
            value = value - 0x10000;  // Converti in complemento a due
        }
        return value;
    }

    convertToArrayString(hexString) {
        const buffer = Buffer.from(hexString.substring(0, 4), 'hex');
        return [buffer.readUInt16LE(0).toString()];
    }

    // Funzione per decodificare il buffer di dati
    decodeData(buffer) {
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

        try {
            if (buffer.length < 20) {  // 40 caratteri hex = 20 bytes
                throw new Error(`Buffer troppo corto: ${buffer.length} bytes (attesi 20 bytes)`);
            }

            // Incrementa il contatore e imposta il tempo di inizio
            this.dataCounter++;
            if (!this.startTime) {
                this.startTime = Date.now();
            }

            // Decodifica diretta dal buffer usando DataView per massima affidabilità
            const view = new DataView(buffer.buffer, buffer.byteOffset);

            const decodedData = {
                timestamp,
                numero_progressivo: view.getUint16(0, false),  // false = big endian
                asse_x: view.getInt16(2, true),               // true = little endian
                asse_y: view.getInt16(4, true),
                asse_z: view.getInt16(6, true),
                pressione_tallone: view.getUint16(8, true),
                pressione_primo_metatarso: view.getUint16(10, true),
                pressione_quinto_metatarso: view.getUint16(12, true),
                segnale_uno: view.getUint16(14, true),
                segnale_due: view.getUint16(16, true)
            };

            // Log compatto ma informativo
            console.log(`[${timestamp}] Dati decodificati:`, {
                hex: buffer.toString('hex'),
                ...decodedData
            });

            return decodedData;

        } catch (error) {
            console.error(`[${timestamp}] Errore nella decodifica:`, error);
            throw error;
        }
    }

    async initialize() {
        if (this.bluetooth && this.adapter) {
            return;
        }

        try {
            const { bluetooth, destroy } = createBluetooth();
            this.bluetooth = bluetooth;
            this.destroy = destroy;
            this.adapter = await this.bluetooth.defaultAdapter();

            if (!this.adapter) {
                throw new Error('Nessun adattatore Bluetooth trovato');
            }

            const powered = await this.adapter.isPowered();
            if (!powered) {
                await this.adapter.setPowered(true);
            }

        } catch (error) {
            console.error('Errore durante l\'inizializzazione:', error);
            throw error;
        }
    }

    async readCharacteristicValue(address) {
        let device = null;
        try {
            device = await this.adapter.getDevice(address);

            console.log('Tentativo di connessione al dispositivo...');
            await device.connect();
            console.log('Connesso al dispositivo');

            const gattServer = await device.gatt();

            console.log('Ricerca del servizio...');
            const service = await gattServer.getPrimaryService(this.TARGET_SERVICE_UUID);

            console.log('Ricerca delle caratteristiche...');
            const characteristics = await service.characteristics();

            for (const charUUID of characteristics) {
                try {
                    console.log(`Configurazione notifiche per caratteristica ${charUUID}...`);
                    const characteristic = await service.getCharacteristic(charUUID);

                    characteristic.on('valuechanged', buffer => {
                        try {
                            const decodedData = this.decodeData(buffer);

                            // Esempio di come usare i dati decodificati
                            // console.log(JSON.stringify(decodedData, null, 2));

                            // Qui puoi aggiungere il codice per salvare i dati o inviarli dove necessario

                        } catch (error) {
                            console.error('Errore nella gestione dei dati BLE:', error);
                        }
                    });

                    // Avvia le notifiche
                    await characteristic.startNotifications();
                    console.log(`Notifiche attivate per ${charUUID}`);

                } catch (error) {
                    console.log(`Errore nella configurazione delle notifiche per ${charUUID}:`, error.message);
                }
            }

            // Ritorna il device per mantenere la connessione attiva
            return device;

        } catch (error) {
            console.error('Errore durante la configurazione delle caratteristiche:', error);
            if (device) {
                try {
                    await device.disconnect();
                } catch (disconnectError) {
                    console.error('Errore durante la disconnessione:', disconnectError);
                }
            }
            throw error;
        }
    }

    async getDeviceInfo(device, address) {
        try {
            const name = await device.getName().catch(() => 'Sconosciuto');
            const rssi = await device.getRSSI().catch(() => null);

            return {
                address,
                name,
                rssi: rssi ? `${rssi} dBm` : 'Non disponibile',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.log(`Info limitate per il dispositivo ${address}: ${error.message}`);
            return {
                address,
                name: 'Sconosciuto',
                rssi: 'Non disponibile',
                timestamp: new Date().toISOString()
            };
        }
    }

    async startScan(scanDuration = 10000) {
        if (this.isScanning) {
            console.log('Scansione già in corso...');
            return;
        }

        try {
            await this.initialize();

            console.log('Avvio scansione dispositivi BLE...');
            await this.adapter.startDiscovery();
            this.isScanning = true;

            // Imposta il timer per fermare la scansione
            this.scanTimer = setTimeout(() => {
                this.stopScan();
            }, scanDuration);

            while (this.isScanning) {
                const devices = await this.adapter.devices();

                for (const address of devices) {
                    if (!this.discoveredDevices.has(address)) {
                        try {
                            const device = await this.adapter.getDevice(address);
                            const deviceInfo = await this.getDeviceInfo(device, address);

                            this.discoveredDevices.set(address, deviceInfo);
                            console.log('Nuovo dispositivo trovato:');
                            console.log(`Indirizzo: ${deviceInfo.address}`);
                            console.log(`Nome: ${deviceInfo.name}`);
                            console.log(`RSSI: ${deviceInfo.rssi}`);
                            console.log(`Timestamp: ${deviceInfo.timestamp}`);
                            console.log('------------------------');
                        } catch (error) {
                            console.error(`Errore nel processare il dispositivo ${address}:`, error.message);
                        }
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            }

        } catch (error) {
            console.error('Errore durante la scansione:', error);
            await this.cleanup();
        }
    }

    async stopScan() {
        if (!this.isScanning) return;

        try {
            this.isScanning = false;
            if (this.scanTimer) {
                clearTimeout(this.scanTimer);
                this.scanTimer = null;
            }
            await this.adapter.stopDiscovery();
            console.log('\nScansione completata.');
            console.log(`Dispositivi trovati: ${this.discoveredDevices.size}`);
        } catch (error) {
            console.error('Errore durante l\'arresto della scansione:', error);
        }
    }

    async cleanup() {
        if (this.scanTimer) {
            clearTimeout(this.scanTimer);
            this.scanTimer = null;
        }
        if (this.destroy) {
            this.destroy();
        }
        this.bluetooth = null;
        this.adapter = null;
        this.isScanning = false;
    }

    getDiscoveredDevices() {
        return Array.from(this.discoveredDevices.values());
    }
}

function getUserInput(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function main() {
    const scanner = new BLEScanner();
    let activeDevice = null;
    let isRunning = true;


    // Gestione della chiusura pulita
    process.on('SIGINT', async () => {
        await handleExit(scanner, activeDevice);
    });

    try {
        // Avvia la scansione per 3 secondi
        console.log('Avvio scansione dispositivi...');
        await scanner.startScan(3000);

        // Attendi che la scansione sia completamente terminata
        await new Promise(resolve => setTimeout(resolve, 1000));

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

// Funzione per gestire l'uscita
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

// Funzione per mostrare le statistiche
function showStatistics(scanner) {
    if (!scanner || typeof scanner.startTime === 'undefined') {
        console.log('\n--- Statistiche ---');
        console.log('Nessun dato disponibile');
        console.log('----------------\n');
        return;
    }

    const currentTime = Date.now();
    const acquisitionTime = scanner.startTime ?
        Math.floor((currentTime - scanner.startTime) / 1000) : 0;

    console.log('\n--- Statistiche ---');
    console.log(`Dati ricevuti: ${scanner.dataCounter || 0}`);
    console.log(`Tempo di acquisizione: ${acquisitionTime} secondi`);
    console.log(`Media campioni/secondo: ${acquisitionTime > 0 ? ((scanner.dataCounter || 0) / acquisitionTime).toFixed(2) : 0}`);
    console.log('----------------\n');
}

// Funzione per mostrare l'help
function showHelp() {
    console.log('\n--- Comandi disponibili ---');
    console.log('q - Esci dal programma');
    console.log('h - Mostra questo menu');
    console.log('------------------------\n');
}


// Funzione per ottenere l'input dell'utente
function getUserInput(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

main();