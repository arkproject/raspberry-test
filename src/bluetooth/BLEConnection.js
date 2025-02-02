/**
 * BLEConnection.js
 * Gestisce le connessioni Bluetooth Low Energy
 * Parte del refactoring di BLEScanner
 * 
 * Created: 2025-02-01 17:10:58
 * Author: arkproject
 * Version: 2.0.0
 */

const { createBluetooth } = require('node-ble');
const { BLEError, handleError, ErrorCodes } = require('../utils/errorHandler');

/**
 * Eventi emessi da BLEConnection
 * @readonly
 * @enum {string}
 */
const BLEConnectionEvents = {
    INITIALIZING: 'bluetooth:initializing',
    INITIALIZED: 'bluetooth:initialized',
    RESETTING: 'bluetooth:resetting',
    RESET_COMPLETE: 'bluetooth:reset_complete',
    ADAPTER_FOUND: 'bluetooth:adapter_found',
    ADAPTER_NOT_FOUND: 'bluetooth:adapter_not_found',
    POWER_ON: 'bluetooth:power_on',
    ERROR: 'bluetooth:error',
    STATE_CHANGED: 'bluetooth:state_changed',
    CLEANUP_START: 'bluetooth:cleanup_start',
    CLEANUP_COMPLETE: 'bluetooth:cleanup_complete'
};

/**
 * Classe che gestisce la connessione Bluetooth Low Energy
 * Fornisce funzionalità per inizializzare, resettare e gestire 
 * lo stato dell'adattatore Bluetooth
 */
class BLEConnection {
    /**
     * Inizializza una nuova istanza di BLEConnection
     * @param {BLEEventManager} eventManager - Istanza del gestore eventi
     */
    constructor(eventManager) {
        if (!eventManager) {
            throw new BLEError(
                'EventManager è richiesto',
                ErrorCodes.BLE.INVALID_PARAMETER
            );
        }

        this.eventManager = eventManager;
        this.bluetooth = null;      // Istanza del bluetooth
        this.adapter = null;        // Adapter bluetooth
        this.destroy = null;        // Funzione di cleanup
        this.isInitialized = false; // Flag di inizializzazione
        this.initAttempts = 0;      // Contatore tentativi di inizializzazione
        this.currentState = 'disconnected';
    }

    /**
     * Inizializza la connessione Bluetooth
     * Include sistema di retry in caso di fallimento
     * @returns {Promise<boolean>} true se l'inizializzazione è avvenuta con successo
     * @throws {BLEError} Se l'inizializzazione fallisce dopo i retry
     */
    async initialize() {
        try {
            this.updateState('initializing');
            this.eventManager.emit(BLEConnectionEvents.INITIALIZING, {
                attempt: ++this.initAttempts
            });

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
                    
                    this.eventManager.emit(BLEConnectionEvents.ADAPTER_FOUND, {
                        retry: retries
                    });
                    
                    break;
                } catch (error) {
                    retries++;
                    if (retries === maxRetries) {
                        this.eventManager.emit(BLEConnectionEvents.ADAPTER_NOT_FOUND, {
                            error: error.message
                        });
                        throw error;
                    }
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
                this.eventManager.emit(BLEConnectionEvents.POWER_ON);
                await this.adapter.setPowered(true);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            this.isInitialized = true;
            this.updateState('ready');
            
            this.eventManager.emit(BLEConnectionEvents.INITIALIZED, {
                isReady: this.isReady(),
                attempts: this.initAttempts
            });

            console.log('Bluetooth initialization completed');
            return true;

        } catch (error) {
            this.updateState('error');
            this.eventManager.emit(BLEConnectionEvents.ERROR, {
                error: error.message,
                phase: 'initialization',
                attempts: this.initAttempts
            });

            handleError(
                new BLEError(
                    'Bluetooth initialization failed',
                    ErrorCodes.BLE.INITIALIZATION_FAILED,
                    { error: error.message }
                ),
                'BLEConnection.initialize'
            );
            throw error;
        }
    }

    /**
     * Resetta lo stato del Bluetooth
     * Ferma la discovery se attiva e pulisce lo stato interno
     * @returns {Promise<void>}
     */
    async resetBluetooth() {
        console.log('Resetting Bluetooth state...');
        this.updateState('resetting');
        this.eventManager.emit(BLEConnectionEvents.RESETTING);

        try {
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

            // Reset internal state
            if (this.destroy) {
                this.destroy();
            }
            this.bluetooth = null;
            this.adapter = null;
            this.isInitialized = false;

            // Wait for everything to settle
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            this.updateState('disconnected');
            this.eventManager.emit(BLEConnectionEvents.RESET_COMPLETE);
            
            console.log('Bluetooth reset completed');
            
        } catch (error) {
            this.updateState('error');
            this.eventManager.emit(BLEConnectionEvents.ERROR, {
                error: error.message,
                phase: 'reset'
            });
            console.error('Error during Bluetooth reset:', error);
        }
    }

    /**
     * Aggiorna lo stato interno della connessione
     * @param {string} newState - Nuovo stato
     * @private
     */
    updateState(newState) {
        const oldState = this.currentState;
        this.currentState = newState;
        
        this.eventManager.emit(BLEConnectionEvents.STATE_CHANGED, {
            oldState,
            newState
        });
    }

    /**
     * Restituisce l'adapter Bluetooth
     * @returns {Object|null} L'adapter Bluetooth o null se non inizializzato
     */
    getAdapter() {
        return this.adapter;
    }

    /**
     * Verifica se la connessione è pronta
     * @returns {boolean} true se la connessione è inizializzata
     */
    isReady() {
        return this.isInitialized && this.adapter !== null;
    }

    /**
     * Restituisce lo stato attuale della connessione
     * @returns {Object} Oggetto contenente lo stato attuale
     */
    getStatus() {
        return {
            state: this.currentState,
            isInitialized: this.isInitialized,
            hasAdapter: this.adapter !== null,
            initializationAttempts: this.initAttempts
        };
    }

    /**
     * Pulisce le risorse utilizzate
     * @returns {Promise<void>}
     */
    async cleanup() {
        this.eventManager.emit(BLEConnectionEvents.CLEANUP_START);
        await this.resetBluetooth();
        this.eventManager.emit(BLEConnectionEvents.CLEANUP_COMPLETE);
    }
}

// Esporta sia la classe che gli eventi
module.exports = {
    BLEConnection,
    BLEConnectionEvents
};