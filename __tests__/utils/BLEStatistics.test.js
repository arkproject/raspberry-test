/**
 * Test suite for BLEStatistics class
 * Updated: 2025-02-02 17:55:43
 * Author: arkproject
 */

const BLEStatistics = require('../../src/utils/BLEStatistics');
const { getCurrentTimestamp } = require('../../src/utils/dateUtils');

describe('BLEStatistics', () => {
    let bleStats;
    let originalDate;

    beforeEach(() => {
        bleStats = new BLEStatistics();
    });

    afterEach(() => {
        // Ripristina Date originale dopo ogni test
        if (originalDate) {
            global.Date = originalDate;
        }
        jest.useRealTimers();
    });

    test('should initialize with correct default values', () => {
        const stats = bleStats.getStats();
        expect(stats.discoveredDevices).toBe(0);
        expect(stats.dataCounter).toBe(0);
        expect(stats.connectionState).toBeNull();
        expect(stats.lastUpdate).toBeNull();
        expect(stats.session.startTime).toBeTruthy();
        expect(stats.session.currentFile).toBeNull();
        expect(typeof stats.uptime).toBe('number');
    });

    test('should increment discovered devices counter', () => {
        bleStats.incrementDiscoveredDevices();
        const stats = bleStats.getStats();
        expect(stats.discoveredDevices).toBe(1);
        expect(stats.lastUpdate).toBeTruthy();
    });

    test('should increment data counter', () => {
        bleStats.incrementDataCounter();
        const stats = bleStats.getStats();
        expect(stats.dataCounter).toBe(1);
        expect(stats.lastUpdate).toBeTruthy();
    });

    test('should update connection state', () => {
        const newState = 'connected';
        bleStats.updateConnectionState(newState);
        const stats = bleStats.getStats();
        expect(stats.connectionState).toBe(newState);
        expect(stats.lastUpdate).toBeTruthy();
    });

    test('should set current file', () => {
        const filename = 'test_file.csv';
        bleStats.setCurrentFile(filename);
        const stats = bleStats.getStats();
        expect(stats.session.currentFile).toBe(filename);
        expect(stats.lastUpdate).toBeTruthy();
    });

    test('should reset statistics', () => {
        bleStats.incrementDiscoveredDevices();
        bleStats.incrementDataCounter();
        bleStats.updateConnectionState('connected');
        bleStats.setCurrentFile('test.csv');
        
        bleStats.reset();
        const stats = bleStats.getStats();
        
        expect(stats.discoveredDevices).toBe(0);
        expect(stats.dataCounter).toBe(0);
        expect(stats.connectionState).toBeNull();
        expect(stats.lastUpdate).toBeNull();
        expect(stats.session.startTime).toBeTruthy();
        expect(stats.session.currentFile).toBeNull();
    });

    test('should calculate uptime correctly', () => {
        jest.useFakeTimers();
        
        // Imposta un tempo di inizio fisso
        const startTime = new Date('2025-02-02T17:55:43.000Z');
        bleStats.stats.session.startTime = startTime.toISOString();
        
        // Avanza il tempo di 5 secondi
        jest.setSystemTime(startTime.getTime() + 5000);
        
        const stats = bleStats.getStats();
        expect(stats.uptime).toBe(5); // Dovrebbe essere 5 secondi
    });

    test('should handle multiple operations correctly', () => {
        bleStats.incrementDiscoveredDevices();
        bleStats.incrementDataCounter();
        bleStats.incrementDataCounter();
        bleStats.updateConnectionState('scanning');
        
        const stats = bleStats.getStats();
        expect(stats.discoveredDevices).toBe(1);
        expect(stats.dataCounter).toBe(2);
        expect(stats.connectionState).toBe('scanning');
        expect(stats.lastUpdate).toBeTruthy();
    });
});