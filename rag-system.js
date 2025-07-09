// rag-system.js
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import OpenAI from "openai";
import {
    prepareConversationMessages,
    addAssistantResponse,
    calculateContextTokens,
    clearUserConversation,
    getActiveConversationsCount,
    clearAllConversations,
    getConversationStatus,
    getUserMessages,
    setUserMessages,
    addMessageToUserConversation
} from './conversation-manager.js';

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

// Rate limiting for API calls
const rateLimiter = {
    lastRequestTime: 0,
    minInterval: 2000, // Minimum 2 seconds between requests
    requestQueue: [],
    isProcessing: false
};

// Enhanced semantic chunking with better boundary detection and content preservation
async function loadAndChunkMarkdown(filePath, maxLen = 400) {
    const text = await fs.readFile(filePath, "utf8");

    // Split by major sections first (headers and double line breaks)
    const sections = text.split(/\n(?=#+\s)|(?:\n\s*\n){2,}/).filter(p => p.trim());
    const chunks = [];

    for (let section of sections) {
        // Clean up the section
        const cleanSection = section.trim();
        if (cleanSection.length < 50) continue; // Skip very short sections

        // If section is small enough, keep it as one chunk
        if (cleanSection.length <= maxLen) {
            chunks.push(cleanSection);
            continue;
        }

        // For longer sections, split more intelligently
        const sentences = cleanSection.split(/(?<=[.!?:])\s+(?=[A-Z])/);
        let currentChunk = "";
        let chunkKeywords = new Set();

        for (let sentence of sentences) {
            const sentenceKeywords = new Set(extractKeywords(sentence));
            const proposedLength = (currentChunk + " " + sentence).length;

            // Check if adding this sentence would exceed length OR reduce coherence
            if (proposedLength > maxLen && currentChunk.trim()) {
                // Check for thematic coherence - if new sentence introduces many new topics, create new chunk
                const keywordOverlap = [...sentenceKeywords].filter(k => chunkKeywords.has(k)).length;
                const coherenceRatio = keywordOverlap / Math.max(sentenceKeywords.size, 1);

                if (coherenceRatio < 0.3 && currentChunk.length > 150) {
                    // Low coherence and chunk is substantial - start new chunk
                    chunks.push(currentChunk.trim());
                    currentChunk = sentence;
                    chunkKeywords = sentenceKeywords;
                } else {
                    // High coherence but length exceeded - start new chunk
                    chunks.push(currentChunk.trim());
                    currentChunk = sentence;
                    chunkKeywords = sentenceKeywords;
                }
            } else {
                currentChunk += (currentChunk ? " " : "") + sentence;
                sentenceKeywords.forEach(k => chunkKeywords.add(k));
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }
    }

    // Filter out low-quality chunks
    return chunks.filter(c => {
        const words = c.split(/\s+/).length;
        const hasSubstantiveContent = /[a-zA-Z]{3,}/.test(c); // Contains actual words
        return c.length > 30 && words > 8 && hasSubstantiveContent;
    });
}

// Enhanced similarity scoring with improved weighting and precision
function calculateIntelligentScore(text, processedQuery, termFreq, totalChunks) {
    const textLower = text.toLowerCase();
    const { original, expanded, keywords } = processedQuery;
    let score = 0;

    // 1. Exact phrase matching (highest weight) - boosted for precision
    if (textLower.includes(original.toLowerCase())) {
        score += 25; // Increased from 20
    }

    // 2. Enhanced TF-IDF scoring with query-specific weighting
    const importantTerms = ['vehicle', 'payment', 'price', 'toyota', 'deposit', 'lease', 'program', 'babu', 'motors'];

    keywords.forEach(keyword => {
        if (textLower.includes(keyword)) {
            const termData = termFreq.get(keyword);
            let baseScore = 2;

            // Boost important business terms
            if (importantTerms.includes(keyword.toLowerCase())) {
                baseScore = 4;
            }

            if (termData) {
                const tf = (textLower.match(new RegExp(keyword, 'g')) || []).length;
                const idf = Math.log(totalChunks / Math.max(1, termData.documentCount));
                score += tf * idf * baseScore;
            } else {
                score += baseScore;
            }
        }
    });

    // 3. Improved semantic proximity with exact matches prioritized
    const textWords = extractKeywords(text);
    let exactMatches = 0;
    let partialMatches = 0;

    keywords.forEach(queryWord => {
        textWords.forEach(textWord => {
            if (textWord === queryWord) {
                exactMatches++;
            } else if (textWord.includes(queryWord) || queryWord.includes(textWord)) {
                partialMatches++;
            } else if (calculateSimilarity(queryWord, textWord) > 0.8) {
                partialMatches++;
            }
        });
    });

    score += exactMatches * 3; // Higher weight for exact matches
    score += partialMatches * 1;

    // 4. Enhanced context density with position weighting
    if (keywords.length > 1) {
        let contextBonus = 0;
        let keywordPositions = [];

        keywords.forEach(keyword => {
            const index = textLower.indexOf(keyword);
            if (index !== -1) {
                keywordPositions.push(index);
            }
        });

        if (keywordPositions.length > 1) {
            // Bonus for keywords appearing early in text
            const avgPosition = keywordPositions.reduce((a, b) => a + b, 0) / keywordPositions.length;
            const earlyBonus = Math.max(0, (500 - avgPosition) / 100);

            // Bonus for keywords close together
            for (let i = 0; i < keywordPositions.length - 1; i++) {
                const distance = Math.abs(keywordPositions[i] - keywordPositions[i + 1]);
                if (distance < 150) {
                    contextBonus += Math.max(0, (150 - distance) / 15);
                }
            }

            score += contextBonus + earlyBonus;
        }
    }

    // 5. Length normalization with quality bias
    const optimalLength = 300; // Sweet spot for chunk length
    const lengthRatio = Math.min(text.length / optimalLength, 2);
    score = score / Math.sqrt(lengthRatio);

    // 6. Content quality indicators
    const hasNumbers = /\d/.test(text); // Financial info often contains numbers
    const hasProperNouns = /[A-Z][a-z]+/.test(text); // Company names, locations

    if (hasNumbers && (original.includes('price') || original.includes('cost') || original.includes('payment'))) {
        score += 2;
    }

    if (hasProperNouns) {
        score += 1;
    }

    return Math.round(score * 100) / 100; // Round to 2 decimal places
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

async function findRelevantContext(question, maxChunks = 3) {
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
            .filter(item => item.score > 1.0) // Significantly higher threshold for better quality
            .sort((a, b) => b.score - a.score);

        // Enhanced dynamic chunk selection with quality-first approach
        let selectedChunks = [];
        if (similarities.length > 0) {
            const topScore = similarities[0].score;

            // More aggressive filtering - only include high-quality matches
            const qualityThreshold = Math.max(topScore * 0.6, 3.0); // At least 60% of top score or minimum score of 3

            selectedChunks = similarities.filter(item =>
                item.score >= qualityThreshold && selectedChunks.length < maxChunks
            );

            // If we get too few high-quality matches, gradually lower threshold
            if (selectedChunks.length === 0 && similarities.length > 0) {
                const fallbackThreshold = Math.max(topScore * 0.4, 1.5);
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

            // Check for keyword overlap
            const keywordOverlap = calculateKeywordOverlap(
                chunk.metadata.keywords,
                existing.metadata.keywords
            );

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

// Calculate keyword overlap between two sets of keywords
function calculateKeywordOverlap(keywords1, keywords2) {
    if (!keywords1.length || !keywords2.length) return 0;

    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));

    return intersection.size / Math.min(set1.size, set2.size);
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

// Context quality validator to ensure optimal responses
function validateContextQuality(chunks, query) {
    const queryKeywords = extractKeywords(query);
    let qualityScore = 0;
    let recommendations = [];

    // Check for keyword coverage
    const allChunkText = chunks.map(c => c.chunk).join(' ').toLowerCase();
    const keywordCoverage = queryKeywords.filter(kw => allChunkText.includes(kw)).length / queryKeywords.length;

    if (keywordCoverage >= 0.8) {
        qualityScore += 3;
    } else if (keywordCoverage >= 0.5) {
        qualityScore += 2;
        recommendations.push('Some query terms not well covered');
    } else {
        qualityScore += 1;
        recommendations.push('Poor keyword coverage - consider broader search');
    }

    // Check for score distribution
    if (chunks.length > 1) {
        const scores = chunks.map(c => c.score);
        const scoreRange = Math.max(...scores) - Math.min(...scores);
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

        if (avgScore >= 15 && scoreRange <= 30) {
            qualityScore += 2; // Good consistent quality
        } else if (avgScore >= 8) {
            qualityScore += 1;
        }
    }

    // Check for content length appropriateness
    const totalLength = chunks.reduce((sum, c) => sum + c.chunk.length, 0);
    if (totalLength >= 800 && totalLength <= 2000) {
        qualityScore += 1; // Optimal length
    } else if (totalLength > 2000) {
        recommendations.push('Context might be too long');
    }

    return {
        score: qualityScore,
        maxScore: 6,
        quality: qualityScore >= 5 ? 'EXCELLENT' : qualityScore >= 3 ? 'GOOD' : 'FAIR',
        recommendations
    };
}

// Update the answerWithRAG function to use conversation management
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
        console.log(`🔍 Chunks found: ${relevantChunks.length}/${knowledgeCache.chunks.length}`);
        console.log(`📏 Total context length: ${context.length} chars`);

        // Validate context quality
        const qualityAnalysis = validateContextQuality(relevantChunks, question);
        console.log(`🎯 Context Quality: ${qualityAnalysis.quality} (${qualityAnalysis.score}/${qualityAnalysis.maxScore})`);
        if (qualityAnalysis.recommendations.length > 0) {
            console.log(`💡 Recommendations: ${qualityAnalysis.recommendations.join(', ')}`);
        }

        relevantChunks.forEach((chunk, i) => {
            const quality = chunk.score > 15 ? "EXCELLENT" :
                chunk.score > 8 ? "GOOD" :
                    chunk.score > 3 ? "FAIR" : "POOR";
            console.log(`  ${i + 1}. Score: ${chunk.score.toFixed(2)} (${quality}) | Words: ${chunk.metadata.wordCount} | Preview: "${chunk.chunk.substring(0, 80)}..."`);
        });
        console.log('=== END ANALYSIS ===\n');

        // Prepare conversation messages with the conversation manager
        const messages = prepareConversationMessages(userId, context, question);

        // Generate response using chat completions
        const assistantMessage = await makeAPICall(messages, 500);

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
            }).then(response => response.choices[0].message);
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
    initializeKnowledgeBase,
    getRateLimiterStatus,
    resetRateLimiter,
    // Re-export conversation management functions for compatibility
    clearUserConversation,
    getActiveConversationsCount,
    clearAllConversations,
    getConversationStatus,
    getUserMessages,
    setUserMessages,
    addMessageToUserConversation
};