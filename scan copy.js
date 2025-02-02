const { createBluetooth } = require('node-ble');

async function scanBLEDevices() {
    const { bluetooth, destroy } = createBluetooth();
    
    try {
        const adapter = await bluetooth.defaultAdapter();
        console.log('Attivazione dell\'adattatore Bluetooth...');

        if (!(await adapter.isPowered())) {
            console.log('L\'adattatore Bluetooth non è attivo. Accendilo e riprova.');
            return;
        }

        console.log('Inizio scansione dei dispositivi BLE...');
        await adapter.startDiscovery();

        // Aspettiamo 2 secondi per la scansione
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Recuperiamo gli indirizzi dei dispositivi trovati
        const devices = await adapter.devices();

        if (devices.length === 0) {
            console.log('Nessun dispositivo BLE trovato.');
        } else {
            console.log(`Trovati ${devices.length} dispositivi:`);
            for (const address of devices) {
                try {
                    const device = await adapter.getDevice(address);
                    const name = await device.getName().catch(() => 'Sconosciuto');
                    console.log(`- Dispositivo trovato: ${name} (${address})`);
                } catch (err) {
                    console.error(`Errore con il dispositivo ${address}:`, err.message);
                }
            }
        }

        console.log('Fine scansione.');
        await adapter.stopDiscovery();
    } catch (error) {
        console.error('Errore:', error);
    } finally {
        destroy();
    }
}

scanBLEDevices();
