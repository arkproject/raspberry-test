/**
 * BLEConnection.js
 * Gestisce le connessioni Bluetooth Low Energy
 * Parte del refactoring di BLEScanner
 * 
 * Created: 2025-02-01 17:04:03
 * Author: arkproject
 * Version: 2.0.0
 */

const { createBluetooth } = require('node-ble');
const { BLEError, handleError, ErrorCodes } = require('../utils/errorHandler');

/**
 * Classe che gestisce la connessione Bluetooth Low Energy
 * Fornisce funzionalità per inizializzare, resettare e gestire 
 * lo stato dell'adattatore Bluetooth
 */
class BLEConnection {
    /**
     * Inizializza una nuova istanza di BLEConnection
     */
    constructor() {
        this.bluetooth = null;      // Istanza del bluetooth
        this.adapter = null;        // Adapter bluetooth
        this.destroy = null;        // Funzione di cleanup
        this.isInitialized = false; // Flag di inizializzazione
    }

    /**
     * Inizializza la connessione Bluetooth
     * Include sistema di retry in caso di fallimento
     * @returns {Promise<boolean>} true se l'inizializzazione è avvenuta con successo
     * @throws {BLEError} Se l'inizializzazione fallisce dopo i retry
     */
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

            this.isInitialized = true;
            console.log('Bluetooth initialization completed');
            return true;

        } catch (error) {
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
            console.log('Bluetooth reset completed');
            
        } catch (error) {
            console.error('Error during Bluetooth reset:', error);
        }
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
     * Pulisce le risorse utilizzate
     * @returns {Promise<void>}
     */
    async cleanup() {
        await this.resetBluetooth();
    }
}

module.exports = BLEConnection;