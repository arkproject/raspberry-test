const { BLEConnection } = require('./BLEConnection');
const BLEDiscovery = require('./BLEDiscovery');
const FileLogger = require('../logger/FileLogger');
const { TARGET_SERVICE_UUID } = require('../config/constants');
const { getCurrentTimestamp } = require('../utils/dateUtils');
const { BLEError, handleError, ErrorCodes } = require('../utils/errorHandler');
const settings = require('../config/settings');

class BLEScanner {
        /**
     * @param {BLEEventManager} eventManager - Gestore degli eventi BLE
     */
    constructor(eventManager) {
        if (!eventManager) {
            throw new BLEError(
                'EventManager è richiesto',
                ErrorCodes.BLE.INVALID_PARAMETER
            );
        }
        
        this.eventManager = eventManager;
        this.bleConnection = new BLEConnection(eventManager);
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
            // Utilizziamo la nuova classe BLEConnection per l'inizializzazione
            await this.connection.initialize();
            this.adapter = this.connection.getAdapter();
            return true;

        } catch (error) {
            handleError(
                new BLEError(
                    'BLEScanner initialization failed',
                    ErrorCodes.BLE.INITIALIZATION_FAILED,
                    { error: error.message }
                ),
                'BLEScanner.initialize'
            );
            await this.cleanup();
            return false;
        }
    }

    // Metodi per la gestione dei listener dei dispositivi
    addDeviceListener(device, eventName, listener) {
        const key = `${device.address}_${eventName}`;
        this.removeDeviceListener(device, eventName);
        device.on(eventName, listener);
        this.deviceListeners.set(key, { device, eventName, listener });
    }

    removeDeviceListener(device, eventName) {
        const key = `${device.address}_${eventName}`;
        const listenerInfo = this.deviceListeners.get(key);
        if (listenerInfo) {
            listenerInfo.device.removeListener(eventName, listenerInfo.listener);
            this.deviceListeners.delete(key);
        }
    }

    removeAllDeviceListeners(device) {
        for (const [key, listenerInfo] of this.deviceListeners.entries()) {
            if (listenerInfo.device.address === device.address) {
                listenerInfo.device.removeListener(listenerInfo.eventName, listenerInfo.listener);
                this.deviceListeners.delete(key);
            }
        }
    }

    async findTargetDevice() {
        try {
            console.log(`\nRicerca dispositivo ${settings.TARGET_DEVICE.NAME}...`);
            await this.ensureDiscoveryStopped();
            await this.safeStartDiscovery();

            const scanStartTime = Date.now();

            while (Date.now() - scanStartTime < settings.TARGET_DEVICE.SCAN_TIMEOUT) {
                const devices = await this.adapter.devices();

                for (const address of devices) {
                    try {
                        const device = await this.adapter.getDevice(address);

                        const name = await Promise.race([
                            device.getName(),
                            new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('getName timeout')), 1000)
                            )
                        ]).catch(() => null);

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
                        console.log(`Errore nel processare il dispositivo ${address}:`, error.message);
                        continue;
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 500));
            }

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

    async autoConnectToTarget() {
        try {
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
            await this.safeStartDiscovery();
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
                            console.log(`Errore nel processare il dispositivo ${address}:`, error.message);
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

    async safeStartDiscovery() {
        try {
            const isDiscovering = await this.adapter.isDiscovering()
                .catch(() => false);

            if (isDiscovering) {
                await this.adapter.stopDiscovery()
                    .catch(e => console.log('Errore nel fermare la discovery:', e.message));
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Rimuoviamo il console.log da qui
            await this.adapter.startDiscovery();
            return true;
        } catch (error) {
            if (error.message.includes('No discovery started')) {
                return true;
            }
            throw error;
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

            // Reset delle strutture dati
            this.discoveredDevices.clear();
            console.log('\nAvvio scansione dispositivi BLE...');

            await this.safeStartDiscovery();
            this.isScanning = true;

            return new Promise(async (resolve) => {
                this.scanTimer = setTimeout(() => {
                    this.stopScan();
                    resolve(this.getDiscoveredDevices());
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
                                console.log(`Errore nel processare il dispositivo ${address}:`, error.message);
                                continue;
                            }
                        }
                    }

                    // Pausa tra le iterazioni per non sovraccaricare il sistema
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            });

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
            return [];
        }
    }

    async connectAndSetup(device) {
        try {
            console.log('\nConnessione al dispositivo...');
            await device.connect();
            this.targetDevice = device;
            this.isConnected = true;
            console.log('Connesso!');

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

    async getDeviceInfo(device, address) {
        try {
            // Nome dispositivo
            const name = await Promise.race([
                device.getName(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('getName timeout')), 2000)
                )
            ]).catch(() => 'Sconosciuto');

            // RSSI con gestione alternativa
            let rssi = null;
            try {
                // Prima proviamo il metodo standard
                rssi = await Promise.race([
                    device.getRSSI(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('getRSSI timeout')), 1000)
                    )
                ]);
            } catch (rssiError) {
                // Se fallisce, proviamo a ottenere l'RSSI dalle properties
                try {
                    const properties = await device.getProperties();
                    if (properties && properties.RSSI) {
                        rssi = properties.RSSI;
                        console.log(`Debug - RSSI ottenuto dalle properties per ${address}: ${rssi}`);
                    } else {
                        // Proviamo a leggere l'RSSI come attributo diretto
                        rssi = device.RSSI || null;
                        if (rssi) {
                            console.log(`Debug - RSSI ottenuto come attributo per ${address}: ${rssi}`);
                        }
                    }
                } catch (propError) {
                    console.log(`Debug - Anche il tentativo con properties fallito per ${address}: ${propError.message}`);
                }
            }

            const deviceInfo = {
                address,
                name: name || 'Sconosciuto',
                rssi: rssi !== null ? `${rssi} dBm` : 'Non disponibile',
                timestamp: getCurrentTimestamp()
            };

            console.log(`Debug - Device info completo per ${address}:`, {
                name: deviceInfo.name,
                rssi: deviceInfo.rssi,
                rssiType: rssi !== null ? 'numerico' : 'non disponibile'
            });

            return deviceInfo;

        } catch (error) {
            console.log(`Debug - Errore critico in getDeviceInfo per ${address}:`, error.message);
            return {
                address,
                name: 'Sconosciuto',
                rssi: 'Non disponibile',
                timestamp: getCurrentTimestamp()
            };
        }
    }

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

    async cleanup() {
        if (this.isCleaningUp) return; // Previene cleanup multipli
        this.isCleaningUp = true;

        try {
            if (this.scanTimer) {
                clearTimeout(this.scanTimer);
                this.scanTimer = null;
            }

            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            // Rimuovi tutti i listener
            for (const [key, listenerInfo] of this.deviceListeners.entries()) {
                listenerInfo.device.removeListener(listenerInfo.eventName, listenerInfo.listener);
                this.deviceListeners.delete(key);
            }

            await this.disconnect();
            await this.connection.cleanup();

            this.discoveredDevices.clear();
            this.isScanning = false;
            this.adapter = null;
        } finally {
            this.isCleaningUp = false;
        }
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
            session: {
                currentFile: this.getCurrentLogFile()
            }
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

    async ensureDiscoveryStopped() {
        if (!this.adapter) return;

        try {
            const isDiscovering = await this.adapter.isDiscovering();
            if (isDiscovering) {
                await this.adapter.stopDiscovery();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            this.isScanning = false;
        } catch (error) {
            console.log('Errore nel fermare la discovery:', error.message);
        }
    }
}

module.exports = BLEScanner;