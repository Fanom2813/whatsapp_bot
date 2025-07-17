import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { handleMessageGrouping, clearMessageGroupingTimers } from './src/messageHandler.js';
import { CHAT_MODEL, EMBEDDING_MODEL } from './src/config.js';
import WhatsApp from 'whatsapp';
import OpenAI from 'openai';
import PocketBase from 'pocketbase';


// Load environment variables
dotenv.config();

const { APP_SECRET, PRIVATE_KEY, PASSPHRASE, PORT = 3000 } = process.env;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- OpenAI Client ---
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// --- PocketBase Client Setup ---
const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const pocketbase = new PocketBase(POCKETBASE_URL);
// Optionally authenticate as admin if token is provided
if (process.env.POCKETBASE_ADMIN_TOKEN) {
    pocketbase.authStore.save(process.env.POCKETBASE_ADMIN_TOKEN, null);
    console.log('✅ PocketBase admin token loaded.');
}

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

const knowledgeBase = new KnowledgeBase(path.join(__dirname, 'optimized.md'));

// --- WhatsApp SDK Setup ---
const whatsapp = new WhatsApp(process.env.WA_PHONE_NUMBER_ID || "700142219854585");
// --- Express App Setup ---
const app = express();

// --- Middleware ---
app.use(express.json());
app.use((req, res, next) => {
    console.log(`➡️  [${req.method}] ${req.url}`);
    next();
});

// --- Environment Validation ---
function validateEnv() {
    const required = ["OPENAI_API_KEY", "WA_PHONE_NUMBER_ID"];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
        console.error(`❌ Missing required environment variables: ${missing.join(", ")}`);
        process.exit(1);
    }
}
validateEnv();

// --- Developer Experience Endpoints ---
app.get('/', (req, res) => {
    res.send('🚗 Babu Motors WhatsApp Bot is running!');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// --- Express Server for Webhooks ---
const WEBHOOK_ENDPOINT = process.env.WEBHOOK_ENDPOINT || 'webhook';
const WEBHOOK_VERIFICATION_TOKEN = process.env.WEBHOOK_VERIFICATION_TOKEN || '1234567890abcd';
const LISTENER_PORT = process.env.LISTENER_PORT || PORT || 3000;

// Webhook verification (GET)
app.get(`/${WEBHOOK_ENDPOINT}`, (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
        if (mode === "subscribe" && token === WEBHOOK_VERIFICATION_TOKEN) {
            console.log("✅ Webhook verified successfully.");
            res.status(200).send(challenge);
        } else {
            console.log("❌ Webhook verification failed.");
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// Webhook event (POST)
app.post(`/${WEBHOOK_ENDPOINT}`, async (req, res) => {
    try {
        // Pass the request to WhatsApp SDK's webhook handler if available, else process manually
        // For now, process manually as before
        const entry = req.body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;
        const messageObj = value?.messages?.[0];
        const contactObj = value?.contacts?.[0];

        if (messageObj && messageObj.type === 'text') {
            const phoneNumber = messageObj.from;
            const messageBody = messageObj.text?.body;
            const userName = contactObj?.profile?.name || phoneNumber;

            if (messageBody) {
                console.log(`📩 Webhook: Received message from ${phoneNumber} (${userName}): "${messageBody}"`);
                handleMessageGrouping(phoneNumber, messageBody, userName, whatsapp, openai, knowledgeBase, messageObj.id);
            }
        }
        // Always respond with 200 OK
        res.sendStatus(200);
    } catch (err) {
        console.error('❌ Error parsing WhatsApp webhook event:', err);
    }
});

// Remove /register endpoint and tenant management

app.listen(LISTENER_PORT, async () => {
    await knowledgeBase.initialize();
    console.log(`🚗 Babu Motors WhatsApp Bot (Official API) listening on port ${LISTENER_PORT}`);
});

// --- Graceful Shutdown ---
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down Babu Motors WhatsApp Bot...');
    clearMessageGroupingTimers();
    process.exit(0);
});

// --- Error Handling Middleware ---
app.use((err, req, res, next) => {
    console.error('❌ Express error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// --- Global Error Handling ---
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
    process.exit(1);
});