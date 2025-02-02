class BLETimeout {
    async withTimeout(promise, timeoutMs, operation) {
        return Promise.race([
            promise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`${operation} timeout after ${timeoutMs}ms`)), 
                timeoutMs)
            )
        ]);
    }
}

module.exports = BLETimeout;