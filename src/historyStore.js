// In-memory message history store
const historyMap = new Map();

// Add a message to a user's history
export function addMessage(phoneNumber, role, content, maxHistory = 20) {
    if (!historyMap.has(phoneNumber)) {
        historyMap.set(phoneNumber, []);
    }
    const history = historyMap.get(phoneNumber);
    history.push({ role, content });
    // Keep only the last maxHistory messages
    if (history.length > maxHistory) {
        history.splice(0, history.length - maxHistory);
    }
}

// Get a user's message history (oldest first)
export function getHistory(phoneNumber, limit = 20) {
    const history = historyMap.get(phoneNumber) || [];
    return history.slice(-limit);
}

// Optional: clear a user's history
export function clearHistory(phoneNumber) {
    historyMap.delete(phoneNumber);
} 