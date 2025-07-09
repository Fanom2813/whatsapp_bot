// rag-system.js
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

// Use OpenRouter API configuration
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENAI_API_KEY
});

// Enhanced cache for knowledge chunks with metadata
let knowledgeCache = {
    chunks: [],
    chunkMetadata: [], // Store metadata for each chunk
    termFrequency: new Map(), // Track term frequencies across corpus
    lastModified: null
};

// Store the last response ID for each user to maintain conversation continuity
const userConversations = new Map();

// Rate limiting for API calls
const rateLimiter = {
    lastRequestTime: 0,
    minInterval: 2000, // Minimum 2 seconds between requests
    requestQueue: [],
    isProcessing: false
};

// Intelligent semantic chunking that respects sentence boundaries
async function loadAndChunkMarkdown(filePath, maxLen = 500) {
    const text = await fs.readFile(filePath, "utf8");

    // Split by paragraphs first, then by sentences
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
    const chunks = [];

    for (let paragraph of paragraphs) {
        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        let currentChunk = "";

        for (let sentence of sentences) {
            if ((currentChunk + sentence).length > maxLen && currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = sentence;
            } else {
                currentChunk += (currentChunk ? " " : "") + sentence;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }
    }

    return chunks.filter(c => c.length > 20); // Filter out very short chunks
}

// Enhanced similarity scoring with TF-IDF principles and semantic understanding
function calculateIntelligentScore(text, processedQuery, termFreq, totalChunks) {
    const textLower = text.toLowerCase();
    const { original, expanded, keywords } = processedQuery;
    let score = 0;

    // 1. Exact phrase matching (highest weight)
    if (textLower.includes(original.toLowerCase())) {
        score += 20;
    }

    // 2. TF-IDF like scoring for keywords
    keywords.forEach(keyword => {
        if (textLower.includes(keyword)) {
            const termData = termFreq.get(keyword);
            if (termData) {
                // Term frequency in document
                const tf = (textLower.match(new RegExp(keyword, 'g')) || []).length;
                // Inverse document frequency
                const idf = Math.log(totalChunks / termData.documentCount);
                score += tf * idf * 3;
            } else {
                score += 2; // Base score for keyword match
            }
        }
    });

    // 3. Semantic proximity scoring
    const textWords = extractKeywords(text);
    let semanticMatches = 0;
    keywords.forEach(queryWord => {
        textWords.forEach(textWord => {
            // Check for partial matches and similar words
            if (textWord.includes(queryWord) || queryWord.includes(textWord)) {
                semanticMatches++;
            }
            // Check for word similarity (simple edit distance)
            if (calculateSimilarity(queryWord, textWord) > 0.7) {
                semanticMatches++;
            }
        });
    });
    score += semanticMatches * 1.5;

    // 4. Context density bonus (keywords appearing close together)
    if (keywords.length > 1) {
        let contextBonus = 0;
        for (let i = 0; i < keywords.length - 1; i++) {
            const word1 = keywords[i];
            const word2 = keywords[i + 1];
            const word1Index = textLower.indexOf(word1);
            const word2Index = textLower.indexOf(word2);

            if (word1Index !== -1 && word2Index !== -1) {
                const distance = Math.abs(word1Index - word2Index);
                if (distance < 100) { // Words within 100 characters
                    contextBonus += Math.max(0, (100 - distance) / 10);
                }
            }
        }
        score += contextBonus;
    }

    // 5. Length normalization (avoid bias towards longer texts)
    score = score / Math.sqrt(text.length / 100);

    return score;
}

// Simple string similarity calculation
function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
}

// Levenshtein distance for string similarity
function levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

// Enhanced query preprocessing with synonyms and related terms
function preprocessQuery(query) {
    const synonyms = {
        'car': ['vehicle', 'automobile', 'auto'],
        'buy': ['purchase', 'acquire', 'get'],
        'lease': ['rent', 'hire', 'financing'],
        'price': ['cost', 'rate', 'fee', 'payment'],
        'japanese': ['japan', 'toyota', 'honda', 'nissan', 'mazda', 'subaru'],
        'payment': ['installment', 'deposit', 'down payment', 'monthly'],
        'contact': ['reach', 'call', 'phone', 'talk'],
        'location': ['address', 'where', 'place', 'office'],
        'service': ['maintenance', 'repair', 'support']
    };

    let expandedQuery = query.toLowerCase();

    // Add synonyms to query for better matching
    Object.entries(synonyms).forEach(([key, values]) => {
        if (expandedQuery.includes(key)) {
            values.forEach(synonym => {
                if (!expandedQuery.includes(synonym)) {
                    expandedQuery += ' ' + synonym;
                }
            });
        }
    });

    return {
        original: query,
        expanded: expandedQuery,
        keywords: extractKeywords(expandedQuery)
    };
}

// Extract meaningful keywords from query
function extractKeywords(text) {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'what', 'how', 'when', 'where', 'why', 'who']);

    return text.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word))
        .map(word => word.replace(/[^\w]/g, ''));
}

// Build term frequency map for TF-IDF like scoring
function buildTermFrequency(chunks) {
    const termFreq = new Map();

    chunks.forEach(chunk => {
        const words = extractKeywords(chunk);
        const wordCounts = new Map();

        // Count word frequencies in this chunk
        words.forEach(word => {
            wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
        });

        // Update global term frequency
        wordCounts.forEach((count, word) => {
            if (!termFreq.has(word)) {
                termFreq.set(word, { totalCount: 0, documentCount: 0 });
            }
            termFreq.get(word).totalCount += count;
            termFreq.get(word).documentCount += 1;
        });
    });

    return termFreq;
}

async function initializeKnowledgeBase(filePath) {
    try {
        const stats = await fs.stat(filePath);

        // Check if we need to reload (file modified or cache empty)
        if (knowledgeCache.lastModified &&
            knowledgeCache.lastModified.getTime() === stats.mtime.getTime() &&
            knowledgeCache.chunks.length > 0) {
            console.log('Knowledge base already loaded and up-to-date.');
            return; // Use cached data
        }

        console.log('Loading knowledge base on-demand...');
        const chunks = await loadAndChunkMarkdown(filePath);

        // Build term frequency map for intelligent scoring
        const termFreq = buildTermFrequency(chunks);

        // Create metadata for each chunk
        const chunkMetadata = chunks.map((chunk, index) => ({
            id: index,
            length: chunk.length,
            keywords: extractKeywords(chunk),
            wordCount: chunk.split(/\s+/).length,
            sentences: chunk.split(/[.!?]+/).filter(s => s.trim()).length
        }));

        // Update cache with enhanced data
        knowledgeCache = {
            chunks,
            chunkMetadata,
            termFrequency: termFreq,
            lastModified: stats.mtime
        };

        console.log(`Knowledge base loaded on-demand: ${chunks.length} chunks processed with intelligent indexing`);
    } catch (error) {
        console.error('Error initializing knowledge base:', error);
        throw error;
    }
}

async function findRelevantContext(question, maxChunks = 5) {
    if (knowledgeCache.chunks.length === 0) {
        throw new Error('Knowledge base not initialized');
    }

    try {
        // Preprocess the query for intelligent matching
        const processedQuery = preprocessQuery(question);

        // Calculate similarity scores using intelligent algorithm
        const similarities = knowledgeCache.chunks
            .map((chunk, i) => ({
                index: i,
                score: calculateIntelligentScore(
                    chunk,
                    processedQuery,
                    knowledgeCache.termFrequency,
                    knowledgeCache.chunks.length
                ),
                chunk: chunk,
                metadata: knowledgeCache.chunkMetadata[i]
            }))
            .filter(item => item.score > 0.5) // Higher threshold for relevance
            .sort((a, b) => b.score - a.score);

        // Dynamic chunk selection based on score distribution
        let selectedChunks = [];
        if (similarities.length > 0) {
            const topScore = similarities[0].score;
            const threshold = topScore * 0.3; // Include chunks with at least 30% of top score

            selectedChunks = similarities.filter(item =>
                item.score >= threshold && selectedChunks.length < maxChunks
            );

            // Ensure at least one chunk if any were found
            if (selectedChunks.length === 0 && similarities.length > 0) {
                selectedChunks = [similarities[0]];
            }
        }

        // Remove redundant chunks (similar content)
        selectedChunks = removeDuplicateChunks(selectedChunks);

        return selectedChunks;
    } catch (error) {
        console.error('Error finding relevant context:', error);
        throw error;
    }
}

// Remove chunks with very similar content to avoid redundancy
function removeDuplicateChunks(chunks) {
    const filtered = [];

    for (let chunk of chunks) {
        let isDuplicate = false;

        for (let existing of filtered) {
            const similarity = calculateSimilarity(
                chunk.chunk.substring(0, 200),
                existing.chunk.substring(0, 200)
            );

            if (similarity > 0.8) {
                isDuplicate = true;
                // Keep the one with higher score
                if (chunk.score > existing.score) {
                    const index = filtered.indexOf(existing);
                    filtered[index] = chunk;
                }
                break;
            }
        }

        if (!isDuplicate) {
            filtered.push(chunk);
        }
    }

    return filtered;
}

async function answerWithRAG(question, filePath, userId = null) {
    try {
        console.log(`Processing question for user ${userId || 'anonymous'}: "${question}"`);

        // Only initialize knowledge base when a question is asked (lazy loading)
        if (knowledgeCache.chunks.length === 0) {
            console.log('Knowledge base not loaded yet. Loading now...');
            await initializeKnowledgeBase(filePath);
        } else {
            // Check if file was modified and reload if needed
            try {
                const stats = await fs.stat(filePath);
                if (knowledgeCache.lastModified &&
                    knowledgeCache.lastModified.getTime() !== stats.mtime.getTime()) {
                    console.log('Knowledge base file updated. Reloading...');
                    await initializeKnowledgeBase(filePath);
                }
            } catch (error) {
                console.warn('Could not check file modification time:', error.message);
            }
        }

        // Find relevant context
        const relevantChunks = await findRelevantContext(question);

        if (relevantChunks.length === 0) {
            return "I don't have enough information to answer that question. Please contact Babu Motors Uganda directly for specific details.";
        }

        // Prepare context from relevant chunks with intelligent ordering
        const context = relevantChunks
            .map((chunk, index) => {
                // Add relevance indicator for the AI
                const relevanceLabel = chunk.score > 15 ? "HIGH RELEVANCE" :
                    chunk.score > 8 ? "MEDIUM RELEVANCE" : "LOW RELEVANCE";
                return `[${relevanceLabel}] ${chunk.chunk}`;
            })
            .join("\n---\n");


        console.log('\n--- Intelligent RAG Analysis ---');
        console.log(`Query processed: "${relevantChunks.length > 0 ? 'Found relevant content' : 'No relevant content found'}"`);
        relevantChunks.forEach((chunk, i) => {
            console.log(`Chunk ${i + 1} (Score: ${chunk.score.toFixed(2)}, Words: ${chunk.metadata.wordCount}): ${chunk.chunk.substring(0, 100)}...`);
        });
        console.log('=== END ANALYSIS ===\n');

        // Get the previous response ID for this user (if any)
        const previousResponseId = userId ? userConversations.get(userId) : null;

        // Prepare conversation context for continuity
        const conversationContext = previousResponseId ? `

CONVERSATION CONTINUITY: This is a continuation of an ongoing conversation with this customer. 
Previous Response ID: ${previousResponseId}
Customer ID: ${userId}

Please maintain conversational context and acknowledge any relevant previous interactions naturally. 
Refer back to previous topics discussed if relevant to the current question.
The customer may have previously asked about account services or general company information.
` : "";

        // Prepare the request object with optimized parameters for free tier
        const requestParams = {
            model: "deepseek/deepseek-chat-v3-0324:free",
            instructions: `You are the in charge customer care person for Babu Motors Uganda, a well-established leasing car company in Uganda, Kampala.
you are currently replying on whatsapp

${conversationContext}

Use the provided context to answer questions accurately. The context includes relevance labels (HIGH/MEDIUM/LOW RELEVANCE) - prioritize information marked as HIGH RELEVANCE for your response.

If the context doesn't contain enough information to fully answer a question, acknowledge what you know and suggest contacting Babu Motors Uganda directly for more details.

Always be friendly, professional, and helpful. Emphasize Babu Motors Uganda's reputation for quality imported Japanese vehicles and flexible payment options.

Keep responses concise, short, natural and helpful. Always end with an offer to help further or suggest they contact Babu Motors Uganda directly for specific services.

Focus on the most relevant information and avoid repeating similar details from different context sections.

If this is a continuing conversation, maintain natural flow and reference previous context when relevant.

Context from Babu Motors knowledge base:
${context}`,
            input: question,
            temperature: 0.3,
            max_tokens: 500, // Limit response length for free tier
            truncation: "auto" // Handle token limits automatically
        };

        // Add previous_response_id if this is a continuing conversation
        if (previousResponseId) {
            requestParams.previous_response_id = previousResponseId;
            console.log(`🔄 Continuing RAG conversation for user ${userId} with previous response: ${previousResponseId}`);
        } else if (userId) {
            console.log(`🆕 Starting new RAG conversation for user ${userId}`);
        }

        // Generate response using the enhanced API call with rate limiting
        const response = await makeAPICallWithRetry(requestParams);

        // Store the response ID for this user to maintain conversation continuity
        if (userId && response.id) {
            userConversations.set(userId, response.id);
            console.log(`💾 Stored RAG response ID ${response.id} for user ${userId}`);
        }

        return response.output_text;
    } catch (error) {
        console.error('Error in RAG system:', error);

        // Provide specific error messages based on error type
        if (error.status === 429) {
            return "I'm currently experiencing high demand. Please wait a moment and try again, or contact Babu Motors Uganda directly for immediate assistance.";
        } else if (error.status === 401) {
            return "There's an authentication issue with our system. Please contact Babu Motors Uganda directly for assistance.";
        } else {
            return "I'm sorry, I'm having technical difficulties. Please try asking your question in a different way, or contact Babu Motors Uganda directly for assistance.";
        }
    }
}

// Rate limiting function to prevent API rate limit errors
async function waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - rateLimiter.lastRequestTime;

    if (timeSinceLastRequest < rateLimiter.minInterval) {
        const waitTime = rateLimiter.minInterval - timeSinceLastRequest;
        console.log(`Rate limiting: waiting ${waitTime}ms before next request...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    rateLimiter.lastRequestTime = Date.now();
}

// Enhanced error handling for API calls with retry logic (rate limiting disabled)
async function makeAPICallWithRetry(requestParams, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Rate limiting disabled for faster responses
            // await waitForRateLimit();

            console.log(`Making API call (attempt ${attempt}/${maxRetries})...`);
            const response = await openai.responses.create(requestParams);
            return response;

        } catch (error) {
            console.error(`API call attempt ${attempt} failed:`, error.message);

            if (error.status === 429) {
                // Rate limit error - wait longer before retry
                const backoffTime = Math.min(5000 * attempt, 30000); // Max 30 seconds
                console.log(`Rate limit hit. Waiting ${backoffTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, backoffTime));

                if (attempt === maxRetries) {
                    return {
                        output_text: "I'm experiencing high demand right now. Please try again in a moment, or contact Babu Motors Uganda directly for immediate assistance."
                    };
                }
            } else if (attempt === maxRetries) {
                // Other errors or final attempt
                throw error;
            } else {
                // Wait before retry for other errors
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }
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
    return {
        hasActiveConversation: userConversations.has(userId),
        responseId: userConversations.get(userId) || null,
        totalActiveConversations: userConversations.size
    };
}

/**
 * Get the last response ID for a specific user
 * @param {string} userId - The user identifier
 * @returns {string|null} The last response ID or null if not found
 */
function getUserResponseId(userId) {
    return userConversations.get(userId) || null;
}

/**
 * Set the response ID for a specific user
 * @param {string} userId - The user identifier
 * @param {string} responseId - The response ID to store
 */
function setUserResponseId(userId, responseId) {
    userConversations.set(userId, responseId);
    console.log(`Stored response ID ${responseId} for user ${userId}`);
}

/**
 * Get rate limiter status and statistics
 * @returns {object} Rate limiter status
 */
function getRateLimiterStatus() {
    const now = Date.now();
    const timeSinceLastRequest = now - rateLimiter.lastRequestTime;

    return {
        lastRequestTime: rateLimiter.lastRequestTime,
        timeSinceLastRequest,
        minInterval: rateLimiter.minInterval,
        canMakeRequest: timeSinceLastRequest >= rateLimiter.minInterval,
        waitTimeRequired: Math.max(0, rateLimiter.minInterval - timeSinceLastRequest)
    };
}

/**
 * Reset rate limiter (useful for testing or manual reset)
 */
function resetRateLimiter() {
    rateLimiter.lastRequestTime = 0;
    console.log('Rate limiter reset');
}

export {
    answerWithRAG,
    initializeKnowledgeBase,
    clearUserConversation,
    getActiveConversationsCount,
    clearAllConversations,
    getConversationStatus,
    getUserResponseId,
    setUserResponseId,
    getRateLimiterStatus,
    resetRateLimiter
};
