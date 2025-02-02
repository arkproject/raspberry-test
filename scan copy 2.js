const { createBluetooth } = require('node-ble');
const readline = require('readline');

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
            console.log(`\nTrovati ${devices.length} dispositivi:`);
            let deviceList = [];

            for (const address of devices) {
                try {
                    const device = await adapter.getDevice(address);
                    const name = await device.getName().catch(() => 'Sconosciuto');
                    console.log(`[${deviceList.length}] ${name} (${address})`);
                    deviceList.push({ name, address });
                } catch (err) {
                    console.error(`Errore con il dispositivo ${address}:`, err.message);
                }
            }

            console.log('\nInserisci il numero del dispositivo a cui connetterti:');
            const selectedDevice = await askUserInput(deviceList);
            if (selectedDevice) {
                await connectToDevice(adapter, selectedDevice.address);
            }
        }

        console.log('Fine scansione.');
        await adapter.stopDiscovery();
    } catch (error) {
        console.error('Errore:', error);
    } finally {
        // Assicurati di distruggere l'adattatore solo alla fine
        destroy();
    }
}

async function askUserInput(deviceList) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question('Seleziona il numero del dispositivo: ', (answer) => {
            const index = parseInt(answer);
            if (!isNaN(index) && index >= 0 && index < deviceList.length) {
                resolve(deviceList[index]);
            } else {
                console.log('Numero non valido.');
                resolve(null);
            }
            rl.close();
        });
    });
}

async function monitorConnection(device, address) {
    try {
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Aspetta 1s
            if (!(await device.isConnected().catch(() => false))) {
                console.log(`⚠️ Dispositivo ${address} disconnesso!`);
                return;
            }
        }
    } catch (error) {
        console.error(`Errore nel monitoraggio: ${error.message}`);
    }
}

async function monitorDevice(adapter, address) {
    setInterval(async () => {
        try {
            const device = await adapter.getDevice(address); // Tenta di ottenere il dispositivo
            console.log(`✅ Il dispositivo ${address} è ancora disponibile.`);
        } catch (err) {
            console.log(`⚠️ Il dispositivo ${address} non è più disponibile o connesso.`);
        }
    }, 1000); // Controlla ogni secondo
}

async function connectToDevice(adapter, address) {
    try {
        console.log(`\nTentativo di connessione a ${address}...`);
        const device = await adapter.getDevice(address);
        
        // Aggiungi il listener per gli eventi
        device.on('connected', () => {
            console.log(`✅ Connesso a ${address}`);
        });

        device.on('disconnected', () => {
            console.log(`❌ Disconnesso da ${address}`);
        });



        await device.connect();
        // console.log(`✅ Connesso a ${address}`);
        // monitorDevice(adapter, address); // Avvia il monitoraggio dello stato

        // 🔹 Aggiungi il listener per intercettare la rimozione del dispositivo
        // adapter.on("deviceRemoved", (removedDevice) => {
        //     if (removedDevice.address === address) {
        //         console.log(`⚠️ Il dispositivo ${address} è stato rimosso!`);
        //     }
        // });

        // Legge il nome del dispositivo se disponibile
        const name = await device.getName().catch(() => 'Sconosciuto');
        console.log(`Nome dispositivo: ${name}`);

        // Disconnessione dopo 2 secondi, con controllo se il dispositivo è ancora connesso
        // setTimeout(async () => {
        //     try {
        //         if (await device.isConnected()) {
        //             await device.disconnect();
        //             console.log(`❌ Disconnesso da ${address}`);
        //         } else {
        //             console.log(`Il dispositivo ${address} non è più connesso.`);
        //         }
        //     } catch (err) {
        //         console.error(`Errore durante la disconnessione: ${err.message}`);
        //     }
        // }, 2000);

        // setTimeout(async () => {
        //     try {
        //         if (!deviceClosed && await device.isConnected()) {
        //             await device.disconnect();
        //             console.log("Disconnesso correttamente!");
        //         }
        //     } catch (err) {
        //         console.error("Errore nella disconnessione:", err.message);
        //     }
        // }, 2000);


    } catch (error) {
        console.error(`Errore durante la connessione: ${error.message}`);
    }
}

scanBLEDevices();
