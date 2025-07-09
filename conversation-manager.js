// conversation-manager.js
// Enhanced conversation management system for WhatsApp bot
// Handles conversation history, context management, and user session persistence

// Store conversation messages for each user to maintain conversation continuity
const userConversations = new Map();

// Enhanced conversation management settings
const CONVERSATION_CONFIG = {
    MAX_MESSAGES: 20,           // Maximum messages to keep in history
    MAX_CONTEXT_TOKENS: 3500,   // Maximum total context tokens
    PRESERVE_SYSTEM_MSG: true,  // Always keep system message
    PRESERVE_RECENT_PAIRS: 3,   // Keep last N user-assistant pairs
    CHARS_PER_TOKEN: 4,         // Rough estimation for token calculation
    SUMMARIZATION_THRESHOLD: 15 // Summarize when exceeding this many messages
};

// Extract meaningful keywords from text
function extractKeywords(text) {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'what', 'how', 'when', 'where', 'why', 'who']);

    return text.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word))
        .map(word => word.replace(/[^\w]/g, ''));
}

// Enhanced conversation history management functions
function calculateContextTokens(messages) {
    return messages.reduce((total, msg) => {
        return total + Math.ceil((msg.content?.length || 0) / CONVERSATION_CONFIG.CHARS_PER_TOKEN);
    }, 0);
}

function pruneConversationHistory(messages) {
    if (messages.length <= 3) return messages; // Keep minimal conversations intact

    const systemMessage = messages[0]; // Always preserve system message

    // Calculate current token usage
    let currentTokens = calculateContextTokens(messages);

    // If we're within limits, return as is
    if (currentTokens <= CONVERSATION_CONFIG.MAX_CONTEXT_TOKENS &&
        messages.length <= CONVERSATION_CONFIG.MAX_MESSAGES) {
        return messages;
    }

    console.log(`🔄 Pruning conversation: ${messages.length} messages, ~${currentTokens} tokens`);

    // Strategy: Keep recent pairs + summarize older content
    if (messages.length > CONVERSATION_CONFIG.SUMMARIZATION_THRESHOLD) {
        return summarizeAndPruneConversation(messages);
    }

    // Simple truncation - keep most recent pairs
    const otherMessages = messages.slice(1);
    const recentPairs = CONVERSATION_CONFIG.PRESERVE_RECENT_PAIRS * 2;
    const messagesToKeep = Math.min(recentPairs, otherMessages.length);
    const keptMessages = otherMessages.slice(-messagesToKeep);

    const prunedMessages = [systemMessage, ...keptMessages];
    const newTokens = calculateContextTokens(prunedMessages);

    console.log(`✂️ Pruned to ${prunedMessages.length} messages, ~${newTokens} tokens`);

    return prunedMessages;
}

function summarizeAndPruneConversation(messages) {
    const systemMessage = messages[0];
    const conversationMessages = messages.slice(1);

    // Keep the last 6 messages (3 pairs) as recent context
    const recentMessages = conversationMessages.slice(-6);
    const olderMessages = conversationMessages.slice(0, -6);

    if (olderMessages.length === 0) {
        return [systemMessage, ...recentMessages];
    }

    // Create a summary of older conversation
    const summary = createConversationSummary(olderMessages);

    // Create summary message
    const summaryMessage = {
        role: "system",
        content: `[CONVERSATION SUMMARY] Previous context: ${summary}`
    };

    console.log(`📝 Summarized ${olderMessages.length} older messages`);

    return [systemMessage, summaryMessage, ...recentMessages];
}

function createConversationSummary(messages) {
    const topics = new Set();
    const keyInfo = [];

    messages.forEach(msg => {
        if (msg.role === 'user') {
            const keywords = extractKeywords(msg.content);
            keywords.slice(0, 3).forEach(kw => topics.add(kw));
        } else if (msg.role === 'assistant') {
            const content = msg.content;

            // Extract key information patterns
            if (content.includes('UGX') && keyInfo.length < 2) {
                const priceMatch = content.match(/UGX\s*[\d,]+/);
                if (priceMatch) keyInfo.push(`Pricing: ${priceMatch[0]}`);
            }

            if (content.includes('Toyota') && !keyInfo.some(i => i.includes('vehicle'))) {
                const vehicleMatch = content.match(/Toyota\s+\w+/);
                if (vehicleMatch) keyInfo.push(`Vehicle: ${vehicleMatch[0]}`);
            }
        }
    });

    const topicsSummary = Array.from(topics).slice(0, 4).join(', ');
    const infoSummary = keyInfo.slice(0, 2).join('; ');

    return `Topics: ${topicsSummary}. ${infoSummary}`.substring(0, 150);
}

// Optimize context length to prevent token overflow while maintaining quality
function optimizeContextLength(chunks, processedQuery) {
    const MAX_TOTAL_CHARS = 2000; // Conservative limit for context
    const MIN_CHUNK_CHARS = 100; // Minimum useful chunk size

    if (chunks.length === 0) return chunks;

    let totalLength = 0;
    const optimized = [];

    // Sort by score to prioritize highest quality chunks
    const sortedChunks = [...chunks].sort((a, b) => b.score - a.score);

    for (let chunk of sortedChunks) {
        const chunkLength = chunk.chunk.length;

        // Skip very short chunks unless they have exceptional scores
        if (chunkLength < MIN_CHUNK_CHARS && chunk.score < 10) {
            continue;
        }

        // Check if adding this chunk would exceed our limit
        if (totalLength + chunkLength > MAX_TOTAL_CHARS && optimized.length > 0) {
            // Try to trim the chunk to fit if it's highly relevant
            if (chunk.score > 8 && totalLength < MAX_TOTAL_CHARS * 0.8) {
                const remainingSpace = MAX_TOTAL_CHARS - totalLength;
                const trimmedChunk = {
                    ...chunk,
                    chunk: chunk.chunk.substring(0, remainingSpace - 50) + "..." // Leave some buffer
                };
                optimized.push(trimmedChunk);
                break;
            } else {
                break; // Stop adding chunks
            }
        }

        optimized.push(chunk);
        totalLength += chunkLength;
    }

    // Ensure we have at least one chunk if any were provided
    if (optimized.length === 0 && chunks.length > 0) {
        const bestChunk = chunks[0];
        if (bestChunk.chunk.length > MAX_TOTAL_CHARS) {
            optimized.push({
                ...bestChunk,
                chunk: bestChunk.chunk.substring(0, MAX_TOTAL_CHARS - 100) + "..."
            });
        } else {
            optimized.push(bestChunk);
        }
    }

    return optimized;
}

// Utility functions for managing user conversations

/**
 * Clear conversation history for a specific user
 * @param {string} userId - The user identifier
 */
function clearUserConversation(userId) {
    if (userConversations.has(userId)) {
        userConversations.delete(userId);
        console.log(`Cleared conversation history for user ${userId}`);
        return true;
    }
    return false;
}

/**
 * Get all active conversations count
 * @returns {number} Number of active conversations
 */
function getActiveConversationsCount() {
    return userConversations.size;
}

/**
 * Clear all conversations (useful for cleanup)
 */
function clearAllConversations() {
    const count = userConversations.size;
    userConversations.clear();
    console.log(`Cleared ${count} conversation(s)`);
    return count;
}

/**
 * Get conversation status for a user
 * @param {string} userId - The user identifier
 * @returns {object} Conversation status
 */
function getConversationStatus(userId) {
    const messages = userConversations.get(userId);
    return {
        hasActiveConversation: userConversations.has(userId),
        messageCount: messages ? messages.length : 0,
        totalActiveConversations: userConversations.size
    };
}

/**
 * Get the conversation messages for a specific user
 * @param {string} userId - The user identifier
 * @returns {Array|null} The conversation messages or null if not found
 */
function getUserMessages(userId) {
    return userConversations.get(userId) || null;
}

/**
 * Set the conversation messages for a specific user
 * @param {string} userId - The user identifier
 * @param {Array} messages - The messages array to store
 */
function setUserMessages(userId, messages) {
    userConversations.set(userId, messages);
    console.log(`Stored ${messages.length} messages for user ${userId}`);
}

/**
 * Add a message to a user's conversation
 * @param {string} userId - The user identifier
 * @param {object} message - The message object to add
 */
function addMessageToUserConversation(userId, message) {
    let messages = userConversations.get(userId) || [];
    messages.push(message);
    userConversations.set(userId, messages);
    console.log(`Added message to user ${userId} conversation (${messages.length} total messages)`);
}

/**
 * Initialize or update system message for a user conversation
 * @param {string} userId - The user identifier
 * @param {string} context - The context to include in the system message
 * @returns {Array} The updated messages array
 */
function initializeOrUpdateSystemMessage(userId, context) {
    let messages = userConversations.get(userId) || [];

    const systemMessageContent = `You are the customer care representative for Babu Motors Uganda, a well-established vehicle leasing company in Kampala.
You are currently replying on WhatsApp.

${messages.length > 0 ? 'This is a continuation of an ongoing conversation with this customer.\n' : ''}
CONTEXT PROCESSING GUIDELINES:
- Prioritize information marked with 🎯 HIGHLY RELEVANT above all else
- Use ✅ RELEVANT information to supplement your response
- Only reference 📋 CONTEXT and 💡 REFERENCE if needed for completeness
- Focus on the most specific and actionable information
- Keep responses concise and avoid repeating similar information from multiple sources
${messages.length > 0 ? '- Maintain conversational context and acknowledge previous interactions naturally\n' : ''}
If the context doesn't contain sufficient information, acknowledge what you know and suggest contacting Babu Motors Uganda directly.

Always be friendly, professional, and helpful. Emphasize Babu Motors Uganda's reputation for quality imported Japanese vehicles and flexible payment options.

Keep responses concise, natural and helpful. End with an offer to help further or suggest direct contact for specific services.

FOCUSED CONTEXT:
${context}`;

    if (messages.length === 0) {
        // Initialize new conversation with system message
        messages.push({
            role: "system",
            content: systemMessageContent
        });
    } else {
        // Update existing system message
        messages[0] = {
            role: "system",
            content: systemMessageContent
        };
    }

    userConversations.set(userId, messages);
    return messages;
}

/**
 * Prepare conversation messages with pruning and context management
 * @param {string} userId - The user identifier
 * @param {string} context - The RAG context to include
 * @param {string} userQuestion - The user's current question
 * @returns {Array} The prepared messages array
 */
function prepareConversationMessages(userId, context, userQuestion) {
    // Initialize or update system message with current context
    let messages = initializeOrUpdateSystemMessage(userId, context);

    // Prune conversation history to prevent context overflow
    if (messages.length > 1) {
        messages = pruneConversationHistory(messages);
        console.log(`💬 Using ${messages.length} messages for context (~${calculateContextTokens(messages)} tokens)`);
    }

    // Add the current user question
    messages.push({ role: "user", content: userQuestion });

    // Update the stored conversation
    userConversations.set(userId, messages);

    return messages;
}

/**
 * Add assistant response to conversation and store it
 * @param {string} userId - The user identifier
 * @param {object} assistantMessage - The assistant's response message
 */
function addAssistantResponse(userId, assistantMessage) {
    let messages = userConversations.get(userId) || [];
    messages.push(assistantMessage);
    userConversations.set(userId, messages);
    console.log(`💾 Updated conversation for user ${userId} (${messages.length} messages)`);
}

export {
    // Core conversation management
    prepareConversationMessages,
    addAssistantResponse,
    pruneConversationHistory,
    calculateContextTokens,
    optimizeContextLength,

    // User conversation utilities
    clearUserConversation,
    getActiveConversationsCount,
    clearAllConversations,
    getConversationStatus,
    getUserMessages,
    setUserMessages,
    addMessageToUserConversation,

    // Internal functions (exported for testing)
    createConversationSummary,
    summarizeAndPruneConversation,
    initializeOrUpdateSystemMessage,

    // Configuration
    CONVERSATION_CONFIG
};
