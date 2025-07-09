// Step 1: Install dependencies
// npm install onnxruntime-node
// npm install @xenova/transformers
// npm install node-fetch

import ort from 'onnxruntime-node';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class ONNXEmbeddingRAG {
    constructor() {
        this.documents = new Map();
        this.embeddings = new Map();
        this.index = [];
        this.session = null;
        this.tokenizer = null;
        this.modelPath = null;
    }

    // Step 2: Download and setup ONNX model
    async downloadModel() {
        const modelUrl = 'https://huggingface.co/sentence-transformers/all-mpnet-base-v2/resolve/main/onnx/model.onnx';
        const tokenizerUrl = 'https://huggingface.co/sentence-transformers/all-mpnet-base-v2/resolve/main/tokenizer.json';

        const modelDir = './models';
        const modelPath = path.join(modelDir, 'model.onnx');
        const tokenizerPath = path.join(modelDir, 'tokenizer.json');

        // Create models directory
        if (!fs.existsSync(modelDir)) {
            fs.mkdirSync(modelDir, { recursive: true });
        }

        // Download model if not exists
        if (!fs.existsSync(modelPath)) {
            console.log('Downloading ONNX model...');
            await this.downloadFile(modelUrl, modelPath);
            console.log('Model downloaded successfully');
        }

        // Download tokenizer if not exists
        if (!fs.existsSync(tokenizerPath)) {
            console.log('Downloading tokenizer...');
            await this.downloadFile(tokenizerUrl, tokenizerPath);
            console.log('Tokenizer downloaded successfully');
        }

        this.modelPath = modelPath;
        return { modelPath, tokenizerPath };
    }

    // Helper function to download files
    async downloadFile(url, filePath) {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to download ${url}: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(filePath, buffer);
    }

    // Step 3: Initialize ONNX session
    async initializeModel() {
        try {
            const { modelPath, tokenizerPath } = await this.downloadModel();

            // Load ONNX model
            this.session = await ort.InferenceSession.create(modelPath);
            console.log('ONNX model loaded successfully');

            // Load tokenizer
            const tokenizerData = JSON.parse(fs.readFileSync(tokenizerPath, 'utf-8'));
            this.tokenizer = tokenizerData;
            console.log('Tokenizer loaded successfully');

            return true;
        } catch (error) {
            console.error('Error initializing model:', error);
            return false;
        }
    }

    // Step 4: Simple tokenizer implementation
    tokenize(text, maxLength = 512) {
        // Simple word-based tokenization (for demo - in production use proper tokenizer)
        const words = text.toLowerCase().split(/\s+/);
        const tokens = [101]; // [CLS] token (within valid range)

        // Add word tokens (simplified - normally you'd use proper vocab)
        // Ensure token IDs stay within model's vocabulary range [-30522, 30521]
        for (const word of words.slice(0, maxLength - 2)) {
            let hash = this.simpleHash(word) % 28000 + 1000; // Keep within safe range (1000-29000)

            // Additional safety check to ensure token is within valid range
            if (hash > 30521 || hash < 0) {
                hash = 1000 + (Math.abs(hash) % 28000); // Force into safe range
            }

            tokens.push(hash);
        }

        tokens.push(102); // [SEP] token (within valid range)

        // Pad to maxLength
        while (tokens.length < maxLength) {
            tokens.push(0);
        }

        return tokens.slice(0, maxLength);
    }

    // Simple hash function for demo tokenization
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    // Step 5: Generate embeddings using ONNX
    async generateEmbedding(text) {
        if (!this.session) {
            throw new Error('Model not initialized. Call initializeModel() first.');
        }

        try {
            // Tokenize input
            const tokens = this.tokenize(text);
            const inputIds = new ort.Tensor('int64', BigInt64Array.from(tokens.map(t => BigInt(t))), [1, tokens.length]);
            const attentionMask = new ort.Tensor('int64', BigInt64Array.from(tokens.map(t => t > 0 ? 1n : 0n)), [1, tokens.length]);
            const tokenTypeIds = new ort.Tensor('int64', BigInt64Array.from(tokens.map(() => 0n)), [1, tokens.length]);

            // Run inference
            const feeds = {
                input_ids: inputIds,
                attention_mask: attentionMask,
                token_type_ids: tokenTypeIds
            };

            const results = await this.session.run(feeds);

            // Get last hidden state and mean pool
            const lastHiddenState = results.last_hidden_state;
            const embedding = this.meanPooling(lastHiddenState.data, attentionMask.data, tokens.length);

            return this.normalize(embedding);
        } catch (error) {
            console.error('Error generating embedding:', error);
            // Fallback to simple embedding
            return this.fallbackEmbedding(text);
        }
    }

    // Mean pooling for sentence embeddings
    meanPooling(hiddenStates, attentionMask, seqLength, hiddenSize = 768) {
        const embedding = new Array(hiddenSize).fill(0);
        let validTokens = 0;

        for (let i = 0; i < seqLength; i++) {
            if (attentionMask[i] > 0) {
                validTokens++;
                for (let j = 0; j < hiddenSize; j++) {
                    embedding[j] += hiddenStates[i * hiddenSize + j];
                }
            }
        }

        // Average
        for (let i = 0; i < hiddenSize; i++) {
            embedding[i] /= validTokens;
        }

        return embedding;
    }

    // Normalize embedding vector
    normalize(vector) {
        const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        return vector.map(val => val / norm);
    }

    // Fallback embedding using simple word2vec-like approach
    fallbackEmbedding(text) {
        const words = text.toLowerCase().split(/\s+/);
        const embedding = new Array(768).fill(0);

        for (const word of words) {
            const hash = this.simpleHash(word);
            for (let i = 0; i < 768; i++) {
                embedding[i] += Math.sin(hash * (i + 1)) * 0.1;
            }
        }

        return this.normalize(embedding);
    }

    // Step 6: Calculate cosine similarity between embeddings
    cosineSimilarity(vec1, vec2) {
        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;

        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            norm1 += vec1[i] * vec1[i];
            norm2 += vec2[i] * vec2[i];
        }

        return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    }

    // Step 7: Load and process markdown files
    async loadMarkdownFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const fileName = path.basename(filePath);
            const fileId = crypto.createHash('md5').update(filePath).digest('hex');

            // Clean markdown content
            const textContent = content
                .replace(/^#+ (.+)$/gm, '$1')
                .replace(/\*\*(.+?)\*\*/g, '$1')
                .replace(/\*(.+?)\*/g, '$1')
                .replace(/`(.+?)`/g, '$1')
                .replace(/```[\s\S]*?```/g, '')
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
                .trim();

            const chunks = this.chunkText(textContent, 500);

            for (let index = 0; index < chunks.length; index++) {
                const chunk = chunks[index];
                const chunkId = `${fileId}_${index}`;

                // Store document
                this.documents.set(chunkId, {
                    id: chunkId,
                    text: chunk,
                    fileName: fileName,
                    filePath: filePath,
                    chunkIndex: index
                });

                // Generate and store embedding
                console.log(`Generating embedding for chunk ${index + 1}/${chunks.length} of ${fileName}`);
                const embedding = await this.generateEmbedding(chunk);
                this.embeddings.set(chunkId, embedding);

                this.index.push(chunkId);
            }

            console.log(`Loaded ${chunks.length} chunks from ${fileName}`);
            return true;
        } catch (error) {
            console.error(`Error loading ${filePath}:`, error.message);
            return false;
        }
    }

    // Chunk text intelligently
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

    // Step 8: Load directory of markdown files
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

            console.log(`Loaded ${loadedCount} markdown files with ONNX embeddings`);
            return loadedCount;
        } catch (error) {
            console.error(`Error loading directory ${directoryPath}:`, error.message);
            return 0;
        }
    }

    // Step 9: Semantic search using embeddings
    async search(query, topK = 5) {
        if (this.index.length === 0) {
            return [];
        }

        // Generate query embedding
        const queryEmbedding = await this.generateEmbedding(query);
        const results = [];

        // Calculate similarity with all documents
        for (const docId of this.index) {
            const docEmbedding = this.embeddings.get(docId);
            const similarity = this.cosineSimilarity(queryEmbedding, docEmbedding);

            results.push({
                document: this.documents.get(docId),
                similarity: similarity,
                type: 'semantic'
            });
        }

        return results
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
    }

    // Generate context for RAG
    async generateContext(query, topK = 3) {
        const results = await this.search(query, topK);

        if (results.length === 0) {
            return "No relevant documents found.";
        }

        let context = "Relevant information from your documents:\n\n";
        results.forEach((result, index) => {
            const doc = result.document;
            context += `${index + 1}. From ${doc.fileName} (semantic similarity: ${result.similarity.toFixed(3)}):\n`;
            context += `${doc.text}\n\n`;
        });

        return context.trim();
    }

    // Save embeddings to disk for faster loading
    async saveEmbeddings(filePath) {
        const data = {
            documents: Array.from(this.documents.entries()),
            embeddings: Array.from(this.embeddings.entries()),
            index: this.index
        };

        fs.writeFileSync(filePath, JSON.stringify(data));
        console.log(`Embeddings saved to ${filePath}`);
    }

    // Load embeddings from disk
    async loadEmbeddings(filePath) {
        if (!fs.existsSync(filePath)) {
            return false;
        }

        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        this.documents = new Map(data.documents);
        this.embeddings = new Map(data.embeddings);
        this.index = data.index;

        console.log(`Loaded ${this.documents.size} documents from ${filePath}`);
        return true;
    }

    // Get statistics
    getStats() {
        const fileStats = {};
        this.documents.forEach(doc => {
            fileStats[doc.fileName] = (fileStats[doc.fileName] || 0) + 1;
        });

        return {
            totalDocuments: this.documents.size,
            totalFiles: Object.keys(fileStats).length,
            embeddingDimension: this.embeddings.size > 0 ? this.embeddings.values().next().value.length : 0,
            fileBreakdown: fileStats
        };
    }

    // Clear all data
    clear() {
        this.documents.clear();
        this.embeddings.clear();
        this.index = [];
    }
}

// Export the class
export default ONNXEmbeddingRAG;