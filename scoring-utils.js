// scoring-utils.js
// Scoring and similarity utilities for RAG system

// Simple string similarity calculation using Levenshtein distance
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

// Extract meaningful keywords from query
function extractKeywords(text) {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'what', 'how', 'when', 'where', 'why', 'who']);

    return text.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word))
        .map(word => word.replace(/[^\w]/g, ''));
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

// Calculate keyword overlap between two sets of keywords
function calculateKeywordOverlap(keywords1, keywords2) {
    if (!keywords1.length || !keywords2.length) return 0;

    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));

    return intersection.size / Math.min(set1.size, set2.size);
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

export {
    calculateSimilarity,
    levenshteinDistance,
    extractKeywords,
    preprocessQuery,
    calculateIntelligentScore,
    calculateKeywordOverlap,
    validateContextQuality
};
