module.exports = {
    // Impostazioni generali
    SCAN_DURATION: 3000,
    LOG_LEVEL: 'info',

    // Impostazioni file di log
    FILE_SETTINGS: {
        MAX_FILE_SIZE: 1024 * 1024 * 10,  // 10MB
        ROTATION_ENABLED: true,
        ROTATION_COUNT: 5,                 // Numero massimo di file di backup
        BASE_PATH: 'logs',                 // Cartella base per i log
        FILENAME_PREFIX: 'ble_data_',      // Prefisso per i file di log
        FILE_EXTENSION: '.csv'             // Estensione file
    },

    // Impostazioni BLE
    BLE_SETTINGS: {
        SCAN_TIMEOUT: 10000,              // Timeout scansione in ms
        CONNECT_TIMEOUT: 5000,            // Timeout connessione in ms
        RETRY_COUNT: 3,                   // Numero di tentativi di riconnessione
        RETRY_DELAY: 1000                 // Delay tra i tentativi in ms
    },

    // Impostazioni sessione di scrittura
    SESSION_SETTINGS: {
        // DURATION: 1 * 60 * 1000,         // Durata sessione in ms (default 1 minuto)
        DURATION: 10 * 1000,         // Durata sessione in ms (default 10 secondi)
        AUTO_RESTART: true,              // Riavvio automatico nuova sessione
        SESSION_PREFIX: 'session_',      // Prefisso per identificare la sessione
        INCLUDE_SESSION_NUMBER: true     // Includere numero sessione nel nome file
    },

    TARGET_DEVICE: {
        NAME: 'APTIS',                    // Nome del dispositivo da cercare
        SCAN_TIMEOUT: 30000,              // Timeout scansione (30 secondi)
        RETRY_ATTEMPTS: 3,                // Numero di tentativi di connessione
        RETRY_DELAY: 5000,               // Delay tra i tentativi (5 secondi)
        AUTO_RECONNECT: true,            // Riconnessione automatica se persa
        SIGNAL_STRENGTH_THRESHOLD: -80    // Soglia minima RSSI (dBm)
    },

    SCAN_SETTINGS: {
        STOP_TIMEOUT: 1000,        // Tempo di attesa dopo lo stop della scansione
        MAX_STOP_ATTEMPTS: 3,      // Numero massimo di tentativi di stop
        RETRY_DELAY: 1000,         // Delay tra i tentativi di riavvio scansione
        OPERATION_TIMEOUT: 1000    // Timeout per le operazioni getName e getRSSI
    },

    DISCOVERY: {
        UPDATE_INTERVAL: 2000,      // Intervallo minimo tra gli aggiornamenti dello stesso dispositivo
        DEVICE_TTL: 10000,          // Tempo dopo il quale un dispositivo viene considerato "sparito"
        SIGNAL_QUALITY: {
            EXCELLENT: -50,
            GOOD: -65,
            FAIR: -75
        }
    },

    // Formato dati
    DATA_FORMAT: {
        TIMESTAMP_FORMAT: 'YYYY-MM-DD HH:mm:ss',
        CSV_HEADER: [
            'timestamp',
            'numero_progressivo',
            'asse_x',
            'asse_y',
            'asse_z',
            'pressione_tallone',
            'pressione_primo_metatarso',
            'pressione_quinto_metatarso',
            'segnale_uno',
            'segnale_due',
            'raw_hex'
        ].join(',')
    }
};