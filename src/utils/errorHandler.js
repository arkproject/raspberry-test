class BLEError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'BLEError';
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }
}

class FileError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'FileError';
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }
}

function handleError(error, context = '') {
    const timestamp = new Date().toISOString();
    
    if (error instanceof BLEError || error instanceof FileError) {
        console.error(`[${timestamp}] [${context}] ${error.name}: ${error.message}`);
        console.error('Dettagli:', error.details);
        console.error('Codice:', error.code);
    } else {
        console.error(`[${timestamp}] [${context}] Errore generico: ${error.message}`);
    }

    // Log su file degli errori se necessario
    // TODO: Implementare logging errori su file
}

const ErrorCodes = {
    BLE: {
        INITIALIZATION_FAILED: 'BLE_INIT_FAILED',
        CONNECTION_FAILED: 'BLE_CONN_FAILED',
        SCAN_FAILED: 'BLE_SCAN_FAILED',
        DEVICE_NOT_FOUND: 'BLE_DEVICE_NOT_FOUND'
    },
    FILE: {
        CREATE_FAILED: 'FILE_CREATE_FAILED',
        WRITE_FAILED: 'FILE_WRITE_FAILED',
        ROTATION_FAILED: 'FILE_ROTATION_FAILED',
        PERMISSION_DENIED: 'FILE_PERMISSION_DENIED'
    }
};

module.exports = {
    BLEError,
    FileError,
    handleError,
    ErrorCodes
};