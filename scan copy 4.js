const { createBluetooth } = require('node-ble');

class BLEScanner {
    constructor() {
        this.bluetooth = null;
        this.adapter = null;
        this.isScanning = false;
        this.discoveredDevices = new Map();
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

        setTimeout(async () => {
            await this.stopScan();
        }, scanDuration);
    }

    async stopScan() {
        if (!this.isScanning) return;

        try {
            this.isScanning = false;
            await this.adapter.stopDiscovery();
            console.log('\nScansione completata.');
            console.log(`Dispositivi trovati: ${this.discoveredDevices.size}`);
            await this.cleanup();
        } catch (error) {
            console.error('Errore durante l\'arresto della scansione:', error);
        }
    }

    async cleanup() {
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

async function main() {
    const scanner = new BLEScanner();
    
    process.on('SIGINT', async () => {
        console.log('\nArresto della scansione...');
        await scanner.stopScan();
        process.exit(0);
    });

    try {
        await scanner.startScan(5000);
    } catch (error) {
        console.error('Errore nel programma principale:', error);
        process.exit(1);
    }
}

main();