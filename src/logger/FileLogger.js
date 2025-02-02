const fs = require('fs');
const path = require('path');
const os = require('os');
const settings = require('../config/settings');
const { FileError, ErrorCodes, handleError } = require('../utils/errorHandler');
const { formatDateTime } = require('../utils/dateUtils');

class FileLogger {
    constructor() {
        this.settings = settings;
        this.sessionCount = 0;
        this.sessionTimer = null;
        this.isSessionActive = false;
        this.username = os.userInfo().username || 'arkproject';
        this.logsDir = path.join(__dirname, '..', '..', this.settings.FILE_SETTINGS.BASE_PATH);
        
        // Crea directory logs se non esiste
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }

    startNewSession() {
        try {
            this.sessionCount++;
            const timestamp = new Date().toISOString()
                .replace('T', '_')
                .replace(/:/g, '-')
                .split('.')[0];

            // Crea nome file con numero sessione e timestamp corrente
            this.logFileName = path.join(
                this.logsDir,
                `${this.settings.FILE_SETTINGS.FILENAME_PREFIX}${this.username}_${timestamp}_session_${this.sessionCount}${this.settings.FILE_SETTINGS.FILE_EXTENSION}`
            );

            // Crea il file con l'intestazione
            fs.writeFileSync(this.logFileName, this.settings.DATA_FORMAT.CSV_HEADER + '\n', { flag: 'w' });
            
            // Verifica permessi di scrittura
            fs.accessSync(this.logFileName, fs.constants.W_OK);
            
            this.isSessionActive = true;
            console.log(`\nNuova sessione (#${this.sessionCount}) avviata: ${this.logFileName}`);
            console.log(`Durata sessione: ${this.settings.SESSION_SETTINGS.DURATION / 1000} secondi`);

            // Avvia il timer per questa sessione
            this.startSessionTimer();

            return true;
        } catch (error) {
            handleError(new FileError(
                'Avvio nuova sessione fallito',
                ErrorCodes.FILE.CREATE_FAILED,
                { error: error.message }
            ), 'FileLogger.startNewSession');
            return false;
        }
    }

    startSessionTimer() {
        if (this.sessionTimer) {
            clearTimeout(this.sessionTimer);
        }

        this.sessionTimer = setTimeout(() => {
            this.endCurrentSession();
        }, this.settings.SESSION_SETTINGS.DURATION);
    }

    endCurrentSession() {
        if (!this.isSessionActive) return;

        try {
            this.isSessionActive = false;
            console.log(`\nSessione #${this.sessionCount} completata: ${this.logFileName}`);
            
            if (this.settings.SESSION_SETTINGS.AUTO_RESTART) {
                this.startNewSession();
            }
        } catch (error) {
            handleError(new FileError(
                'Chiusura sessione fallita',
                ErrorCodes.FILE.CREATE_FAILED,
                { error: error.message }
            ), 'FileLogger.endCurrentSession');
        }
    }

    writeData(decodedData) {
        try {
            // Se non c'è una sessione attiva, ne avvia una nuova
            if (!this.isSessionActive) {
                if (!this.startNewSession()) {
                    throw new Error('Impossibile avviare una nuova sessione');
                }
            }

            const csvLine = [
                decodedData.timestamp,
                decodedData.numero_progressivo,
                decodedData.asse_x,
                decodedData.asse_y,
                decodedData.asse_z,
                decodedData.pressione_tallone,
                decodedData.pressione_primo_metatarso,
                decodedData.pressione_quinto_metatarso,
                decodedData.segnale_uno,
                decodedData.segnale_due,
                decodedData.raw_hex
            ].join(',') + '\n';

            fs.appendFileSync(this.logFileName, csvLine);
            return true;
        } catch (error) {
            handleError(new FileError(
                'Scrittura dati fallita',
                ErrorCodes.FILE.WRITE_FAILED,
                { error: error.message }
            ), 'FileLogger.writeData');
            return false;
        }
    }

    cleanup() {
        if (this.sessionTimer) {
            clearTimeout(this.sessionTimer);
            this.sessionTimer = null;
        }
        this.isSessionActive = false;
    }

    getSessionInfo() {
        return {
            currentSession: this.sessionCount,
            isActive: this.isSessionActive,
            currentFile: this.isSessionActive ? this.logFileName : 'Nessuna sessione attiva',
            sessionDuration: this.settings.SESSION_SETTINGS.DURATION / 1000,
            autoRestart: this.settings.SESSION_SETTINGS.AUTO_RESTART,
            startTime: this.sessionStartTime
        };
    }

    getCurrentFilePath() {
        return this.isSessionActive ? this.logFileName : null;
    }
}

module.exports = FileLogger;