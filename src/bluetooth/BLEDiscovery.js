/**
 * BLEDiscovery.js
 * Gestisce la scoperta dei dispositivi Bluetooth Low Energy
 * 
 * Created: 2025-02-01 18:28:48
 * Author: arkproject
 * Version: 2.0.0
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
    STOPPING: 'discovery:stopping',
    STOPPED: 'discovery:stopped',
    ADAPTER_SET: 'discovery:adapter_set',
    SEARCH_TIMEOUT: 'discovery:search_timeout',
    SEARCH_STARTED: 'discovery:search_started',
    CLEANUP: 'discovery:cleanup',
    ERROR: 'discovery:error',
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
        // Mappa per tracciare i dispositivi univoci
        this.discoveredDevices = new Map();
        // Timer usato in altri contesti (es. findDevice)
        this.discoveryTimer = null;
        this.adapter = null;
        
        console.log('[BLEDiscovery] Initialized at:', getCurrentTimestamp());
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

        try {
            // Assicura che eventuali discovery precedenti siano fermati
            await this.ensureDiscoveryStopped();
            
            this.eventManager.emit(BLEDiscoveryEvents.STARTING, {
                timestamp: getCurrentTimestamp()
            });

            // Avvia la discovery sull'adapter BLE
            await this.adapter.startDiscovery();
            this.isDiscovering = true;
            
            // Avvia il loop di polling in background per controllare continuamente i dispositivi rilevati
            (async () => {
                while (this.isDiscovering) {
                    try {
                        const devices = await this.adapter.devices();
                        for (const address of devices) {
                            if (!this.discoveredDevices.has(address)) {
                                try {
                                    const device = await this.adapter.getDevice(address);
                                    const deviceInfo = await this.getDeviceInfo(device, address);
                                    // Salva il dispositivo se non è già stato registrato
                                    this.discoveredDevices.set(address, deviceInfo);
                                    // Emette un evento per il nuovo dispositivo trovato
                                    this.eventManager.emit(BLEDiscoveryEvents.DEVICE_FOUND, {
                                        ...deviceInfo,
                                        timestamp: getCurrentTimestamp()
                                    });
                                } catch (innerError) {
                                    console.log(`Errore nel processare il dispositivo ${address}:`, innerError.message);
                                }
                            }
                        }
                    } catch (pollError) {
                        console.error('Errore durante il polling dei dispositivi:', pollError);
                    }
                    // Attende 1000ms prima di ripetere il polling
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
 * Se la discovery non è attiva, registra solo un messaggio informativo senza emettere l'evento discovery:stopped.
 * @returns {Promise<void>}
 */
async stopDiscovery() {
    try {
      // Se è attivo un timer della discovery, lo cancelliamo
      if (this.discoveryTimer) {
        clearTimeout(this.discoveryTimer);
        this.discoveryTimer = null;
      }
  
      // Controlliamo se la discovery è attiva
      if (this.isDiscovering) {
        // Emettiamo l'evento di stop in corso
        this.eventManager.emit('discovery:stopping', {
          timestamp: getCurrentTimestamp()
        });
  
        try {
          await this.adapter.stopDiscovery();
        } catch (error) {
          // Se l'errore indica che la discovery non era attiva, logghiamo un messaggio informativo
          if (error.message.includes('No discovery started')) {
            console.info('La discovery era già interrotta.');
          } else {
            // Altrimenti rilanciamo l'errore
            throw error;
          }
        }
  
        // Impostiamo la discovery come non attiva
        this.isDiscovering = false;
  
        // Emettiamo l'evento di discovery stoppata
        // Nota: questo evento viene emesso esclusivamente se la discovery era attiva
        this.eventManager.emit('discovery:stopped', {
          devicesFound: this.discoveredDevices.size,
          timestamp: getCurrentTimestamp()
        });
      } else {
        // Nessuna discovery attiva; registriamo solo un messaggio informativo
        console.info('StopDiscovery chiamato: la discovery non era attiva, nessun evento "discovery:stopped" verrà emesso.');
      }
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
//  * Ferma la discovery in modo sicuro
//  * @returns {Promise<void>}
//  */
// async stopDiscovery() {
//     try {
//       if (this.discoveryTimer) {
//         clearTimeout(this.discoveryTimer);
//         this.discoveryTimer = null;
//       }
  
//       if (this.isDiscovering) {
//         this.eventManager.emit(BLEDiscoveryEvents.STOPPING, {
//           timestamp: getCurrentTimestamp()
//         });
  
//         try {
//           await this.adapter.stopDiscovery();
//         } catch (error) {
//           // Se l'errore indica che la discovery non era attiva, logga come informazione
//           if (error.message.includes('No discovery started')) {
//             console.info('La discovery era già interrotta.');
//           } else {
//             // Altrimenti, rilancia l'errore per il gestore
//             throw error;
//           }
//         }
  
//         this.isDiscovering = false;
//         this.eventManager.emit(BLEDiscoveryEvents.STOPPING, {
//           devicesFound: this.discoveredDevices.size,
//           timestamp: getCurrentTimestamp()
//         });
//       }
//     } catch (error) {
//       handleError(
//         new BLEError(
//           'Errore durante l\'arresto della discovery',
//           ErrorCodes.BLE.DISCOVERY_ERROR,
//           { error: error.message }
//         ),
//         'BLEDiscovery.stopDiscovery'
//       );
//     }
//   }

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
                        const device = await this.adapter.getDevice(address);
                        const deviceInfo = await this.getDeviceInfo(device);

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
                    } else {
                        rssi = device.RSSI || null;
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

    /**
     * Pulisce le risorse utilizzate
     */
    async cleanup() {
        await this.stopDiscovery();
        this.discoveredDevices.clear();
        this.adapter = null;
        
        this.eventManager.emit(BLEDiscoveryEvents.CLEANUP, {
            timestamp: getCurrentTimestamp()
        });
    }

    /**
     * Restituisce i dispositivi scoperti
     * @returns {Array}
     */
    getDiscoveredDevices() {
        return Array.from(this.discoveredDevices.values());
    }
}

module.exports = BLEDiscovery;