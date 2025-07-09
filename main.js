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

// Load environment variables
dotenv.config();

// Get current file directory for knowledge base path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Models ---
const CHAT_MODEL = "gpt-3.5-turbo";
const EMBEDDING_MODEL = "text-embedding-3-small";

// --- Assistant Instructions ---
const ASSISTANT_INSTRUCTIONS = `You are Shilla, the official customer care representative for Babu Motors Uganda Ltd. Your role is to respond to customer inquiries on WhatsApp with clear, helpful, short and concise answers related only to Babu Motors.

**Knowledge Base Context:**
{context}

Based on the context provided and our previous conversation, please answer the following query.

You can assist with:
– Vehicle bookings and requirements
– “Drive to Own” program
– Application process and required documents
– Insurance, payments, deliveries, and support
– Any updates or info related to Babu Motors Uganda

Tone: Keep your tone friendly, natural, and professional — as if you're a normal team member of Babu Motors.`;

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

// --- (NEW) Conversation Management ---
const conversationHistory = new Map();
// Keep the last 100 messages (50 user + 50 assistant) to manage context window. Adjust as needed.
const MAX_HISTORY_MESSAGES = 100;

client.on('ready', () => {
    console.log('🚗 Babu Motors WhatsApp Bot is ready!');
    console.log('🤖 AI Assistant powered by OpenAI');
    console.log(`📱 Chat Model: ${CHAT_MODEL}`);
    console.log(`💡 Embedding Model: ${EMBEDDING_MODEL}`);
    console.log('💬 Conversation management: Phone number based');
    console.log('💾 Conversation storage: In-memory (Map)');
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
    // Example filter, adjust as needed
    // if (!message.from.includes('256')) return;

    try {
        const contact = await message.getContact();
        const phoneNumber = contact.number;
        const messageBody = message.body.trim();

        if (!messageBody) return;

        console.log(`📱 Received message from ${phoneNumber}: "${messageBody}"`);

        // client.sendSeen(message.from);
        const chat = await client.getChatById(message.from);

        chat.sendStateTyping();

        const assistantResponse = await chatWithAssistant(phoneNumber, messageBody);
        await message.reply(assistantResponse);

        console.log(`📤 Sent response to ${phoneNumber}`);
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
    await client.destroy();
    process.exit(0);
});

// --- (MODIFIED) RAG-powered Chat Function with Memory ---
async function chatWithAssistant(phoneNumber, userMessage) {
    try {
        console.log(`🤖 Processing message from ${phoneNumber}: "${userMessage}"`);

        // 1. Retrieve or initialize conversation history
        let userHistory = conversationHistory.get(phoneNumber) || [];

        // 2. Add the new user message to the history
        userHistory.push({ role: 'user', content: userMessage });

        // 3. Trim history to manage context window size
        if (userHistory.length > MAX_HISTORY_MESSAGES) {
            userHistory = userHistory.slice(-MAX_HISTORY_MESSAGES);
        }

        // 4. Search the knowledge base based on the latest user message for relevant context
        const context = await knowledgeBase.search(userMessage);

        // 5. Augment the system prompt with context
        const augmentedInstructions = ASSISTANT_INSTRUCTIONS.replace('{context}', context);

        // 6. Construct the full message payload for OpenAI
        const messages = [
            { role: 'system', content: augmentedInstructions },
            ...userHistory // Add the conversation history
        ];

        // 7. Create a response with the augmented prompt and conversation history
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            messages: messages,
        });

        const assistantResponse = response.choices[0].message.content;

        // 8. Add assistant's response to the history for future context
        userHistory.push({ role: 'assistant', content: assistantResponse });

        // 9. Save the updated history back to the map
        conversationHistory.set(phoneNumber, userHistory);

        console.log(`✅ Response created successfully. History length for ${phoneNumber}: ${userHistory.length}`);
        return assistantResponse;

    } catch (error) {
        console.error(`❌ Error in chatWithAssistant for ${phoneNumber}:`, error);
        console.error('Error stack:', error.stack);

        if (error.code === 'rate_limit_exceeded') {
            return "I'm experiencing high demand right now. Please try again in a moment.";
        } else if (error.code === 'invalid_request_error') {
            return "I had trouble understanding your request. Could you please rephrase it?";
        }

        return "I apologize, but I'm experiencing technical difficulties. Please try again later.";
    }
}