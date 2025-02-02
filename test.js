const fs = require('fs');
const path = require('path');
const os = require('os');

function testFileCreation() {
    try {
        // Informazioni di base
        const username = 'arkproject';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        console.log(`Test creazione file - ${timestamp}`);
        console.log('Username:', username);

        // Test 1: Creazione directory
        console.log('\n1. Test creazione directory');
        const logsDir = path.join(__dirname, 'logs');
        try {
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
                console.log('✓ Directory logs creata:', logsDir);
            } else {
                console.log('✓ Directory logs già esistente:', logsDir);
            }
        } catch (mkdirError) {
            console.error('✗ Errore creazione directory:', mkdirError);
            // Fallback su directory temporanea
            logsDir = path.join(os.tmpdir(), 'ble_logs');
            fs.mkdirSync(logsDir, { recursive: true });
            console.log('✓ Directory fallback creata:', logsDir);
        }

        // Test 2: Verifica permessi directory
        console.log('\n2. Test permessi directory');
        try {
            fs.accessSync(logsDir, fs.constants.W_OK);
            console.log('✓ Directory scrivibile');
        } catch (accessError) {
            console.error('✗ Directory non scrivibile:', accessError);
        }

        // Test 3: Creazione file
        console.log('\n3. Test creazione file');
        const logFileName = path.join(logsDir, `ble_data_${username}_${timestamp}.csv`);
        try {
            const header = 'timestamp,numero_progressivo,asse_x,asse_y,asse_z,' +
                         'pressione_tallone,pressione_primo_metatarso,' +
                         'pressione_quinto_metatarso,segnale_uno,segnale_due,raw_hex\n';
            
            fs.writeFileSync(logFileName, header, { flag: 'a' });
            console.log('✓ File creato:', logFileName);
        } catch (fileError) {
            console.error('✗ Errore creazione file:', fileError);
            // Test fallback
            const fallbackFile = path.join(os.tmpdir(), `ble_data_${username}_${timestamp}.csv`);
            fs.writeFileSync(fallbackFile, header, { flag: 'a' });
            console.log('✓ File fallback creato:', fallbackFile);
        }

        // Test 4: Scrittura dati di test
        console.log('\n4. Test scrittura dati');
        try {
            const testData = `${new Date().toISOString()},1,100,200,300,400,500,600,700,800,ffff\n`;
            fs.appendFileSync(logFileName, testData);
            console.log('✓ Dati di test scritti');
            
            // Verifica contenuto
            const content = fs.readFileSync(logFileName, 'utf8');
            console.log('\nContenuto file:');
            console.log(content);
        } catch (writeError) {
            console.error('✗ Errore scrittura dati:', writeError);
        }

        // Test 5: Verifica dimensione file
        console.log('\n5. Test dimensione file');
        try {
            const stats = fs.statSync(logFileName);
            console.log('✓ Dimensione file:', stats.size, 'bytes');
        } catch (statError) {
            console.error('✗ Errore lettura dimensione:', statError);
        }

    } catch (error) {
        console.error('\nErrore critico durante i test:', error);
    }
}

// Esegui i test
console.log('=== INIZIO TEST CREAZIONE FILE ===\n');
testFileCreation();
console.log('\n=== FINE TEST CREAZIONE FILE ===');