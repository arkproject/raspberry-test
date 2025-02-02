/**
 * Test suite for BLEStatistics class
 * Created: 2025-02-02 17:44:27
 * Author: arkproject
 */

const BLEStatistics = require('../../src/utils/BLEStatistics');
const { getCurrentTimestamp } = require('../../src/utils/dateUtils');

describe('BLEStatistics', () => {
    let bleStats;

    beforeEach(() => {
        bleStats = new BLEStatistics();
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
        // Mock getCurrentTimestamp to return a fixed time
        const startTime = '2025-02-02 17:44:27';
        jest.spyOn(Date.prototype, 'getTime').mockImplementation(() => {
            return new Date(startTime).getTime() + 5000; // Add 5 seconds
        });

        const stats = bleStats.getStats();
        expect(stats.uptime).toBe(5); // Should be 5 seconds

        jest.restoreAllMocks();
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