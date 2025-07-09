// scoring-utils.js
// Fuzzy search and similarity utilities for better context matching

// Configuration for fuzzy search
const FUZZY_CONFIG = {
    threshold: 0.2,          // Minimum similarity threshold (0-1) - lowered for better recall
    maxDistance: 4,          // Maximum Levenshtein distance for fuzzy matching - increased for typos
    caseSensitive: false,    // Case sensitivity
    includePartialMatches: true,
    wordBonus: 0.2          // Bonus for whole word matches
};

// Important terms for context weighting
const IMPORTANT_TERMS = [
    'price', 'cost', 'payment', 'lease', 'finance', 'deposit',
    'vehicle', 'car', 'toyota', 'honda', 'nissan', 'service',
    'maintenance', 'warranty', 'contact', 'location', 'office',
    'phone', 'address', 'buy', 'purchase', 'babu', 'noah',
    'where', 'located', 'you', 'who', 'much', 'cars', 'type'
];

// Simple fuzzy string matching with Levenshtein distance
function fuzzyMatch(needle, haystack, maxDistance = FUZZY_CONFIG.maxDistance) {
    if (!needle || !haystack) return false;

    if (!FUZZY_CONFIG.caseSensitive) {
        needle = needle.toLowerCase();
        haystack = haystack.toLowerCase();
    }

    // Exact match
    if (haystack.includes(needle)) {
        return true;
    }

    // If partial matches are disabled, return false
    if (!FUZZY_CONFIG.includePartialMatches) {
        return false;
    }

    // Split haystack into words and check fuzzy match against each
    const words = haystack.split(/\s+/);

    for (const word of words) {
        const distance = levenshteinDistance(needle, word);
        if (distance <= maxDistance) {
            return true;
        }
    }

    return false;
}

// Calculate similarity score between two strings
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;

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

// Extract keywords from text for fuzzy matching
function extractKeywords(text) {
    if (!text) return [];

    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
        'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
        'will', 'would', 'could', 'should', 'may', 'might', 'can', 'what', 'how', 'when',
        'where', 'why', 'who', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
        'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them'
    ]);

    return text.toLowerCase()
        .split(/\s+/)
        .map(word => word.replace(/[^\w]/g, ''))
        .filter(word => word.length > 1 && !stopWords.has(word));
}

// Fuzzy search in document chunks
function fuzzySearchInText(query, text) {
    if (!query || !text) return { score: 0, matches: [] };

    const queryKeywords = extractKeywords(query);
    const textLower = FUZZY_CONFIG.caseSensitive ? text : text.toLowerCase();

    let totalScore = 0;
    const matches = [];

    queryKeywords.forEach(keyword => {
        // Check for exact matches first
        if (textLower.includes(keyword)) {
            const boost = IMPORTANT_TERMS.includes(keyword) ? 2 : 1;
            totalScore += 10 * boost;
            matches.push({ keyword, type: 'exact', boost });
            return;
        }

        // Check for fuzzy matches
        if (fuzzyMatch(keyword, textLower)) {
            const boost = IMPORTANT_TERMS.includes(keyword) ? 1.5 : 1;
            totalScore += 5 * boost;
            matches.push({ keyword, type: 'fuzzy', boost });
        }
    });

    // Normalize score based on query length
    const normalizedScore = queryKeywords.length > 0 ? totalScore / queryKeywords.length : 0;

    return {
        score: Math.round(normalizedScore * 100) / 100,
        matches,
        queryKeywords: queryKeywords.length,
        matchedKeywords: matches.length
    };
}

// Score document chunks based on fuzzy search
function scoreDocumentChunk(query, chunk) {
    const searchResult = fuzzySearchInText(query, chunk);

    // Additional scoring factors
    let bonus = 0;

    // Length bonus (prefer medium-length chunks)
    const chunkLength = chunk.length;
    if (chunkLength >= 100 && chunkLength <= 500) {
        bonus += 2;
    } else if (chunkLength >= 50 && chunkLength <= 1000) {
        bonus += 1;
    }

    // Position bonus (keyword position in text matters)
    const queryWords = extractKeywords(query);
    const chunkLower = chunk.toLowerCase();

    queryWords.forEach(word => {
        const index = chunkLower.indexOf(word);
        if (index !== -1) {
            // Earlier position gets higher bonus
            const positionBonus = Math.max(0, (500 - index) / 500) * 2;
            bonus += positionBonus;
        }
    });

    return {
        score: searchResult.score + bonus,
        details: searchResult,
        chunkLength,
        bonus
    };
}

// Find best matching chunks using fuzzy search
function findBestMatches(query, chunks, maxResults = 5) {
    if (!query || !chunks || chunks.length === 0) {
        return [];
    }

    const scoredChunks = chunks.map((chunk, index) => {
        const chunkText = typeof chunk === 'string' ? chunk : chunk.chunk || chunk.text || '';
        const scoring = scoreDocumentChunk(query, chunkText);

        return {
            chunk: chunkText,
            score: scoring.score,
            details: scoring.details,
            originalIndex: index,
            ...scoring
        };
    });

    // Filter chunks that meet minimum threshold
    const filteredChunks = scoredChunks.filter(item =>
        item.score >= FUZZY_CONFIG.threshold * 10 // Scale threshold appropriately
    );

    // Sort by score (descending) and return top results
    return filteredChunks
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
}

// Validate search results quality
function validateSearchResults(results, query) {
    if (!results || results.length === 0) {
        return {
            quality: 'POOR',
            score: 0,
            recommendations: ['No relevant matches found', 'Try different keywords', 'Check spelling']
        };
    }

    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
    const totalMatches = results.reduce((sum, r) => {
        // Handle different data structures
        if (r.details && r.details.matchedKeywords !== undefined) {
            return sum + r.details.matchedKeywords;
        }
        if (r.metadata && r.metadata.matchedKeywords !== undefined) {
            return sum + r.metadata.matchedKeywords;
        }
        // Fallback: estimate based on score
        return sum + Math.min(r.score / 5, 3);
    }, 0);
    const queryKeywords = extractKeywords(query).length;

    const coverageRatio = queryKeywords > 0 ? totalMatches / (queryKeywords * results.length) : 0;

    let quality, score, recommendations = [];

    if (avgScore >= 15 && coverageRatio >= 0.7) {
        quality = 'EXCELLENT';
        score = 90 + Math.min(10, avgScore - 15);
    } else if (avgScore >= 10 && coverageRatio >= 0.5) {
        quality = 'GOOD';
        score = 70 + Math.min(20, (avgScore - 10) * 2);
        recommendations.push('Good matches found');
    } else if (avgScore >= 5 && coverageRatio >= 0.3) {
        quality = 'FAIR';
        score = 50 + Math.min(20, (avgScore - 5) * 2);
        recommendations.push('Moderate relevance', 'Consider refining query');
    } else {
        quality = 'POOR';
        score = Math.min(50, avgScore * 5);
        recommendations.push('Low relevance scores', 'Try different keywords', 'Expand search terms');
    }

    return {
        quality,
        score: Math.round(score),
        avgScore: Math.round(avgScore * 100) / 100,
        coverageRatio: Math.round(coverageRatio * 100) / 100,
        recommendations,
        totalResults: results.length,
        queryKeywords
    };
}

// Configuration management for fuzzy search
function updateFuzzyConfig(newConfig) {
    Object.assign(FUZZY_CONFIG, newConfig);
}

function getFuzzyConfig() {
    return { ...FUZZY_CONFIG };
}

function resetFuzzyConfig() {
    Object.assign(FUZZY_CONFIG, {
        threshold: 0.3,
        maxDistance: 3,
        caseSensitive: false,
        includePartialMatches: true,
        wordBonus: 0.2
    });
}

export {
    // Core fuzzy search functions
    fuzzyMatch,
    fuzzySearchInText,
    calculateSimilarity,

    // Document processing
    scoreDocumentChunk,
    findBestMatches,
    validateSearchResults,

    // Text utilities
    extractKeywords,
    levenshteinDistance,

    // Configuration
    updateFuzzyConfig,
    getFuzzyConfig,
    resetFuzzyConfig,

    // Constants
    FUZZY_CONFIG,
    IMPORTANT_TERMS
};
