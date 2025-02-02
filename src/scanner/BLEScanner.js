const { createBluetooth } = require('node-ble');
const FileLogger = require('../logger/FileLogger');
const { TARGET_SERVICE_UUID } = require('../config/constants');
const { getCurrentTimestamp } = require('../utils/dateUtils');
const { BLEError, handleError, ErrorCodes } = require('../utils/errorHandler');
const settings = require('../config/settings');

class BLEScanner {
    constructor() {
        this.bluetooth = null;
        this.adapter = null;
        this.isScanning = false;
        this.discoveredDevices = new Map();
        this.TARGET_SERVICE_UUID = TARGET_SERVICE_UUID;
        this.scanTimer = null;
        this.dataCounter = 0;
        this.startTime = null;
        this.logger = new FileLogger();
        this.targetDevice = null;
        this.isConnected = false;
        this.reconnectTimer = null;
        this.deviceListeners = new Map(); // Per tenere traccia dei listener
        // Aumenta il limite dei listener per l'applicazione
        require('events').EventEmitter.defaultMaxListeners = 15;
    }

    async initialize() {
        try {
            // Reset if already initialized
            if (this.bluetooth || this.adapter) {
                await this.resetBluetooth();
            }

            console.log('Initializing Bluetooth...');
            const { bluetooth, destroy } = createBluetooth();
            this.bluetooth = bluetooth;
            this.destroy = destroy;

            // Try to get adapter with retries
            let retries = 0;
            const maxRetries = 3;
            
            while (retries < maxRetries) {
                try {
                    console.log('Looking for Bluetooth adapter...');
                    this.adapter = await this.bluetooth.defaultAdapter();
                    break;
                } catch (error) {
                    retries++;
                    if (retries === maxRetries) throw error;
                    console.log(`Attempt ${retries}/${maxRetries} failed, retrying...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (!this.adapter) {
                throw new BLEError(
                    'No Bluetooth adapter found',
                    ErrorCodes.BLE.INITIALIZATION_FAILED
                );
            }

            // Power on adapter if needed
            const powered = await this.adapter.isPowered();
            if (!powered) {
                console.log('Powering on Bluetooth adapter...');
                await this.adapter.setPowered(true);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Ensure no discovery is running
            try {
                const discovering = await this.adapter.isDiscovering();
                if (discovering) {
                    console.log('Stopping previous discovery...');
                    await this.adapter.stopDiscovery();
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (error) {
                console.log('Error checking discovery state:', error.message);
                try {
                    await this.adapter.stopDiscovery();
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (stopError) {
                    console.log('Error stopping discovery:', stopError.message);
                }
            }

            console.log('Bluetooth initialization completed');
            return true;

        } catch (error) {
            handleError(
                new BLEError(
                    'Bluetooth initialization failed',
                    ErrorCodes.BLE.INITIALIZATION_FAILED,
                    { error: error.message }
                ),
                'BLEScanner.initialize'
            );
            throw error;
        }
    }

    async resetBluetooth() {
        console.log('Resetting Bluetooth state...');
        try {
            // Cleanup timers
            if (this.scanTimer) {
                clearTimeout(this.scanTimer);
                this.scanTimer = null;
            }
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            // Stop discovery if running
            if (this.adapter) {
                try {
                    const discovering = await this.adapter.isDiscovering();
                    if (discovering) {
                        await this.adapter.stopDiscovery();
                    }
                } catch (error) {
                    console.log('Error checking discovery state:', error.message);
                }
            }

            // Disconnect any connected device
            if (this.targetDevice && this.isConnected) {
                try {
                    await this.targetDevice.disconnect();
                } catch (error) {
                    console.log('Error disconnecting device:', error.message);
                }
            }

            // Reset internal state
            if (this.destroy) {
                this.destroy();
            }
            this.bluetooth = null;
            this.adapter = null;
            this.isScanning = false;
            this.targetDevice = null;
            this.isConnected = false;
            this.discoveredDevices.clear();

            // Wait for everything to settle
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log('Bluetooth reset completed');
            
        } catch (error) {
            console.error('Error during Bluetooth reset:', error);
        }
    }

    async safeStartDiscovery() {
        try {
            // Prima verifica se c'è già una discovery in corso
            const isDiscovering = await this.adapter.isDiscovering()
                .catch(() => false); // Se c'è un errore, assumiamo che non ci sia discovery

            if (isDiscovering) {
                console.log('Discovery già in corso, la fermo...');
                await this.adapter.stopDiscovery()
                    .catch(e => console.log('Errore nel fermare la discovery:', e.message));
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Ora possiamo avviare la nuova discovery
            console.log('Avvio scansione dispositivi BLE...');
            await this.adapter.startDiscovery();
            return true;
        } catch (error) {
            if (error.message.includes('No discovery started')) {
                // Ignora questo errore specifico e procedi
                return true;
            }
            throw error; // Rilancia altri errori
        }
    }

    // Nuovo metodo per la gestione dei listener
    addDeviceListener(device, eventName, listener) {
        const key = `${device.address}_${eventName}`;

        // Rimuovi eventuali listener precedenti
        this.removeDeviceListener(device, eventName);

        // Aggiungi il nuovo listener
        device.on(eventName, listener);

        // Salva il riferimento
        this.deviceListeners.set(key, {
            device,
            eventName,
            listener
        });
    }

    // Metodo per rimuovere i listener
    removeDeviceListener(device, eventName) {
        const key = `${device.address}_${eventName}`;
        const listenerInfo = this.deviceListeners.get(key);

        if (listenerInfo) {
            listenerInfo.device.removeListener(eventName, listenerInfo.listener);
            this.deviceListeners.delete(key);
        }
    }

    // Metodo per rimuovere tutti i listener di un dispositivo
    removeAllDeviceListeners(device) {
        for (const [key, listenerInfo] of this.deviceListeners.entries()) {
            if (listenerInfo.device.address === device.address) {
                listenerInfo.device.removeListener(listenerInfo.eventName, listenerInfo.listener);
                this.deviceListeners.delete(key);
            }
        }
    }

    async autoConnectToTarget() {
        try {
            console.log(`\nRicerca dispositivo ${settings.TARGET_DEVICE.NAME}...`);

            for (let attempt = 1; attempt <= settings.TARGET_DEVICE.RETRY_ATTEMPTS; attempt++) {
                console.log(`\nTentativo ${attempt} di ${settings.TARGET_DEVICE.RETRY_ATTEMPTS}`);

                const device = await this.findTargetDevice();
                if (device) {
                    await this.connectAndSetup(device);
                    return true;
                }

                if (attempt < settings.TARGET_DEVICE.RETRY_ATTEMPTS) {
                    console.log(`\nAttesa ${settings.TARGET_DEVICE.RETRY_DELAY / 1000} secondi prima del prossimo tentativo...`);
                    await new Promise(resolve => setTimeout(resolve, settings.TARGET_DEVICE.RETRY_DELAY));
                }
            }

            throw new BLEError(
                `Dispositivo ${settings.TARGET_DEVICE.NAME} non trovato dopo ${settings.TARGET_DEVICE.RETRY_ATTEMPTS} tentativi`,
                ErrorCodes.BLE.DEVICE_NOT_FOUND
            );

        } catch (error) {
            handleError(error, 'autoConnectToTarget');
            return false;
        }
    }

    async findTargetDevice() {
        try {
            // Reset completo prima di iniziare
            await this.resetBluetooth();
            await this.initialize();

            // Usa il nuovo metodo per avviare la discovery in modo sicuro
            await this.safeStartDiscovery();
            const scanStartTime = Date.now();

            while (Date.now() - scanStartTime < settings.TARGET_DEVICE.SCAN_TIMEOUT) {
                const devices = await this.adapter.devices();

                for (const address of devices) {
                    try {
                        const device = await this.adapter.getDevice(address);
                        
                        // Usa una Promise.race con timeout per getName
                        const name = await Promise.race([
                            device.getName(),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('getName timeout')), 1000)
                            )
                        ]).catch(() => null);

                        // Usa una Promise.race con timeout per getRSSI
                        const rssi = await Promise.race([
                            device.getRSSI(),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('getRSSI timeout')), 1000)
                            )
                        ]).catch(() => null);

                        if (name === settings.TARGET_DEVICE.NAME) {
                            if (rssi && rssi >= settings.TARGET_DEVICE.SIGNAL_STRENGTH_THRESHOLD) {
                                console.log(`\nDispositivo trovato!`);
                                console.log(`Nome: ${name}`);
                                console.log(`Indirizzo: ${address}`);
                                console.log(`Potenza segnale: ${rssi} dBm`);

                                await this.adapter.stopDiscovery()
                                    .catch(e => console.log('Errore nel fermare la discovery:', e.message));
                                return device;
                            } else {
                                console.log(`\nDispositivo trovato ma segnale troppo debole (${rssi} dBm)`);
                            }
                        }
                    } catch (error) {
                        // Log dell'errore ma continua con il prossimo dispositivo
                        console.log(`Errore nel processare il dispositivo ${address}:`, error.message);
                        continue;
                    }
                }

                // Piccola pausa tra le iterazioni per non sovraccaricare il sistema
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Ferma la discovery alla fine della scansione
            await this.adapter.stopDiscovery()
                .catch(e => console.log('Errore nel fermare la discovery:', e.message));
            return null;

        } catch (error) {
            handleError(new BLEError(
                'Errore durante la ricerca del dispositivo',
                ErrorCodes.BLE.SCAN_FAILED,
                { error: error.message }
            ), 'findTargetDevice');
            
            try {
                await this.adapter.stopDiscovery();
            } catch (stopError) {
                // Ignora errori nel fermare la discovery in caso di errore
            }
            return null;
        }
    }

    async ensureDiscoveryStopped() {
        try {
            const maxAttempts = 3;
            for (let i = 0; i < maxAttempts; i++) {
                const discovering = await this.adapter.isDiscovering();
                if (discovering) {
                    await this.adapter.stopDiscovery();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    return true;
                }
            }
            return false;
        } catch (error) {
            handleError(
                new BLEError(
                    'Errore nel fermare la discovery',
                    ErrorCodes.BLE.SCAN_FAILED,
                    { error: error.message }
                ),
                'BLEScanner.ensureDiscoveryStopped'
            );
            return false;
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

            // Verifica se la discovery è effettivamente in corso prima di fermarla
            const discovering = await this.adapter.isDiscovering();
            if (discovering) {
                await this.adapter.stopDiscovery();
            }

            console.log('\nScansione completata.');
            console.log(`Dispositivi trovati: ${this.discoveredDevices.size}`);
        } catch (error) {
            handleError(
                new BLEError(
                    'Errore durante l\'arresto della scansione',
                    ErrorCodes.BLE.SCAN_FAILED,
                    { error: error.message }
                ),
                'BLEScanner.stopScan'
            );
        }
    }

    async connectAndSetup(device) {
        try {
            console.log('\nConnessione al dispositivo...');
            await device.connect();
            this.targetDevice = device;
            this.isConnected = true;
            console.log('Connesso!');

            // Setup riconnessione automatica
            if (settings.TARGET_DEVICE.AUTO_RECONNECT) {
                const disconnectListener = async () => {
                    handleError(
                        new BLEError(
                            'Connessione persa',
                            ErrorCodes.BLE.DISCONNECT_ERROR,
                            { deviceName: device.name, deviceAddress: device.address }
                        ),
                        'BLEScanner.deviceDisconnect'
                    );

                    this.isConnected = false;
                    clearTimeout(this.reconnectTimer);

                    this.reconnectTimer = setTimeout(async () => {
                        await this.autoConnectToTarget();
                    }, settings.TARGET_DEVICE.RETRY_DELAY);
                };

                this.addDeviceListener(device, 'disconnect', disconnectListener);
            }

            const gattServer = await device.gatt();
            console.log('Ricerca servizio...');
            const service = await gattServer.getPrimaryService(this.TARGET_SERVICE_UUID);

            console.log('Configurazione caratteristiche...');
            const characteristics = await service.characteristics();

            for (const charUUID of characteristics) {
                try {
                    console.log(`Configurazione notifiche per caratteristica ${charUUID}...`);
                    const characteristic = await service.getCharacteristic(charUUID);

                    const valueChangedListener = buffer => {
                        try {
                            this.decodeData(buffer);
                        } catch (error) {
                            handleError(
                                new BLEError(
                                    'Errore nella decodifica dei dati',
                                    ErrorCodes.BLE.NOTIFICATION_ERROR,
                                    {
                                        characteristicUUID: charUUID,
                                        error: error.message,
                                        buffer: buffer.toString('hex')
                                    }
                                ),
                                'BLEScanner.valueChanged'
                            );
                        }
                    };

                    this.addDeviceListener(characteristic, 'valuechanged', valueChangedListener);
                    await characteristic.startNotifications();
                    console.log(`Notifiche attivate per ${charUUID}`);
                } catch (error) {
                    handleError(
                        new BLEError(
                            'Errore configurazione caratteristica',
                            ErrorCodes.BLE.CHARACTERISTIC_ERROR,
                            {
                                characteristicUUID: charUUID,
                                error: error.message
                            }
                        ),
                        'BLEScanner.setupCharacteristic'
                    );
                }
            }

            console.log('\nAcquisizione dati avviata!');
            return true;

        } catch (error) {
            handleError(
                new BLEError(
                    'Errore durante la connessione',
                    ErrorCodes.BLE.CONNECTION_FAILED,
                    {
                        deviceName: device.name,
                        deviceAddress: device.address,
                        error: error.message
                    }
                ),
                'BLEScanner.connectAndSetup'
            );
            return false;
        }
    }

    async disconnect() {
        if (this.targetDevice && this.isConnected) {
            try {
                // Rimuovi tutti i listener prima della disconnessione
                this.removeAllDeviceListeners(this.targetDevice);
                
                await this.targetDevice.disconnect();
                this.isConnected = false;
                this.targetDevice = null;
                console.log('Dispositivo disconnesso');
                return true;
            } catch (error) {
                handleError(
                    new BLEError(
                        'Errore durante la disconnessione',
                        ErrorCodes.BLE.DISCONNECT_ERROR,
                        { error: error.message }
                    ),
                    'BLEScanner.disconnect'
                );
                return false;
            }
        }
        return true;
    }



    async forceStopDiscovery() {
        if (!this.adapter) return;
        
        try {
            await this.adapter.stopDiscovery();
        } catch (error) {
            console.log('Errore nel fermare la discovery:', error.message);
        }
        
        // Attendere un po' per assicurarsi che la discovery sia effettivamente fermata
        await new Promise(resolve => setTimeout(resolve, 2000));
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

    //         for (const charUUID of characteristics) {
    //             try {
    //                 console.log(`Configurazione notifiche per caratteristica ${charUUID}...`);
    //                 const characteristic = await service.getCharacteristic(charUUID);

    //                 characteristic.on('valuechanged', buffer => {
    //                     try {
    //                         this.decodeData(buffer);
    //                     } catch (error) {
    //                         console.error('Errore nella gestione dei dati BLE:', error);
    //                     }
    //                 });

    //                 await characteristic.startNotifications();
    //                 console.log(`Notifiche attivate per ${charUUID}`);

    //             } catch (error) {
    //                 console.log(`Errore nella configurazione delle notifiche per ${charUUID}:`, error.message);
    //             }
    //         }

    //         return device;

    //     } catch (error) {
    //         console.error('Errore durante la configurazione delle caratteristiche:', error);
    //         if (device) {
    //             try {
    //                 await device.disconnect();
    //             } catch (disconnectError) {
    //                 console.error('Errore durante la disconnessione:', disconnectError);
    //             }
    //         }
    //         throw error;
    //     }
    // }

    decodeData(buffer) {
        const timestamp = getCurrentTimestamp();

        try {
            if (buffer.length < 20) {
                throw new BLEError(
                    'Buffer troppo corto',
                    ErrorCodes.BLE.NOTIFICATION_ERROR,
                    {
                        expectedLength: 20,
                        actualLength: buffer.length,
                        buffer: buffer.toString('hex')
                    }
                );
            }

            this.dataCounter++;
            if (!this.startTime) {
                this.startTime = Date.now();
            }

            const view = new DataView(buffer.buffer, buffer.byteOffset);

            const decodedData = {
                timestamp,
                numero_progressivo: view.getUint16(0, false),
                asse_x: view.getInt16(2, true),
                asse_y: view.getInt16(4, true),
                asse_z: view.getInt16(6, true),
                pressione_tallone: view.getUint16(8, true),
                pressione_primo_metatarso: view.getUint16(10, true),
                pressione_quinto_metatarso: view.getUint16(12, true),
                segnale_uno: view.getUint16(14, true),
                segnale_due: view.getUint16(16, true),
                raw_hex: buffer.toString('hex')
            };

            this.logger.writeData(decodedData);

            return decodedData;

        } catch (error) {
            handleError(
                error instanceof BLEError ? error :
                    new BLEError(
                        'Errore nella decodifica dei dati',
                        ErrorCodes.BLE.NOTIFICATION_ERROR,
                        {
                            error: error.message,
                            buffer: buffer.toString('hex')
                        }
                    ),
                'BLEScanner.decodeData'
            );
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
                timestamp: getCurrentTimestamp()
            };
        } catch (error) {
            handleError(
                new BLEError(
                    'Errore nel recupero info dispositivo',
                    ErrorCodes.BLE.DEVICE_NOT_FOUND,
                    {
                        deviceAddress: address,
                        error: error.message
                    }
                ),
                'BLEScanner.getDeviceInfo'
            );
            return {
                address,
                name: 'Sconosciuto',
                rssi: 'Non disponibile',
                timestamp: getCurrentTimestamp()
            };
        }
    }

    async startScan(scanDuration = 10000) {
        if (this.isScanning) {
            handleError(
                new BLEError(
                    'Scansione già in corso',
                    ErrorCodes.BLE.SCAN_FAILED,
                    { scanDuration }
                ),
                'BLEScanner.startScan'
            );
            return;
        }

        try {
            await this.initialize();

            console.log('Avvio scansione dispositivi BLE...');
            await this.adapter.startDiscovery();
            this.isScanning = true;

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
                            handleError(
                                new BLEError(
                                    'Errore nel processare il dispositivo',
                                    ErrorCodes.BLE.DEVICE_NOT_FOUND,
                                    {
                                        deviceAddress: address,
                                        error: error.message
                                    }
                                ),
                                'BLEScanner.startScan.processDevice'
                            );
                        }
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            }

        } catch (error) {
            handleError(
                new BLEError(
                    'Errore durante la scansione',
                    ErrorCodes.BLE.SCAN_FAILED,
                    { error: error.message }
                ),
                'BLEScanner.startScan'
            );
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
            handleError(
                new BLEError(
                    'Errore durante l\'arresto della scansione',
                    ErrorCodes.BLE.SCAN_FAILED,
                    { error: error.message }
                ),
                'BLEScanner.stopScan'
            );
        }
    }

    async cleanup() {
        if (this.scanTimer) {
            clearTimeout(this.scanTimer);
            this.scanTimer = null;
        }

        // Rimuovi tutti i listener
        for (const [key, listenerInfo] of this.deviceListeners.entries()) {
            listenerInfo.device.removeListener(listenerInfo.eventName, listenerInfo.listener);
            this.deviceListeners.delete(key);
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

    getCurrentLogFile() {
        return this.logger.getFilePath();
    }

    getStatistics() {
        const currentTime = Date.now();
        const acquisitionTime = this.startTime ?
            Math.floor((currentTime - this.startTime) / 1000) : 0;

        return {
            dataCounter: this.dataCounter,
            acquisitionTime,
            samplesPerSecond: acquisitionTime > 0 ?
                (this.dataCounter / acquisitionTime).toFixed(2) : 0,
            logFile: this.getCurrentLogFile()
        };
    }

    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            deviceName: this.targetDevice ? settings.TARGET_DEVICE.NAME : null,
            deviceAddress: this.targetDevice ? this.targetDevice.address : null,
            connectionTime: this.startTime ? new Date(this.startTime).toISOString() : null
        };
    }


}

module.exports = BLEScanner;