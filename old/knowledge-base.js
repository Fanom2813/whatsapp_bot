// knowledge-base.js
import fs from "fs/promises";
import { extractKeywords } from './scoring-utils.js';

// Enhanced cache for knowledge chunks with metadata
let knowledgeCache = {
    chunks: [],
    chunkMetadata: [], // Store metadata for each chunk
    termFrequency: new Map(), // Track term frequencies across corpus
    lastModified: null
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

// Get knowledge cache for external access
function getKnowledgeCache() {
    return knowledgeCache;
}

// Reset knowledge cache (useful for testing)
function resetKnowledgeCache() {
    knowledgeCache = {
        chunks: [],
        chunkMetadata: [],
        termFrequency: new Map(),
        lastModified: null
    };
    console.log('Knowledge cache reset');
}

// Get knowledge base statistics
function getKnowledgeBaseStats() {
    return {
        totalChunks: knowledgeCache.chunks.length,
        totalTerms: knowledgeCache.termFrequency.size,
        lastModified: knowledgeCache.lastModified,
        avgChunkLength: knowledgeCache.chunks.length > 0
            ? Math.round(knowledgeCache.chunks.reduce((sum, chunk) => sum + chunk.length, 0) / knowledgeCache.chunks.length)
            : 0,
        totalWords: knowledgeCache.chunkMetadata.reduce((sum, meta) => sum + meta.wordCount, 0)
    };
}

export {
    initializeKnowledgeBase,
    getKnowledgeCache,
    resetKnowledgeCache,
    getKnowledgeBaseStats,
    buildTermFrequency,
    loadAndChunkMarkdown
};
