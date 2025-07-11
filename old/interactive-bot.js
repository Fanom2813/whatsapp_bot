import readline from 'readline';
import OpenAI from 'openai';
import ONNXEmbeddingRAG from './onnx-rag.js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get current file directory for knowledge base path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize ONNX RAG instance at startup
const onnxRAG = new ONNXEmbeddingRAG();

// Initialize OpenAI client using environment variables
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENAI_API_KEY
});

// Simple conversation history storage
const conversationHistory = new Map();

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '💬 You: '
});

// Function to answer questions using ONNX RAG and generate AI response
async function answerWithONNXRAG(message, userId = 'test-user') {
    try {
        console.log(`\n🔍 Searching knowledge base for: "${message}"`);

        // Get relevant context from ONNX RAG
        const context = await onnxRAG.generateContext(message, 3);

        console.log('📚 ONNX RAG Context Found:');
        console.log('─'.repeat(50));
        console.log(context);
        console.log('─'.repeat(50));

        // Get or initialize conversation history for this user
        let messages = conversationHistory.get(userId) || [];

        // If no previous conversation, start with system message
        if (messages.length === 0) {
            messages.push({
                role: "system",
                content: `You are an AI assistant for Babu Motors Uganda, a vehicle leasing company specializing in Drive-to-Own (DTO) lease programs.

Your primary role is to provide helpful information about:
- Babu Motors Uganda services and programs
- Vehicle leasing and Drive-to-Own information
- General customer support
- Company policies and procedures

Always be professional, helpful, and provide accurate information based on the context provided.

The customer's ID is: ${userId}`
            });
        }

        // Add user message
        messages.push({ role: "user", content: message });

        // Add context as system message for this interaction
        messages.push({
            role: "system",
            content: `Context from knowledge base:\n${context}`
        });

        console.log('\n🤖 Generating AI response...');

        const response = await openai.chat.completions.create({
            model: "deepseek/deepseek-chat-v3-0324:free",
            messages: messages,
            temperature: 0.3,
            max_tokens: 1000
        });

        const assistantResponse = response.choices[0].message.content;

        // Add assistant response to conversation
        messages.push({ role: "assistant", content: assistantResponse });

        // Store updated conversation
        conversationHistory.set(userId, messages);

        console.log(`💾 Updated conversation for user ${userId} (${messages.length} messages)`);

        return assistantResponse;

    } catch (error) {
        console.error('Error in ONNX RAG response:', error);
        return "I'm sorry, I'm having trouble processing your request right now. Please try again later or contact Babu Motors Uganda directly for assistance.";
    }
}

// Initialize ONNX RAG system with data.md
async function initializeONNXRAG() {
    try {
        console.log('🚀 Initializing ONNX RAG system...');

        // Check if we have pre-saved embeddings
        const embeddingsPath = path.join(__dirname, 'embeddings.json');
        const embeddingsLoaded = await onnxRAG.loadEmbeddings(embeddingsPath);

        if (embeddingsLoaded) {
            console.log('🚀 Loaded pre-saved embeddings, initializing model for new queries...');
            // Still need to initialize the model for new queries
            const modelInitialized = await onnxRAG.initializeModel();
            if (!modelInitialized) {
                console.log('⚠️ ONNX model initialization failed, using fallback embeddings');
            } else {
                console.log('✅ ONNX model initialized successfully');
            }
        } else {
            console.log('📚 No pre-saved embeddings found, creating new ones...');

            // Initialize the ONNX model
            const modelInitialized = await onnxRAG.initializeModel();
            if (!modelInitialized) {
                console.log('⚠️ ONNX model initialization failed, falling back to simple embeddings');
            } else {
                console.log('✅ ONNX model initialized successfully');
            }

            // Load data.md file
            const dataPath = path.join(__dirname, 'data.md');
            console.log(`📚 Loading knowledge base from: ${dataPath}`);

            const success = await onnxRAG.loadMarkdownFile(dataPath);
            if (success) {
                console.log('✅ Knowledge base loaded successfully');

                // Save embeddings for faster future loading
                await onnxRAG.saveEmbeddings(embeddingsPath);
                console.log('💾 Embeddings saved for faster future loading');
            } else {
                console.log('❌ Failed to load knowledge base');
            }
        }

        return true;
    } catch (error) {
        console.error('❌ Error initializing ONNX RAG:', error);
        return false;
    }
}

// Main interactive function
async function startInteractiveChat() {
    console.log('\n🤖 Babu Motors ONNX RAG Tester with AI Response');
    console.log('='.repeat(60));

    // Initialize ONNX RAG system
    await initializeONNXRAG();

    // Show ONNX RAG stats
    const stats = onnxRAG.getStats();
    console.log('📚 ONNX RAG system loaded with:', stats);
    console.log('');

    console.log('Ask me questions to test ONNX RAG + AI responses!');
    console.log('Examples:');
    console.log('• "How much is a Noah?"');
    console.log('• "What are your office locations?"');
    console.log('• "Tell me about Drive-to-Own program"');
    console.log('• "What vehicles do you have?"');
    console.log('');
    console.log('Commands:');
    console.log('• Type "!clear" to clear conversation history');
    console.log('• Type "!history" to see conversation stats');
    console.log('• Type "!rag" to see ONNX RAG stats');
    console.log('• Type "!refresh" to reload knowledge base');
    console.log('• Type "!quit" or "!exit" to quit');
    console.log('='.repeat(60));

    const userId = 'test-user';
    console.log(`👤 User ID: ${userId}\n`);

    rl.prompt();

    rl.on('line', async (input) => {
        const message = input.trim();
        const userId = 'test-user';

        // Handle special commands
        if (message === '!quit' || message === '!exit') {
            console.log('\n👋 Thank you for testing ONNX RAG! Goodbye!');
            rl.close();
            return;
        }

        if (message === '!clear') {
            conversationHistory.delete(userId);
            console.log('\n✅ Conversation history cleared! Starting fresh.\n');
            rl.prompt();
            return;
        }

        if (message === '!history') {
            const messages = conversationHistory.get(userId) || [];
            const userMessages = messages.filter(m => m.role === 'user').length;
            const assistantMessages = messages.filter(m => m.role === 'assistant').length;

            console.log(`\n📊 Conversation History:`);
            console.log(`   • Total messages: ${messages.length}`);
            console.log(`   • User messages: ${userMessages}`);
            console.log(`   • Assistant messages: ${assistantMessages}`);
            console.log(`   • Active conversations: ${conversationHistory.size}\n`);
            rl.prompt();
            return;
        }

        if (message === '!rag') {
            const stats = onnxRAG.getStats();
            console.log(`\n📚 ONNX RAG Statistics:`);
            console.log(`   • Total documents: ${stats.totalDocuments}`);
            console.log(`   • Total files: ${stats.totalFiles}`);
            console.log(`   • Embedding dimension: ${stats.embeddingDimension}`);
            console.log(`   • File breakdown:`);
            Object.entries(stats.fileBreakdown).forEach(([file, count]) => {
                console.log(`     - ${file}: ${count} chunks`);
            });
            console.log('');
            rl.prompt();
            return;
        }

        if (message === '!refresh') {
            console.log('\n🔄 Refreshing knowledge base...');
            try {
                // Clear current data
                onnxRAG.clear();

                // Reload the knowledge base
                const dataPath = path.join(__dirname, 'data.md');
                const success = await onnxRAG.loadMarkdownFile(dataPath);

                if (success) {
                    // Save updated embeddings
                    const embeddingsPath = path.join(__dirname, 'embeddings.json');
                    await onnxRAG.saveEmbeddings(embeddingsPath);

                    const stats = onnxRAG.getStats();
                    console.log('✅ Knowledge base refreshed successfully!');
                    console.log(`📚 Loaded ${stats.totalDocuments} documents from ${stats.totalFiles} files`);
                } else {
                    console.log('❌ Failed to refresh knowledge base');
                }
            } catch (error) {
                console.error('❌ Error refreshing knowledge base:', error.message);
            }
            console.log('');
            rl.prompt();
            return;
        }

        if (message === '') {
            rl.prompt();
            return;
        }

        try {
            // Get ONNX RAG response and AI-generated answer
            const aiResponse = await answerWithONNXRAG(message, userId);

            console.log('\n🤖 AI Response:');
            console.log('─'.repeat(50));
            console.log(aiResponse);
            console.log('─'.repeat(50));

            // Show conversation stats
            const messages = conversationHistory.get(userId) || [];
            console.log(`\n💾 Conversation: ${messages.filter(m => m.role === 'user').length} exchanges`);

        } catch (error) {
            console.error('\n❌ Error:', error.message);
        }

        console.log('\n' + '='.repeat(50));
        rl.prompt();
    });

    rl.on('close', () => {
        console.log('\n👋 Goodbye!');
        process.exit(0);
    });
}

// Handle CTRL+C gracefully
process.on('SIGINT', () => {
    console.log('\n\n👋 Goodbye!');
    process.exit(0);
});

// Start the interactive chat
startInteractiveChat().catch(console.error);
