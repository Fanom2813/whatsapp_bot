// rag-system.js
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import OpenAI from "openai";
import {
    prepareConversationMessages,
    addAssistantResponse,
    calculateContextTokens,
    optimizeContextLength,
    clearUserConversation,
    getActiveConversationsCount,
    clearAllConversations,
    getConversationStatus,
    getUserMessages,
    setUserMessages,
    addMessageToUserConversation
} from './conversation-manager.js';
import {
    initializeKnowledgeBase,
    getKnowledgeCache,
    resetKnowledgeCache,
    getKnowledgeBaseStats
} from './knowledge-base.js';
import {
    calculateSimilarity,
    extractKeywords,
    fuzzySearchInText,
    scoreDocumentChunk,
    findBestMatches,
    validateSearchResults
} from './scoring-utils.js';

dotenv.config();

// Use OpenRouter API configuration
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENAI_API_KEY
});

// Rate limiting for API calls
const rateLimiter = {
    lastRequestTime: 0,
    minInterval: 2000, // Minimum 2 seconds between requests
    requestQueue: [],
    isProcessing: false
};

async function findRelevantContext(question, maxChunks = 3) {
    const knowledgeCache = getKnowledgeCache();
    if (knowledgeCache.chunks.length === 0) {
        throw new Error('Knowledge base not initialized');
    }

    try {
        // Preprocess the query for intelligent matching
        const processedQuery = question.toLowerCase();

        // Calculate similarity scores using enhanced intelligent algorithm
        const similarities = knowledgeCache.chunks
            .map((chunk, i) => {
                const scoreResult = scoreDocumentChunk(
                    processedQuery,
                    chunk.content || chunk
                );

                return {
                    index: i,
                    score: typeof scoreResult === 'object' ? scoreResult.score : scoreResult,
                    scoreBreakdown: typeof scoreResult === 'object' ? scoreResult.breakdown : null,
                    weights: typeof scoreResult === 'object' ? scoreResult.weights : null,
                    metadata: {
                        ...knowledgeCache.chunkMetadata[i],
                        ...(typeof scoreResult === 'object' ? scoreResult.metadata : {})
                    },
                    chunk: chunk
                };
            })
            .filter(item => item.score > 5.0) // Adjusted threshold for new scoring scale
            .sort((a, b) => b.score - a.score);

        // Enhanced dynamic chunk selection with quality-first approach
        let selectedChunks = [];
        if (similarities.length > 0) {
            const topScore = similarities[0].score;

            // More aggressive filtering - only include high-quality matches
            const qualityThreshold = Math.max(topScore * 0.6, 15.0); // At least 60% of top score or minimum score of 15

            selectedChunks = similarities.filter(item =>
                item.score >= qualityThreshold && selectedChunks.length < maxChunks
            );

            // If we get too few high-quality matches, gradually lower threshold
            if (selectedChunks.length === 0 && similarities.length > 0) {
                const fallbackThreshold = Math.max(topScore * 0.4, 8.0);
                selectedChunks = similarities
                    .filter(item => item.score >= fallbackThreshold)
                    .slice(0, Math.min(2, maxChunks)); // Limit to 2 chunks for lower quality matches
            }
        }

        // Enhanced deduplication and diversity filtering
        selectedChunks = enhancedDiversityFilter(selectedChunks);

        // Context length optimization - ensure we don't exceed token limits
        selectedChunks = optimizeContextLength(selectedChunks, processedQuery);

        return selectedChunks;
    } catch (error) {
        console.error('Error finding relevant context:', error);
        throw error;
    }
}

// Enhanced diversity and quality filtering to prevent information overload
function enhancedDiversityFilter(chunks) {
    if (chunks.length <= 1) return chunks;

    const filtered = [];
    const SIMILARITY_THRESHOLD = 0.7; // More aggressive deduplication
    const MAX_CONTEXT_OVERLAP = 0.5; // Maximum allowed content overlap

    for (let chunk of chunks) {
        let shouldInclude = true;

        for (let existing of filtered) {
            // Check for content similarity
            const contentSimilarity = calculateSimilarity(
                chunk.chunk.substring(0, 300), // Check first 300 chars for efficiency
                existing.chunk.substring(0, 300)
            );

            // Check for keyword overlap (simple calculation)
            const keywordOverlap = chunk.metadata.keywords && existing.metadata.keywords ?
                chunk.metadata.keywords.filter(k => existing.metadata.keywords.includes(k)).length /
                Math.max(chunk.metadata.keywords.length, existing.metadata.keywords.length) : 0;

            if (contentSimilarity > SIMILARITY_THRESHOLD || keywordOverlap > MAX_CONTEXT_OVERLAP) {
                // Keep the chunk with higher score and better relevance
                if (chunk.score > existing.score * 1.2) { // 20% buffer for replacement
                    const index = filtered.indexOf(existing);
                    filtered[index] = chunk;
                }
                shouldInclude = false;
                break;
            }
        }

        if (shouldInclude) {
            filtered.push(chunk);
        }
    }

    return filtered;
}

// Update the answerWithRAG function to use conversation management
async function answerWithRAG(question, filePath, userId = null) {
    try {
        console.log(`Processing question for user ${userId || 'anonymous'}: "${question}"`);

        // Only initialize knowledge base when a question is asked (lazy loading)
        const knowledgeCache = getKnowledgeCache();
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

        // Prepare focused context from top relevant chunks
        const context = relevantChunks
            .map((chunk, index) => {
                // Enhanced relevance labeling with more granular categories
                const relevanceLabel = chunk.score > 20 ? "🎯 HIGHLY RELEVANT" :
                    chunk.score > 12 ? "✅ RELEVANT" :
                        chunk.score > 6 ? "📋 CONTEXT" : "💡 REFERENCE";

                // Truncate very long chunks to essential information
                const truncatedChunk = chunk.chunk.length > 800 ?
                    chunk.chunk.substring(0, 750) + "..." : chunk.chunk;

                return `[${relevanceLabel}] ${truncatedChunk}`;
            })
            .join("\n---\n");

        // Enhanced logging with quality metrics
        console.log('\n🧠 ENHANCED RAG ANALYSIS');
        console.log(`📊 Query: "${question}"`);
        console.log(`🔍 Chunks found: ${relevantChunks.length}/${getKnowledgeCache().chunks.length}`);
        console.log(`📏 Total context length: ${context.length} chars`);

        // Validate context quality using available function
        const qualityAnalysis = validateSearchResults(relevantChunks, question);
        console.log(`🎯 Context Quality: ${qualityAnalysis.quality} (Score: ${qualityAnalysis.score || 'N/A'})`);
        if (qualityAnalysis.recommendations && qualityAnalysis.recommendations.length > 0) {
            console.log(`💡 Recommendations: ${qualityAnalysis.recommendations.join(', ')}`);
        }

        relevantChunks.forEach((chunk, i) => {
            const quality = chunk.score > 50 ? "EXCELLENT" :
                chunk.score > 30 ? "GOOD" :
                    chunk.score > 15 ? "FAIR" : "POOR";
            console.log(`  ${i + 1}. Score: ${chunk.score.toFixed(2)} (${quality}) | Words: ${chunk.metadata.wordCount} | Preview: "${chunk.chunk.substring(0, 80)}..."`);
        });
        console.log('=== END ANALYSIS ===\n');

        // Prepare conversation messages with the conversation manager
        const messages = prepareConversationMessages(userId, context, question);

        // Generate response using chat completions
        const assistantMessage = await makeAPICall(messages, 500);

        // Validate assistant message
        if (!assistantMessage || !assistantMessage.content) {
            throw new Error('Invalid assistant response received');
        }

        // Add the assistant's response to the conversation using conversation manager
        if (userId) {
            addAssistantResponse(userId, assistantMessage);
        }

        return assistantMessage.content;
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

// Enhanced API call with automatic token management
async function makeAPICall(messages, maxTokens = 400) {
    try {
        // Use the imported calculateContextTokens function
        const estimatedInputTokens = calculateContextTokens(messages);

        // Adjust maxTokens based on input length to prevent context overflow
        let adjustedMaxTokens = maxTokens;
        if (estimatedInputTokens > 3000) {
            adjustedMaxTokens = Math.min(300, maxTokens); // Reduce output for long contexts
        } else if (estimatedInputTokens > 2000) {
            adjustedMaxTokens = Math.min(350, maxTokens);
        }

        console.log(`🤖 API Call - Estimated input tokens: ${estimatedInputTokens}, Max output: ${adjustedMaxTokens}`);

        const response = await openai.chat.completions.create({
            model: "deepseek/deepseek-chat-v3-0324:free",
            messages: messages,
            temperature: 0.2, // Lower temperature for more focused responses
            max_tokens: adjustedMaxTokens,
            presence_penalty: 0.1, // Slight penalty to avoid repetition
            frequency_penalty: 0.1
        });

        if (!response || !response.choices || !response.choices[0]) {
            throw new Error('Invalid response structure from API');
        }

        return response.choices[0].message;
    } catch (error) {
        console.error('API call failed:', error.message);

        // Handle specific token limit errors
        if (error.message.includes('maximum context length') || error.message.includes('token')) {
            console.log('🔄 Token limit exceeded, retrying with reduced context...');
            // Retry with minimal context
            const minimalMessages = [
                messages[0], // System message
                messages[messages.length - 1] // Latest user message only
            ];

            // Update system message to be more concise
            minimalMessages[0] = {
                ...minimalMessages[0],
                content: minimalMessages[0].content.substring(0, 1000) + "\n[Context truncated due to length]"
            };

            return await openai.chat.completions.create({
                model: "deepseek/deepseek-chat-v3-0324:free",
                messages: minimalMessages,
                temperature: 0.2,
                max_tokens: 300
            }).then(response => {
                if (!response || !response.choices || !response.choices[0]) {
                    throw new Error('Invalid response structure from API in retry');
                }
                return response.choices[0].message;
            });
        }

        throw error;
    }
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
    getRateLimiterStatus,
    resetRateLimiter,
    // Re-export knowledge base functions for compatibility
    initializeKnowledgeBase,
    getKnowledgeCache,
    resetKnowledgeCache,
    getKnowledgeBaseStats,
    // Re-export scoring functions for compatibility
    calculateSimilarity,
    extractKeywords,
    fuzzySearchInText,
    scoreDocumentChunk,
    findBestMatches,
    validateSearchResults,
    // Re-export conversation management functions for compatibility
    prepareConversationMessages,
    addAssistantResponse,
    calculateContextTokens,
    optimizeContextLength,
    clearUserConversation,
    getActiveConversationsCount,
    clearAllConversations,
    getConversationStatus,
    getUserMessages,
    setUserMessages,
    addMessageToUserConversation
};