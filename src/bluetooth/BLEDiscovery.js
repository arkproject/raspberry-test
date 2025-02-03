/**
 * BLEDiscovery.js
 * Gestisce la scoperta dei dispositivi Bluetooth Low Energy
 * 
 * Created: 2025-02-01 18:28:48
 * Updated: 2025-02-03 09:11:47
 * Author: arkproject
 * Version: 2.1.0
 */

const { BLEError, handleError, ErrorCodes } = require('../utils/errorHandler');
const { getCurrentTimestamp } = require('../utils/dateUtils');
const settings = require('../config/settings');

/**
 * Eventi emessi da BLEConnection
 * @readonly
 * @enum {string}
 */
const BLEDiscoveryEvents = {
    STARTING: 'discovery:starting',
    STARTED: 'discovery:started',
    DEVICE_FOUND: 'discovery:device_found',
    DEVICE_UPDATED: 'discovery:device_updated',
    STOPPING: 'discovery:stopping',
    STOPPED: 'discovery:stopped',
    ADAPTER_SET: 'discovery:adapter_set',
    SEARCH_TIMEOUT: 'discovery:search_timeout',
    SEARCH_STARTED: 'discovery:search_started',
    CLEANUP: 'discovery:cleanup',
    ERROR: 'discovery:error',
};

// Configurazione della cache
const CACHE_CONFIG = {
    MAX_AGE: 10000, // 10 secondi
    CLEANUP_INTERVAL: 30000 // 30 secondi
};

class BLEDiscovery {
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
        this.isDiscovering = false;
        this.discoveredDevices = new Map();
        this.discoveryTimer = null;
        this.adapter = null;
        this._cleanupInProgress = false;
        this._cacheCleanupInterval = null;

        // Avvia il timer di pulizia della cache
        this._startCacheCleanup();

        console.log('[BLEDiscovery] Initialized at:', getCurrentTimestamp());
    }

    /**
     * Avvia il timer di pulizia della cache
     * @private
     */
    _startCacheCleanup() {
        if (this._cacheCleanupInterval) {
            clearInterval(this._cacheCleanupInterval);
        }

        this._cacheCleanupInterval = setInterval(() => {
            this._cleanupCache();
        }, CACHE_CONFIG.CLEANUP_INTERVAL);
    }

    /**
     * Pulisce la cache dei dispositivi scaduti
     * @private
     */
    _cleanupCache() {
        const currentTime = Date.now();
        let cleanedCount = 0;

        for (const [address, device] of this.discoveredDevices.entries()) {
            if (!this.isCacheValid(address)) {
                this.discoveredDevices.delete(address);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.debug(`[Cache] Rimossi ${cleanedCount} dispositivi scaduti`);
        }
    }

    /**
     * Controlla se la cache di un dispositivo è valida
     * @param {string} address - Indirizzo del dispositivo
     * @param {number} maxAge - Età massima della cache in millisecondi
     * @returns {boolean}
     */
    isCacheValid(address, maxAge = CACHE_CONFIG.MAX_AGE) {
        const cachedDevice = this.discoveredDevices.get(address);
        if (!cachedDevice) return false;
        
        const currentTime = Date.now();
        const deviceTime = new Date(cachedDevice.timestamp).getTime();
        return (currentTime - deviceTime) < maxAge;
    }

    /**
     * Imposta l'adapter Bluetooth
     * @param {Object} adapter - L'adapter Bluetooth da utilizzare
     */
    setAdapter(adapter) {
        this.adapter = adapter;
        this.eventManager.emit(BLEDiscoveryEvents.ADAPTER_SET, {
            timestamp: getCurrentTimestamp()
        });
    }

    /**
     * Avvia la discovery in modo sicuro con loop di polling per il rilevamento di nuovi dispositivi.
     * @returns {Promise<boolean>}
     */
    async startDiscovery() {
        if (!this.adapter) {
            throw new BLEError(
                'Adapter non impostato',
                ErrorCodes.BLE.INVALID_STATE
            );
        }

        if (this.isDiscovering) {
            console.debug('StartDiscovery: discovery già in corso');
            return true;
        }

        try {
            await this.ensureDiscoveryStopped();

            this.eventManager.emit(BLEDiscoveryEvents.STARTING, {
                timestamp: getCurrentTimestamp()
            });

            // Pulisci la cache all'avvio della discovery
            this.discoveredDevices.clear();

            await this.adapter.startDiscovery();
            this.isDiscovering = true;

            // Avvia il loop di polling in background
            (async () => {
                while (this.isDiscovering) {
                    try {
                        const devices = await this.adapter.devices();
                        const currentTime = Date.now();
                        
                        for (const address of devices) {
                            try {
                                // Verifica se il dispositivo è già in cache e se è ancora valido
                                const isCacheValid = this.isCacheValid(address);

                                if (!isCacheValid) {
                                    const device = await this.adapter.getDevice(address);
                                    const deviceInfo = await this.getDeviceInfo(device, address);
                                    
                                    const isNewDevice = !this.discoveredDevices.has(address);
                                    
                                    // Aggiorna la cache
                                    this.discoveredDevices.set(address, {
                                        ...deviceInfo,
                                        timestamp: getCurrentTimestamp()
                                    });

                                    // Emette l'evento appropriato
                                    this.eventManager.emit(
                                        isNewDevice ? BLEDiscoveryEvents.DEVICE_FOUND : BLEDiscoveryEvents.DEVICE_UPDATED,
                                        {
                                            ...deviceInfo,
                                            timestamp: getCurrentTimestamp()
                                        }
                                    );
                                }
                            } catch (innerError) {
                                console.log(`Errore nel processare il dispositivo ${address}:`, innerError.message);
                            }
                        }
                    } catch (pollError) {
                        console.error('Errore durante il polling dei dispositivi:', pollError);
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            })();

            this.eventManager.emit(BLEDiscoveryEvents.STARTED, {
                timestamp: getCurrentTimestamp()
            });

            return true;

        } catch (error) {
            if (error.message.includes('No discovery started')) {
                return true;
            }
            throw error;
        }
    }

    /**
     * Ferma la discovery in modo sicuro.
     * @returns {Promise<void>}
     */
    async stopDiscovery() {
        try {
            if (this.discoveryTimer) {
                clearTimeout(this.discoveryTimer);
                this.discoveryTimer = null;
            }

            if (!this.adapter || !this.isDiscovering) {
                console.debug('StopDiscovery: nessuna discovery attiva');
                return;
            }

            this.isDiscovering = false;

            this.eventManager.emit(BLEDiscoveryEvents.STOPPING, {
                timestamp: getCurrentTimestamp()
            });

            try {
                await this.adapter.stopDiscovery();
            } catch (error) {
                if (!error.message.includes('No discovery started')) {
                    throw error;
                }
            }

            this.eventManager.emit(BLEDiscoveryEvents.STOPPED, {
                devicesFound: this.discoveredDevices.size,
                timestamp: getCurrentTimestamp()
            });

        } catch (error) {
            handleError(
                new BLEError(
                    'Errore durante l\'arresto della discovery',
                    ErrorCodes.BLE.DISCOVERY_ERROR,
                    { error: error.message }
                ),
                'BLEDiscovery.stopDiscovery'
            );
        }
    }

    /**
     * Si assicura che la discovery sia fermata
     * @returns {Promise<void>}
     */
    async ensureDiscoveryStopped() {
        if (!this.adapter) return;

        try {
            const isDiscovering = await this.adapter.isDiscovering();
            if (isDiscovering) {
                await this.adapter.stopDiscovery();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            this.isDiscovering = false;
        } catch (error) {
            console.log('Errore nel fermare la discovery:', error.message);
        }
    }

    /**
     * Cerca un dispositivo specifico
     * @param {Object} criteria - Criteri di ricerca
     * @param {number} timeout - Timeout in millisecondi
     * @returns {Promise<Object|null>}
     */
    async findDevice(criteria, timeout = settings.TARGET_DEVICE.SCAN_TIMEOUT) {
        try {
            await this.startDiscovery();
            const searchStartTime = Date.now();

            this.eventManager.emit(BLEDiscoveryEvents.SEARCH_STARTED, {
                criteria,
                timeout,
                timestamp: getCurrentTimestamp()
            });

            while (Date.now() - searchStartTime < timeout) {
                const devices = await this.adapter.devices();

                for (const address of devices) {
                    try {
                        if (this.isCacheValid(address)) {
                            const cachedDevice = this.discoveredDevices.get(address);
                            if (this.matchesCriteria(cachedDevice, criteria)) {
                                return await this.adapter.getDevice(address);
                            }
                            continue;
                        }

                        const device = await this.adapter.getDevice(address);
                        const deviceInfo = await this.getDeviceInfo(device, address);

                        if (this.matchesCriteria(deviceInfo, criteria)) {
                            await this.stopDiscovery();

                            this.eventManager.emit(BLEDiscoveryEvents.DEVICE_FOUND, {
                                ...deviceInfo,
                                timestamp: getCurrentTimestamp()
                            });

                            return device;
                        }
                    } catch (error) {
                        continue;
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 500));
            }

            await this.stopDiscovery();

            this.eventManager.emit(BLEDiscoveryEvents.SEARCH_TIMEOUT, {
                criteria,
                timeout,
                timestamp: getCurrentTimestamp()
            });

            return null;

        } catch (error) {
            handleError(
                new BLEError(
                    'Errore durante la ricerca del dispositivo',
                    ErrorCodes.BLE.DISCOVERY_ERROR,
                    { error: error.message }
                ),
                'BLEDiscovery.findDevice'
            );

            await this.stopDiscovery();
            return null;
        }
    }

    /**
     * Verifica se un dispositivo corrisponde ai criteri di ricerca
     * @private
     */
    matchesCriteria(deviceInfo, criteria) {
        if (criteria.name && deviceInfo.name !== criteria.name) {
            return false;
        }

        if (criteria.minRssi && deviceInfo.rssi < criteria.minRssi) {
            return false;
        }

        return true;
    }

    /**
     * Ottiene le informazioni di un dispositivo
     * @private
     */
    async getDeviceInfo(device, address) {
        try {
            const name = await Promise.race([
                device.getName(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('getName timeout')), 2000)
                )
            ]).catch(() => 'Sconosciuto');

            let rssi = null;
            try {
                rssi = await Promise.race([
                    device.getRSSI(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('getRSSI timeout')), 1000)
                    )
                ]);
            } catch (rssiError) {
                try {
                    const properties = await device.getProperties();
                    if (properties && properties.RSSI) {
                        rssi = properties.RSSI;
                    } else {
                        rssi = device.RSSI || null;
                    }
                } catch (propError) {
                    console.log(`Debug - Anche il tentativo con properties fallito per ${address}: ${propError.message}`);
                }
            }

            return {
                address,
                name: name || 'Sconosciuto',
                rssi: rssi !== null ? `${rssi} dBm` : 'Non disponibile',
                timestamp: getCurrentTimestamp()
            };

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

    /**
     * Restituisce i dispositivi scoperti
     * @param {boolean} includeExpired - Se true, include anche i dispositivi con cache scaduta
     * @returns {Array}
     */
    getDiscoveredDevices(includeExpired = false) {
        if (includeExpired) {
            return Array.from(this.discoveredDevices.values());
        }

        return Array.from(this.discoveredDevices.values())
            .filter(device => this.isCacheValid(device.address));
    }

    /**
     * Pulisce le risorse utilizzate
     */
    async cleanup() {
        if (this._cleanupInProgress) {
            return;
        }
        this._cleanupInProgress = true;

        try {
            if (this._cacheCleanupInterval) {
                clearInterval(this._cacheCleanupInterval);
                this._cacheCleanupInterval = null;
            }

            if (this.isDiscovering) {
                await this.stopDiscovery();
            }

            this.discoveredDevices.clear();
            this.adapter = null;

            this.eventManager.emit(BLEDiscoveryEvents.CLEANUP, {
                timestamp: getCurrentTimestamp()
            });
        } finally {
            this._cleanupInProgress = false;
        }
    }
}

module.exports = BLEDiscovery;