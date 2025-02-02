const { createBluetooth } = require('node-ble');
const readline = require('readline');

class BLEScanner {
    constructor() {
        this.bluetooth = null;
        this.adapter = null;
        this.isScanning = false;
        this.discoveredDevices = new Map();
        this.TARGET_SERVICE_UUID = "00000000-cc7a-482a-984a-7f2ed5b3e58f";
        this.scanTimer = null;
    }

    async initialize() {
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

    // async readCharacteristicValue(address) {
    //     let device = null;
    //     try {
    //         device = await this.adapter.getDevice(address);
    //         console.log('Tentativo di connessione al dispositivo...');
    //         await device.connect();
    //         console.log('Connesso al dispositivo');

    //         const gattServer = await device.gatt();

    //         console.log('Ricerca del servizio...');
    //         const service = await gattServer.getPrimaryService(this.TARGET_SERVICE_UUID);

    //         console.log('Ricerca delle caratteristiche...');
    //         const characteristics = await service.characteristics();

    //         let characteristicValues = [];
    //         for (const charUUID of characteristics) {
    //             try {
    //                 const characteristic = await service.getCharacteristic(charUUID);
    //                 const value = await characteristic.readValue();

    //                 characteristicValues.push({
    //                     uuid: charUUID,
    //                     value: Buffer.from(value).toString('hex')
    //                 });

    //                 // Opzionale: attiva le notifiche se la caratteristica lo supporta
    //                 const flags = await characteristic.getFlags();
    //                 if (flags.includes('notify')) {
    //                     await characteristic.startNotifications();
    //                     characteristic.on('valuechanged', buffer => {
    //                         console.log(`Notifica da ${charUUID}:`, buffer.toString('hex'));
    //                     });
    //                 }
    //             } catch (error) {
    //                 console.log(`Errore nella lettura della caratteristica ${charUUID}:`, error.message);
    //             }
    //         }

    //         return characteristicValues;
    //     } catch (error) {
    //         console.error('Errore durante la lettura delle caratteristiche:', error);
    //         return null;
    //     } finally {
    //         if (device) {
    //             try {
    //                 await device.disconnect();
    //                 console.log('Dispositivo disconnesso');
    //             } catch (error) {
    //                 console.error('Errore durante la disconnessione:', error);
    //             }
    //         }
    //     }
    // }
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

                    // Configura l'evento per le notifiche
                    characteristic.on('valuechanged', buffer => {
                        console.log(`[${new Date().toISOString()}] Nuovo valore per ${charUUID}:`);
                        console.log(`Valore: ${buffer.toString('hex')}`);
                        console.log('------------------------');
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
    
    // Gestione della chiusura pulita
    process.on('SIGINT', async () => {
        console.log('\nArresto del programma...');
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
    });

    try {
        // Avvia la scansione per 10 secondi
        console.log('Avvio scansione dispositivi...');
        await scanner.startScan(1000);

        // Attendi che la scansione sia completamente terminata
        await new Promise(resolve => setTimeout(resolve, 10100));

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
                // Assicurati che lo scanner sia pronto per una nuova operazione
                await scanner.initialize();
                
                // Configura le notifiche e mantieni la connessione
                activeDevice = await scanner.readCharacteristicValue(selectedDevice.address);
                
                console.log('\nIn attesa di notifiche...');
                console.log('Premi Ctrl+C per terminare\n');

                // Mantieni il programma in esecuzione
                await new Promise(resolve => {
                    // Questo promise non verrà mai risolto, 
                    // il programma terminerà solo quando l'utente preme Ctrl+C
                });

            } catch (error) {
                console.error('Errore durante la configurazione delle notifiche:', error);
            }
        } else {
            console.log('Selezione non valida');
        }

    } catch (error) {
        console.error('Errore nel programma principale:', error);
        await scanner.cleanup();
        process.exit(1);
    }
}

// async function main() {
//     const scanner = new BLEScanner();
//     let isRunning = true;

//     // Gestione della chiusura pulita
//     process.on('SIGINT', async () => {
//         console.log('\nArresto del programma...');
//         isRunning = false;  // Ferma il loop di lettura
//         await scanner.stopScan();
//         await scanner.cleanup();
//         process.exit(0);
//     });

//     try {
//         // Avvia la scansione per 2 secondi
//         console.log('Avvio scansione dispositivi...');
//         await scanner.startScan(2000);

//         // Attendi che la scansione sia completamente terminata
//         await new Promise(resolve => setTimeout(resolve, 1000));

//         // Mostra i dispositivi trovati
//         const devices = scanner.getDiscoveredDevices();
//         if (devices.length === 0) {
//             console.log('Nessun dispositivo trovato');
//             await scanner.cleanup();
//             process.exit(0);
//         }

//         console.log('\nDispositivi disponibili:');
//         devices.forEach((device, index) => {
//             console.log(`${index + 1}. ${device.name} (${device.address})`);
//         });

//         // Chiedi all'utente quale dispositivo vuole leggere
//         const deviceIndex = parseInt(await getUserInput('\nInserisci il numero del dispositivo da leggere: ')) - 1;

//         if (deviceIndex >= 0 && deviceIndex < devices.length) {
//             const selectedDevice = devices[deviceIndex];
//             console.log(`\nLettura caratteristiche per il dispositivo: ${selectedDevice.name}`);

//             try {
//                 // Assicurati che lo scanner sia pronto per una nuova operazione
//                 await scanner.initialize();

//                 console.log('\nInizio lettura continua delle caratteristiche...');
//                 console.log('Premi Ctrl+C per terminare\n');

//                 // Loop di lettura continua
//                 while (isRunning) {
//                     try {
//                         const characteristics = await scanner.readCharacteristicValue(selectedDevice.address);

//                         if (characteristics && characteristics.length > 0) {
//                             console.log(`\n[${new Date().toISOString()}] Caratteristiche lette:`);
//                             characteristics.forEach(char => {
//                                 console.log(`UUID: ${char.uuid}`);
//                                 console.log(`Valore: ${char.value}`);
//                                 console.log('------------------------');
//                             });
//                         } else {
//                             console.log('Nessuna caratteristica trovata o errore nella lettura');
//                         }

//                         // Attendi un intervallo prima della prossima lettura
//                         await new Promise(resolve => setTimeout(resolve, 100)); // Intervallo di 2 secondi tra le letture

//                     } catch (error) {
//                         console.error('Errore durante la lettura:', error);
//                         // Se c'è un errore, attendi un po' prima di riprovare
//                         await new Promise(resolve => setTimeout(resolve, 5000));
//                     }
//                 }
//             } catch (error) {
//                 console.error('Errore durante l\'inizializzazione della lettura:', error);
//             }
//         } else {
//             console.log('Selezione non valida');
//         }

//         // Pulisci le risorse
//         await scanner.cleanup();
//         process.exit(0);

//     } catch (error) {
//         console.error('Errore nel programma principale:', error);
//         await scanner.cleanup();
//         process.exit(1);
//     }
// }

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