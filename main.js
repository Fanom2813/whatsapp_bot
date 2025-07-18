import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { handleMessageGrouping, clearMessageGroupingTimers, sendMessage } from './src/messageHandler.js';
import { CHAT_MODEL, EMBEDDING_MODEL } from './src/config.js';
import WhatsApp from 'whatsapp';
import OpenAI from 'openai';
import PocketBase from 'pocketbase';
import pocketbase from './src/pb.js';
import { EventSource } from 'eventsource';
import { setAssistantInstructions } from './src/chat.js';
global.EventSource = EventSource;


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

    // --- Listen to settings collection for prompt updates ---
    async function updatePromptFromSettings(record) {
        if (record && record.name === 'ai_prompts' && record.value && record.value.systemPrompt) {
            setAssistantInstructions(record.value.systemPrompt);
        } else {
            setAssistantInstructions(); // fallback to default
        }
    }
    // Initial fetch
    try {
        const settings = await pocketbase.collection('settings').getFullList();
        const aiPrompt = settings.find(r => r.name === 'ai_prompts');
        await updatePromptFromSettings(aiPrompt);
    } catch (err) {
        console.warn('⚠️ Could not fetch initial prompt from settings, using default.');
        setAssistantInstructions();
    }
    // Subscribe to changes
    pocketbase.collection('settings').subscribe('*', async (e) => {
        if (e.action === 'update' || e.action === 'create') {
            await updatePromptFromSettings(e.record);
        } else if (e.action === 'delete' && e.record?.name === 'ai_prompts') {
            setAssistantInstructions();
        }
    });

    // Subscribe to new chat_message records and forward to WhatsApp if not from AI
    pocketbase.collection('chat_message').subscribe('*', async (e) => {
        console.log(`[PocketBase] chat_message event: action=${e.action}, id=${e.record?.id}`);
        if (e.action === 'create') {
            const msg = e.record;
            // Only send if the message is from 'user' or 'agent', not 'ai'
            if (msg.sender === 'agent' ) {
                try {
                    // Fetch the chat to get the phone number
                    const chat = await pocketbase.collection('chat').getOne(msg.chat);
                    const phoneNumber = chat.phone;
                    // Log phone and message before sending
                    console.log(`[PocketBase] Sending WhatsApp message to ${phoneNumber}: ${msg.text}`);
                    // Use your WhatsApp sendMessage helper
                    await sendMessage(phoneNumber, msg.text, whatsapp);
                    console.log(`Forwarded chat_message to WhatsApp: ${phoneNumber} - ${msg.text}`);
                    // Update chat lastMessage field
                    await pocketbase.collection('chat').update(chat.id, { lastMessage: msg.text });
                } catch (err) {
                    console.error('❌ Error forwarding chat_message to WhatsApp:', err);
                }
            }
        }
    });
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