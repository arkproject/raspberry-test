/**
 * BLEScanner.js
 * Scanner per dispositivi Bluetooth Low Energy
 * Integrazione con BLEDiscovery
 * 
 * Created: 2025-02-01 17:42:52
 * Author: arkproject 
 * Version: 2.0.0
 */

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
        this.bleDiscovery = new BLEDiscovery(eventManager);
        this.adapter = null;
        this.isScanning = false;
        this.TARGET_SERVICE_UUID = TARGET_SERVICE_UUID;
        this.dataCounter = 0;
        this.startTime = null;
        this.logger = new FileLogger();
        this.targetDevice = null;
        this.isConnected = false;
        this.reconnectTimer = null;
        this.deviceListeners = new Map();

        // Configurazione dei listener per gli eventi di discovery
        this.setupDiscoveryEventListeners();

        console.log('[BLEScanner] Initialized at:', getCurrentTimestamp());
    }

    /**
     * Configura i listener per gli eventi di discovery
     * @private
     */
    setupDiscoveryEventListeners() {
        this.eventManager.on('discovery:device_found', (data) => {
            // console.log('Dispositivo trovato:', {
            //     name: data.name,
            //     address: data.address,
            //     rssi: data.rssi
            // });
        });

        this.eventManager.on('discovery:search_timeout', (data) => {
            // console.log('\nRicerca dispositivo terminata per timeout:', {
            //     criteria: data.criteria,
            //     timeout: data.timeout
            // });
        });

        this.eventManager.on('discovery:error', (data) => {
            // console.error('\nErrore durante la discovery:', data.error);
        });
    }

    /**
     * Inizializza lo scanner
     * @returns {Promise<boolean>}
     */
    async initialize() {
        try {
            await this.bleConnection.initialize();
            this.adapter = this.bleConnection.getAdapter();
            this.bleDiscovery.setAdapter(this.adapter);

            this.eventManager.emit('scanner:initialized', {
                timestamp: getCurrentTimestamp()
            });

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

    /**
     * Cerca il dispositivo target
     * @returns {Promise<Object|null>}
     */
    async findTargetDevice() {
        try {
            console.log(`\nRicerca dispositivo ${settings.TARGET_DEVICE.NAME}...`);

            const criteria = {
                name: settings.TARGET_DEVICE.NAME,
                minRssi: settings.TARGET_DEVICE.SIGNAL_STRENGTH_THRESHOLD
            };

            return await this.bleDiscovery.findDevice(criteria);

        } catch (error) {
            handleError(
                new BLEError(
                    'Errore durante la ricerca del dispositivo',
                    ErrorCodes.BLE.SCAN_FAILED,
                    { error: error.message }
                ),
                'BLEScanner.findTargetDevice'
            );
            return null;
        }
    }

    /**
     * Avvia la scansione dei dispositivi
     * @param {number} scanDuration - Durata della scansione in ms
     * @returns {Promise<Array>}
     */
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
            return [];
        }
    
        try {
            await this.initialize();
            this.isScanning = true;
    
            this.eventManager.emit('scanner:scan_started', {
                duration: scanDuration,
                timestamp: getCurrentTimestamp()
            });
    
            // Utilizziamo BLEDiscovery per la scansione
            await this.bleDiscovery.startDiscovery();
    
            // Modifica qui: usa una Promise invece del setTimeout
            return new Promise((resolve) => {
                this.scanTimeout = setTimeout(async () => {
                    await this.stopScan();
                    resolve(this.bleDiscovery.getDiscoveredDevices());
                }, scanDuration);
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

    /**
     * Ferma la scansione in corso
     */
    async stopScan() {
        if (!this.isScanning) {
            console.log('StopDiscovery chiamato: la discovery non era attiva');
            return;
        }
    
        try {
            // Prima imposta isScanning a false
            this.isScanning = false;
            
            // Cancella il timeout se esiste
            if (this.scanTimeout) {
                clearTimeout(this.scanTimeout);
                this.scanTimeout = null;
            }
    
            // Poi ferma la discovery
            await this.bleDiscovery.stopDiscovery();
    
            this.eventManager.emit('scanner:scan_stopped', {
                devicesFound: this.bleDiscovery.getDiscoveredDevices().length,
                timestamp: getCurrentTimestamp()
            });
    
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

    /**
     * Tenta la connessione automatica al dispositivo target
     * @returns {Promise<boolean>}
     */
    async autoConnectToTarget() {
        try {
            for (let attempt = 1; attempt <= settings.TARGET_DEVICE.RETRY_ATTEMPTS; attempt++) {
                this.eventManager.emit('scanner:connect_attempt', {
                    attempt,
                    maxAttempts: settings.TARGET_DEVICE.RETRY_ATTEMPTS,
                    timestamp: getCurrentTimestamp()
                });

                const device = await this.findTargetDevice();
                if (device) {
                    await this.connectAndSetup(device);
                    return true;
                }

                if (attempt < settings.TARGET_DEVICE.RETRY_ATTEMPTS) {
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

    /**
     * Connette e configura un dispositivo
     * @param {Object} device - Dispositivo da connettere
     * @returns {Promise<boolean>}
     */
    async connectAndSetup(device) {
        try {
            this.eventManager.emit('scanner:connecting', {
                deviceAddress: device.address,
                timestamp: getCurrentTimestamp()
            });

            await device.connect();
            this.targetDevice = device;
            this.isConnected = true;

            this.eventManager.emit('scanner:connected', {
                deviceAddress: device.address,
                timestamp: getCurrentTimestamp()
            });

            // Setup riconnessione automatica
            if (settings.TARGET_DEVICE.AUTO_RECONNECT) {
                this.setupAutoReconnect(device);
            }

            const gattServer = await device.gatt();

            this.eventManager.emit('scanner:gatt_connected', {
                deviceAddress: device.address,
                timestamp: getCurrentTimestamp()
            });

            console.log('Ricerca servizio...');
            const service = await gattServer.getPrimaryService(this.TARGET_SERVICE_UUID);

            this.eventManager.emit('scanner:service_found', {
                serviceUUID: this.TARGET_SERVICE_UUID,
                timestamp: getCurrentTimestamp()
            });

            await this.setupCharacteristics(service);

            this.startTime = Date.now();
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

    /**
     * Configura la riconnessione automatica
     * @private
     */
    setupAutoReconnect(device) {
        const disconnectListener = async () => {
            this.eventManager.emit('scanner:connection_lost', {
                deviceAddress: device.address,
                timestamp: getCurrentTimestamp()
            });

            this.isConnected = false;
            clearTimeout(this.reconnectTimer);

            this.reconnectTimer = setTimeout(async () => {
                await this.autoConnectToTarget();
            }, settings.TARGET_DEVICE.RETRY_DELAY);
        };

        this.addDeviceListener(device, 'disconnect', disconnectListener);
    }

    /**
     * Configura le caratteristiche del servizio
     * @private
     */
    async setupCharacteristics(service) {
        const characteristics = await service.characteristics();

        for (const charUUID of characteristics) {
            try {
                const characteristic = await service.getCharacteristic(charUUID);
                await this.setupCharacteristicNotifications(characteristic);

                this.eventManager.emit('scanner:characteristic_configured', {
                    characteristicUUID: charUUID,
                    timestamp: getCurrentTimestamp()
                });

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
                    'BLEScanner.setupCharacteristics'
                );
            }
        }
    }

    /**
     * Configura le notifiche per una caratteristica
     * @private
     */
    async setupCharacteristicNotifications(characteristic) {
        const valueChangedListener = buffer => {
            try {
                const decodedData = this.decodeData(buffer);
                this.eventManager.emit('scanner:data_received', {
                    characteristicUUID: characteristic.uuid,
                    data: decodedData,
                    timestamp: getCurrentTimestamp()
                });
            } catch (error) {
                handleError(
                    new BLEError(
                        'Errore nella decodifica dei dati',
                        ErrorCodes.BLE.NOTIFICATION_ERROR,
                        {
                            characteristicUUID: characteristic.uuid,
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
    }

    /**
     * Gestisce i listener dei dispositivi
     * @param {Object} device - Dispositivo o caratteristica
     * @param {string} eventName - Nome dell'evento
     * @param {Function} listener - Funzione listener
     */
    addDeviceListener(device, eventName, listener) {
        const key = `${device.address || device.uuid}_${eventName}`;
        this.removeDeviceListener(device, eventName);
        device.on(eventName, listener);
        this.deviceListeners.set(key, { device, eventName, listener });

        this.eventManager.emit('scanner:listener_added', {
            deviceId: device.address || device.uuid,
            eventName,
            timestamp: getCurrentTimestamp()
        });
    }

    /**
     * Rimuove un listener
     * @param {Object} device - Dispositivo o caratteristica
     * @param {string} eventName - Nome dell'evento
     */
    removeDeviceListener(device, eventName) {
        const key = `${device.address || device.uuid}_${eventName}`;
        const listenerInfo = this.deviceListeners.get(key);
        if (listenerInfo) {
            listenerInfo.device.removeListener(eventName, listenerInfo.listener);
            this.deviceListeners.delete(key);

            this.eventManager.emit('scanner:listener_removed', {
                deviceId: device.address || device.uuid,
                eventName,
                timestamp: getCurrentTimestamp()
            });
        }
    }

    /**
     * Rimuove tutti i listener di un dispositivo
     * @param {Object} device - Dispositivo o caratteristica
     */
    removeAllDeviceListeners(device) {
        const removedCount = 0;
        for (const [key, listenerInfo] of this.deviceListeners.entries()) {
            if (listenerInfo.device.address === device.address ||
                listenerInfo.device.uuid === device.uuid) {
                listenerInfo.device.removeListener(listenerInfo.eventName, listenerInfo.listener);
                this.deviceListeners.delete(key);
                removedCount++;
            }
        }

        this.eventManager.emit('scanner:all_listeners_removed', {
            deviceId: device.address || device.uuid,
            count: removedCount,
            timestamp: getCurrentTimestamp()
        });
    }

    /**
     * Disconnette dal dispositivo
     * @returns {Promise<boolean>}
     */
    async disconnect() {
        if (this.targetDevice && this.isConnected) {
            try {
                this.removeAllDeviceListeners(this.targetDevice);
                await this.targetDevice.disconnect();
                this.isConnected = false;
                this.targetDevice = null;

                this.eventManager.emit('scanner:disconnected', {
                    timestamp: getCurrentTimestamp()
                });

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

    /**
     * Pulisce le risorse utilizzate
     */
    async cleanup() {
        try {
            this.eventManager.emit('scanner:cleanup_start', {
                timestamp: getCurrentTimestamp()
            });
    
            // Cancella il timeout di scansione se esiste
            if (this.scanTimeout) {
                clearTimeout(this.scanTimeout);
                this.scanTimeout = null;
            }
    
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
    
            // Se sta ancora scansionando, ferma la scansione
            if (this.isScanning) {
                await this.stopScan();
            }
    
            await this.disconnect();
            await this.bleDiscovery.cleanup();
            await this.bleConnection.cleanup();
    
            this.isScanning = false;
            this.adapter = null;
    
            this.eventManager.emit('scanner:cleanup_complete', {
                timestamp: getCurrentTimestamp()
            });
    
        } catch (error) {
            this.eventManager.emit('scanner:cleanup_error', {
                error: error.message,
                timestamp: getCurrentTimestamp()
            });
        }
    }

    /**
     * Restituisce le statistiche di acquisizione
     * @returns {Object}
     */
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

    /**
     * Restituisce lo stato della connessione
     * @returns {Object}
     */
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            deviceName: this.targetDevice ? settings.TARGET_DEVICE.NAME : null,
            deviceAddress: this.targetDevice ? this.targetDevice.address : null,
            connectionTime: this.startTime ? new Date(this.startTime).toISOString() : null
        };
    }

    /**
     * Restituisce il file di log corrente
     * @returns {string}
     */
    getCurrentLogFile() {
        return this.logger.getFilePath();
    }
}

module.exports = BLEScanner;