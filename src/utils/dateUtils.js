function formatDateTime(date) {
    return date.toISOString()
        .replace('T', '_')
        .replace(/:/g, '-')
        .split('.')[0];
}

function getCurrentTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

module.exports = {
    formatDateTime,
    getCurrentTimestamp
};