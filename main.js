import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { handleMessageGrouping, clearMessageGroupingTimers } from './src/messageHandler.js';
import { CHAT_MODEL, EMBEDDING_MODEL } from './src/config.js';

// Load environment variables
dotenv.config();

// Get current file directory for knowledge base path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- OpenAI Client ---
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// --- Knowledge Base Management ---
class KnowledgeBase {
    constructor(filePath) {
        this.filePath = filePath;
        this.vectorStore = null;
    }

    async initialize() {
        try {
            console.log('📚 Initializing knowledge base...');
            const text = fs.readFileSync(this.filePath, 'utf8');

            const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000 });
            const docs = await textSplitter.createDocuments([text]);

            this.vectorStore = await HNSWLib.fromDocuments(
                docs,
                new OpenAIEmbeddings({ modelName: EMBEDDING_MODEL })
            );

            console.log('✅ Knowledge base initialized successfully.');
        } catch (error) {
            console.error('❌ Error initializing knowledge base:', error);
            throw error;
        }
    }

    async search(query, limit = 3) {
        if (!this.vectorStore) {
            throw new Error("Knowledge base not initialized.");
        }
        console.log(`🔍 Searching knowledge base for: "${query}"`);
        const results = await this.vectorStore.similaritySearch(query, limit);
        console.log(`✅ Found ${results.length} relevant documents.`);
        return results.map(result => result.pageContent).join('\n\n');
    }
}

const knowledgeBase = new KnowledgeBase(path.join(__dirname, 'data.md'));

// --- WhatsApp Client ---
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('ready', () => {
    console.log('🚗 Babu Motors WhatsApp Bot is ready!');
    console.log('🤖 AI Assistant powered by OpenAI');
    console.log(`📱 Chat Model: ${CHAT_MODEL}`);
    console.log(`💡 Embedding Model: ${EMBEDDING_MODEL}`);
    console.log('💬 Message grouping enabled - 1 minute delay');
    console.log('⚡ Ready to receive messages!');
});

client.on('qr', qr => {
    console.log('📱 Scan the QR code below with your WhatsApp app:');
    qrcode.generate(qr, { small: true });
});

client.on('auth_failure', msg => {
    console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
    console.log('📱 WhatsApp client disconnected:', reason);
});

// --- Message Handling ---
client.on('message_create', async message => {
    if (message.fromMe) return;

    try {
        const contact = await message.getContact();
        const phoneNumber = contact.number;
        const userName = contact.name || contact.pushname || phoneNumber;
        const messageBody = message.body.trim();

        if (!messageBody) return;

        console.log(`📱 Received message from ${phoneNumber} (${userName}): "${messageBody}"`);

        // Use message grouping instead of immediate response
        handleMessageGrouping(phoneNumber, messageBody, userName, client, openai, knowledgeBase);

    } catch (error) {
        console.error('❌ Error handling message:', error);
        try {
            await message.reply("I apologize, but I'm experiencing technical difficulties. Please try again later.");
        } catch (replyError) {
            console.error('❌ Error sending error message:', replyError);
        }
    }
});

// --- Initialization ---
async function initialize() {
    try {
        await knowledgeBase.initialize();
        await client.initialize();
    } catch (error) {
        console.error('❌ Error during initialization:', error);
        process.exit(1);
    }
}

initialize();

// --- Graceful Shutdown ---
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down Babu Motors WhatsApp Bot...');
    clearMessageGroupingTimers();
    await client.destroy();
    process.exit(0);
});