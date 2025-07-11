import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SimpleRAG {
    constructor() {
        this.documents = new Map();
        this.vectors = new Map();
        this.index = [];
        this.initialized = false;

        // Initialize immediately but don't await in constructor
        this.initializeWithDataFile();
    }

    // Initialize with ./data.md file
    async initializeWithDataFile() {
        const dataFilePath = path.join(__dirname, 'data.md');
        try {
            if (fs.existsSync(dataFilePath)) {
                await this.loadMarkdownFile(dataFilePath);
                console.log('✅ SimpleRAG: Automatically loaded data.md');
                this.initialized = true;
            } else {
                console.log('⚠️ SimpleRAG: data.md not found, continuing without default data');
                this.initialized = true;
            }
        } catch (error) {
            console.error('❌ SimpleRAG: Error initializing with data.md:', error.message);
            this.initialized = true;
        }
    }

    // Ensure initialization is complete before operations
    async ensureInitialized() {
        if (!this.initialized) {
            await this.initializeWithDataFile();
        }
    }

    // Simple text preprocessing
    preprocessText(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Simple TF-IDF vectorization
    createVector(text) {
        const words = this.preprocessText(text).split(' ');
        const wordCount = {};

        // Count word frequencies
        words.forEach(word => {
            if (word.length > 2) { // Skip very short words
                wordCount[word] = (wordCount[word] || 0) + 1;
            }
        });

        return wordCount;
    }

    // Calculate cosine similarity between two vectors
    cosineSimilarity(vec1, vec2) {
        const keys1 = Object.keys(vec1);
        const keys2 = Object.keys(vec2);
        const allKeys = new Set([...keys1, ...keys2]);

        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;

        for (const key of allKeys) {
            const val1 = vec1[key] || 0;
            const val2 = vec2[key] || 0;

            dotProduct += val1 * val2;
            norm1 += val1 * val1;
            norm2 += val2 * val2;
        }

        if (norm1 === 0 || norm2 === 0) return 0;
        return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    }

    // Load and process a markdown file
    async loadMarkdownFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const fileName = path.basename(filePath);
            const fileId = crypto.createHash('md5').update(filePath).digest('hex');

            // Simple markdown parsing - extract text content
            const textContent = content
                .replace(/^#+ (.+)$/gm, '$1') // Remove header markers
                .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold markers
                .replace(/\*(.+?)\*/g, '$1') // Remove italic markers
                .replace(/`(.+?)`/g, '$1') // Remove inline code markers
                .replace(/```[\s\S]*?```/g, '') // Remove code blocks
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Extract link text
                .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // Extract image alt text
                .trim();

            // Split into chunks (simple sentence-based splitting)
            const chunks = this.chunkText(textContent, 500);

            chunks.forEach((chunk, index) => {
                const chunkId = `${fileId}_${index}`;
                const vector = this.createVector(chunk);

                this.documents.set(chunkId, {
                    id: chunkId,
                    text: chunk,
                    fileName: fileName,
                    filePath: filePath,
                    chunkIndex: index
                });

                this.vectors.set(chunkId, vector);
                this.index.push(chunkId);
            });

            console.log(`Loaded ${chunks.length} chunks from ${fileName}`);
            return true;
        } catch (error) {
            console.error(`Error loading ${filePath}:`, error.message);
            return false;
        }
    }

    // Simple text chunking
    chunkText(text, maxChunkSize = 500) {
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const chunks = [];
        let currentChunk = '';

        for (const sentence of sentences) {
            const trimmedSentence = sentence.trim();
            if (currentChunk.length + trimmedSentence.length + 1 <= maxChunkSize) {
                currentChunk += (currentChunk ? '. ' : '') + trimmedSentence;
            } else {
                if (currentChunk) {
                    chunks.push(currentChunk + '.');
                }
                currentChunk = trimmedSentence;
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk + '.');
        }

        return chunks.length > 0 ? chunks : [text];
    }

    // Load all markdown files from a directory
    async loadMarkdownDirectory(directoryPath) {
        try {
            const files = fs.readdirSync(directoryPath);
            const markdownFiles = files.filter(file => file.endsWith('.md'));

            let loadedCount = 0;
            for (const file of markdownFiles) {
                const filePath = path.join(directoryPath, file);
                const success = await this.loadMarkdownFile(filePath);
                if (success) loadedCount++;
            }

            console.log(`Loaded ${loadedCount} markdown files from ${directoryPath}`);
            return loadedCount;
        } catch (error) {
            console.error(`Error loading directory ${directoryPath}:`, error.message);
            return 0;
        }
    }

    // Search for relevant documents
    async search(query, topK = 5) {
        await this.ensureInitialized();

        if (this.index.length === 0) {
            return [];
        }

        const queryVector = this.createVector(query);
        const results = [];

        for (const docId of this.index) {
            const docVector = this.vectors.get(docId);
            const similarity = this.cosineSimilarity(queryVector, docVector);

            if (similarity > 0) {
                results.push({
                    document: this.documents.get(docId),
                    similarity: similarity
                });
            }
        }

        return results
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
    }

    // Generate context for RAG
    async generateContext(query, topK = 3) {
        await this.ensureInitialized();

        const results = await this.search(query, topK);

        if (results.length === 0) {
            return "No relevant documents found.";
        }

        let context = "Relevant information from your documents:\n\n";
        results.forEach((result, index) => {
            const doc = result.document;
            context += `${index + 1}. From ${doc.fileName}:\n`;
            context += `${doc.text}\n\n`;
        });

        return context.trim();
    }

    // Get statistics about the loaded documents
    getStats() {
        const fileStats = {};
        this.documents.forEach(doc => {
            fileStats[doc.fileName] = (fileStats[doc.fileName] || 0) + 1;
        });

        return {
            totalDocuments: this.documents.size,
            totalFiles: Object.keys(fileStats).length,
            fileBreakdown: fileStats
        };
    }

    // Clear all loaded documents
    clear() {
        this.documents.clear();
        this.vectors.clear();
        this.index = [];
    }
}

export default SimpleRAG;