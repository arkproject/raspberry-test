const EventEmitter = require('events');
const { BLEError, handleError, ErrorCodes } = require('../utils/errorHandler');
const { getCurrentTimestamp } = require('../utils/dateUtils');

// (gestione eventi)
class BLEEventManager extends EventEmitter {
    constructor() {
        super();
        this.deviceListeners = new Map();
        this.characteristicListeners = new Map();
        this.serviceListeners = new Map();
        this.adapter = null;
        this.maxListeners = 30;
        this.setMaxListeners(this.maxListeners);
        
        // Struttura per tracciare gli eventi attivi
        this.activeEvents = new Map();
        // Contatori per monitoraggio eventi
        this.eventCounts = {
            device: 0,
            characteristic: 0,
            service: 0,
            total: 0
        };
    }

    setAdapter(adapter) {
        this.adapter = adapter;
    }

    /**
     * Aggiunge un listener per un dispositivo
     * @param {Object} device - Dispositivo BLE
     * @param {string} eventName - Nome dell'evento
     * @param {Function} listener - Funzione listener
     * @param {Object} options - Opzioni aggiuntive
     */
    addDeviceListener(device, eventName, listener, options = {}) {
        try {
            if (!device || !device.address) {
                throw new BLEError(
                    'Dispositivo non valido',
                    ErrorCodes.BLE.INVALID_DEVICE
                );
            }

            const key = this.generateListenerKey(device.address, eventName);
            
            // Rimuovi eventuali listener precedenti
            this.removeDeviceListener(device, eventName);

            // Wrapper per il listener con gestione errori
            const wrappedListener = this.createWrappedListener(listener, device, eventName);

            // Aggiungi il nuovo listener
            device.on(eventName, wrappedListener);

            // Salva le informazioni del listener
            this.deviceListeners.set(key, {
                device,
                eventName,
                originalListener: listener,
                wrappedListener,
                timestamp: getCurrentTimestamp(),
                options
            });

            this.updateEventCounts('device', 1);
            this.trackEvent(key, 'device', device.address);

            return true;
        } catch (error) {
            handleError(error, 'BLEEventManager.addDeviceListener');
            return false;
        }
    }

    /**
     * Aggiunge un listener per una caratteristica
     * @param {Object} characteristic - Caratteristica BLE
     * @param {string} eventName - Nome dell'evento
     * @param {Function} listener - Funzione listener
     * @param {Object} options - Opzioni aggiuntive
     */
    addCharacteristicListener(characteristic, eventName, listener, options = {}) {
        try {
            const uuid = characteristic.uuid;
            const key = this.generateListenerKey(uuid, eventName);

            // Rimuovi eventuali listener precedenti
            this.removeCharacteristicListener(characteristic, eventName);

            // Wrapper per il listener con gestione errori
            const wrappedListener = this.createWrappedListener(listener, characteristic, eventName);

            // Aggiungi il nuovo listener
            characteristic.on(eventName, wrappedListener);

            // Salva le informazioni del listener
            this.characteristicListeners.set(key, {
                characteristic,
                eventName,
                originalListener: listener,
                wrappedListener,
                timestamp: getCurrentTimestamp(),
                options
            });

            this.updateEventCounts('characteristic', 1);
            this.trackEvent(key, 'characteristic', uuid);

            return true;
        } catch (error) {
            handleError(error, 'BLEEventManager.addCharacteristicListener');
            return false;
        }
    }

    /**
     * Rimuove un listener da un dispositivo
     * @param {Object} device - Dispositivo BLE
     * @param {string} eventName - Nome dell'evento
     */
    removeDeviceListener(device, eventName) {
        try {
            const key = this.generateListenerKey(device.address, eventName);
            const listenerInfo = this.deviceListeners.get(key);

            if (listenerInfo) {
                device.removeListener(eventName, listenerInfo.wrappedListener);
                this.deviceListeners.delete(key);
                this.updateEventCounts('device', -1);
                this.untrackEvent(key);
            }
        } catch (error) {
            handleError(error, 'BLEEventManager.removeDeviceListener');
        }
    }

    /**
     * Rimuove un listener da una caratteristica
     * @param {Object} characteristic - Caratteristica BLE
     * @param {string} eventName - Nome dell'evento
     */
    removeCharacteristicListener(characteristic, eventName) {
        try {
            const key = this.generateListenerKey(characteristic.uuid, eventName);
            const listenerInfo = this.characteristicListeners.get(key);

            if (listenerInfo) {
                characteristic.removeListener(eventName, listenerInfo.wrappedListener);
                this.characteristicListeners.delete(key);
                this.updateEventCounts('characteristic', -1);
                this.untrackEvent(key);
            }
        } catch (error) {
            handleError(error, 'BLEEventManager.removeCharacteristicListener');
        }
    }

    /**
     * Rimuove tutti i listener associati a un dispositivo
     * @param {Object} device - Dispositivo BLE
     */
    removeAllDeviceListeners(device) {
        try {
            const address = device.address;
            const keysToRemove = [];

            for (const [key, listenerInfo] of this.deviceListeners.entries()) {
                if (listenerInfo.device.address === address) {
                    try {
                        device.removeListener(
                            listenerInfo.eventName,
                            listenerInfo.wrappedListener
                        );
                        keysToRemove.push(key);
                    } catch (error) {
                        console.log(`Error removing listener for device ${address}:`, error.message);
                    }
                }
            }

            keysToRemove.forEach(key => {
                this.deviceListeners.delete(key);
                this.updateEventCounts('device', -1);
                this.untrackEvent(key);
            });
        } catch (error) {
            handleError(error, 'BLEEventManager.removeAllDeviceListeners');
        }
    }

    /**
     * Rimuove tutti i listener associati a una caratteristica
     * @param {Object} characteristic - Caratteristica BLE
     */
    removeAllCharacteristicListeners(characteristic) {
        try {
            const uuid = characteristic.uuid;
            const keysToRemove = [];

            for (const [key, listenerInfo] of this.characteristicListeners.entries()) {
                if (listenerInfo.characteristic.uuid === uuid) {
                    try {
                        characteristic.removeListener(
                            listenerInfo.eventName,
                            listenerInfo.wrappedListener
                        );
                        keysToRemove.push(key);
                    } catch (error) {
                        console.log(`Error removing listener for characteristic ${uuid}:`, error.message);
                    }
                }
            }

            keysToRemove.forEach(key => {
                this.characteristicListeners.delete(key);
                this.updateEventCounts('characteristic', -1);
                this.untrackEvent(key);
            });
        } catch (error) {
            handleError(error, 'BLEEventManager.removeAllCharacteristicListeners');
        }
    }

    /**
     * Crea un wrapper per il listener con gestione degli errori
     * @param {Function} listener - Listener originale
     * @param {Object} target - Oggetto target (device o characteristic)
     * @param {string} eventName - Nome dell'evento
     */
    createWrappedListener(listener, target, eventName) {
        return async (...args) => {
            try {
                await listener(...args);
            } catch (error) {
                handleError(
                    new BLEError(
                        `Errore nell'evento ${eventName}`,
                        ErrorCodes.BLE.EVENT_ERROR,
                        {
                            eventName,
                            targetType: target.constructor.name,
                            targetId: target.address || target.uuid,
                            error: error.message
                        }
                    ),
                    'BLEEventManager.eventHandler'
                );
            }
        };
    }

    /**
     * Genera una chiave univoca per il listener
     * @param {string} id - ID del dispositivo o caratteristica
     * @param {string} eventName - Nome dell'evento
     */
    generateListenerKey(id, eventName) {
        return `${id}_${eventName}`;
    }

    /**
     * Aggiorna i contatori degli eventi
     * @param {string} type - Tipo di evento
     * @param {number} delta - Variazione del contatore
     */
    updateEventCounts(type, delta) {
        this.eventCounts[type] += delta;
        this.eventCounts.total += delta;

        // Emetti evento per monitoraggio
        this.emit('eventCountsUpdated', this.eventCounts);
    }

    /**
     * Traccia un nuovo evento attivo
     * @param {string} key - Chiave del listener
     * @param {string} type - Tipo di evento
     * @param {string} targetId - ID del target
     */
    trackEvent(key, type, targetId) {
        this.activeEvents.set(key, {
            type,
            targetId,
            startTime: getCurrentTimestamp()
        });
    }

    /**
     * Rimuove un evento dal tracciamento
     * @param {string} key - Chiave del listener
     */
    untrackEvent(key) {
        this.activeEvents.delete(key);
    }

    /**
     * Pulisce tutti i listener e resetta lo stato
     */
    async cleanup() {
        try {
            // Rimuovi tutti i listener dei dispositivi
            for (const [key, listenerInfo] of this.deviceListeners.entries()) {
                try {
                    listenerInfo.device.removeListener(
                        listenerInfo.eventName,
                        listenerInfo.wrappedListener
                    );
                } catch (error) {
                    console.log(`Error removing device listener ${key}:`, error.message);
                }
            }

            // Rimuovi tutti i listener delle caratteristiche
            for (const [key, listenerInfo] of this.characteristicListeners.entries()) {
                try {
                    listenerInfo.characteristic.removeListener(
                        listenerInfo.eventName,
                        listenerInfo.wrappedListener
                    );
                } catch (error) {
                    console.log(`Error removing characteristic listener ${key}:`, error.message);
                }
            }

            // Reset delle strutture dati
            this.deviceListeners.clear();
            this.characteristicListeners.clear();
            this.serviceListeners.clear();
            this.activeEvents.clear();
            
            // Reset dei contatori
            this.eventCounts = {
                device: 0,
                characteristic: 0,
                service: 0,
                total: 0
            };

            // Emetti evento di cleanup completato
            this.emit('cleanupComplete');

        } catch (error) {
            handleError(error, 'BLEEventManager.cleanup');
        }
    }

    /**
     * Restituisce le statistiche sugli eventi
     */
    getEventStatistics() {
        return {
            counts: { ...this.eventCounts },
            activeEvents: Array.from(this.activeEvents.entries()).map(([key, info]) => ({
                key,
                ...info
            })),
            deviceListeners: this.deviceListeners.size,
            characteristicListeners: this.characteristicListeners.size,
            serviceListeners: this.serviceListeners.size
        };
    }
}

module.exports = BLEEventManager;