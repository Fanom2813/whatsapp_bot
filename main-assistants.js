import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Get current file directory for knowledge base path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Model for Assistants API
const MODEL = "gpt-4o";

// Custom assistant instructions
const ASSISTANT_INSTRUCTIONS = `You are Babu, a helpful AI assistant for Babu Motors Uganda Limited, a reputable vehicle leasing company specializing in the "Drive to Own" program.

Your knowledge comes from the uploaded company documentation that contains complete terms and conditions, pricing, payment methods, and procedures.

Key responsibilities:
- Help customers understand the Drive to Own program
- Explain vehicle options, pricing, and security deposits
- Guide customers through application processes
- Clarify payment methods and lease terms
- Assist with understanding insurance and maintenance responsibilities
- Provide information about lease transfers and refunds

Always be:
- Professional and helpful
- Clear and accurate with financial information
- Supportive of customers' vehicle ownership goals
- Knowledgeable about company policies

When customers ask about specific vehicles, pricing, or procedures, refer to the company documentation provided. If you need to verify specific current pricing or availability, direct them to visit the office in Najjera 1, opposite Stabex Petrol Station.

Keep responses concise but informative, perfect for WhatsApp conversations.`;

// Store conversation threads by phone number
const userThreads = new Map();

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Global variables for assistant and file
let assistant = null;
let uploadedFile = null;

// Initialize the assistant with file search capability
async function initializeAssistant() {
    try {
        console.log('🚀 Initializing Babu Motors Assistant...');

        // Upload the data.md file
        console.log('📁 Uploading knowledge base file...');
        const dataFilePath = path.join(__dirname, 'data.md');

        if (!fs.existsSync(dataFilePath)) {
            throw new Error('data.md file not found. Please ensure data.md exists in the project directory.');
        }

        uploadedFile = await openai.files.create({
            file: fs.createReadStream(dataFilePath),
            purpose: "assistants",
        });

        console.log(`✅ File uploaded with ID: ${uploadedFile.id}`);

        // Create assistant with file search tool
        assistant = await openai.beta.assistants.create({
            name: "Babu Motors Assistant",
            instructions: ASSISTANT_INSTRUCTIONS,
            model: MODEL,
            tools: [{ type: "file_search" }],
            tool_resources: {
                file_search: {
                    vector_stores: [{
                        file_ids: [uploadedFile.id]
                    }]
                }
            }
        });

        console.log(`🤖 Assistant created with ID: ${assistant.id}`);
        console.log('✅ Babu Motors Assistant initialization complete!');

    } catch (error) {
        console.error('❌ Error initializing assistant:', error);
        throw error;
    }
}

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('ready', async () => {
    console.log('🚗 Babu Motors WhatsApp Bot is ready!');
    console.log('🤖 AI Assistant powered by OpenAI Assistants API');
    console.log(`📱 Model: ${MODEL}`);
    console.log('💬 Conversation management: Thread-based');
    console.log('💾 Thread storage: In-memory (Map)');
    console.log('📋 Knowledge base: data.md file search');

    // Initialize the assistant
    try {
        await initializeAssistant();
        console.log('⚡ Ready to receive messages!');
    } catch (error) {
        console.error('❌ Failed to initialize assistant. Bot may not function properly.');
    }
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

client.on('message_create', async message => {
    // Skip if message is from the bot itself
    if (message.fromMe) return;

    try {
        // Get the contact's phone number
        const contact = await message.getContact();
        const phoneNumber = contact.number;
        const messageBody = message.body.trim();

        // Skip empty messages
        if (!messageBody) return;

        console.log(`📱 Received message from ${phoneNumber}: "${messageBody}"`);

        // Check if assistant is initialized
        if (!assistant) {
            await message.reply("I'm still initializing. Please wait a moment and try again.");
            return;
        }

        // Send typing indicator
        const chat = await message.getChat();
        await chat.sendStateTyping();

        // Get response from assistant
        const assistantResponse = await chatWithAssistant(phoneNumber, messageBody);

        // Send the assistant's response
        await message.reply(assistantResponse);

        console.log(`📤 Sent response to ${phoneNumber}`);

    } catch (error) {
        console.error('❌ Error handling message:', error);

        // Send error message to user
        try {
            await message.reply("I apologize, but I'm experiencing technical difficulties. Please try again later or contact our office directly.");
        } catch (replyError) {
            console.error('❌ Error sending error message:', replyError);
        }
    }
});

// Add initialization to start the client
client.initialize().catch(error => {
    console.error('❌ Error initializing WhatsApp client:', error);
});

// Handle process termination gracefully
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down Babu Motors WhatsApp Bot...');

    // Log thread statistics
    console.log(`📊 Active threads: ${userThreads.size}`);
    if (userThreads.size > 0) {
        console.log('📞 Phone numbers with active threads:');
        userThreads.forEach((threadId, phoneNumber) => {
            console.log(`   - ${phoneNumber}: ${threadId}`);
        });
    }

    // Cleanup assistant and file if needed
    if (assistant) {
        try {
            await openai.beta.assistants.del(assistant.id);
            console.log('🗑️ Assistant deleted');
        } catch (error) {
            console.error('❌ Error deleting assistant:', error);
        }
    }

    if (uploadedFile) {
        try {
            await openai.files.del(uploadedFile.id);
            console.log('🗑️ Uploaded file deleted');
        } catch (error) {
            console.error('❌ Error deleting file:', error);
        }
    }

    await client.destroy();
    process.exit(0);
});

// Function to get or create thread for a phone number
async function getOrCreateThread(phoneNumber) {
    console.log(`🔍 Getting/creating thread for phone: ${phoneNumber}`);

    if (!userThreads.has(phoneNumber)) {
        console.log(`🆕 Creating new thread for ${phoneNumber}`);

        const thread = await openai.beta.threads.create({
            tool_resources: {
                file_search: {
                    vector_store_ids: [], // Will use assistant's vector store
                }
            }
        });

        userThreads.set(phoneNumber, thread.id);
        console.log(`✅ Created thread ${thread.id} for ${phoneNumber}`);
        return thread.id;
    } else {
        const threadId = userThreads.get(phoneNumber);
        console.log(`📞 Using existing thread ${threadId} for ${phoneNumber}`);
        return threadId;
    }
}

// Function to wait for run completion
async function waitForRunCompletion(threadId, runId) {
    let run = await openai.beta.threads.runs.retrieve(threadId, runId);

    while (run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled") {
        await new Promise(resolve => setTimeout(resolve, 1000));
        run = await openai.beta.threads.runs.retrieve(threadId, runId);
        console.log(`⏳ Run status: ${run.status}`);
    }

    return run;
}

// Function to send message to assistant using Assistants API and get response
async function chatWithAssistant(phoneNumber, userMessage) {
    try {
        console.log(`🤖 Processing message from ${phoneNumber}: "${userMessage}"`);

        // Get or create thread for this phone number
        const threadId = await getOrCreateThread(phoneNumber);

        // Add user message to thread
        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: userMessage
        });

        console.log(`📝 Added user message to thread ${threadId}`);

        // Run the assistant
        const run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: assistant.id,
        });

        console.log(`🚀 Created run ${run.id} for thread ${threadId}`);

        // Wait for completion
        const completedRun = await waitForRunCompletion(threadId, run.id);

        if (completedRun.status === "failed") {
            console.error(`❌ Run failed:`, completedRun.last_error);
            return "I apologize, but I encountered an error processing your request. Please try again.";
        }

        if (completedRun.status === "cancelled") {
            console.error(`❌ Run was cancelled`);
            return "Your request was cancelled. Please try again.";
        }

        // Get the latest messages
        const messages = await openai.beta.threads.messages.list(threadId, {
            limit: 1,
            order: 'desc'
        });

        const assistantMessage = messages.data[0];

        if (assistantMessage.role !== 'assistant') {
            throw new Error('Expected assistant message but got: ' + assistantMessage.role);
        }

        // Extract text content
        const textContent = assistantMessage.content.find(content => content.type === 'text');
        const assistantResponse = textContent ? textContent.text.value : "I apologize, but I couldn't generate a proper response.";

        console.log(`✅ Assistant response for ${phoneNumber}: "${assistantResponse.substring(0, 100)}..."`);
        return assistantResponse;

    } catch (error) {
        console.error(`❌ Error in chatWithAssistant for ${phoneNumber}:`, error);
        console.error('Error stack:', error.stack);

        // Handle specific error types
        if (error.code === 'rate_limit_exceeded') {
            return "I'm experiencing high demand right now. Please try again in a moment.";
        } else if (error.code === 'invalid_request_error') {
            return "I had trouble understanding your request. Could you please rephrase it?";
        }

        return "I apologize, but I'm experiencing technical difficulties. Please contact our office at Najjera 1 for immediate assistance.";
    }
}

// Utility function to clear thread for a phone number (useful for testing)
async function clearThread(phoneNumber) {
    if (userThreads.has(phoneNumber)) {
        const threadId = userThreads.get(phoneNumber);
        try {
            await openai.beta.threads.del(threadId);
            console.log(`🗑️ Deleted thread ${threadId} for ${phoneNumber}`);
            userThreads.delete(phoneNumber);
            return true;
        } catch (error) {
            console.error(`❌ Error deleting thread for ${phoneNumber}:`, error);
            userThreads.delete(phoneNumber); // Remove from map even if deletion failed
            return false;
        }
    }
    return false;
}

// Utility function to get thread statistics
function getThreadStats() {
    return {
        totalThreads: userThreads.size,
        phoneNumbers: Array.from(userThreads.keys()),
        threadIds: Array.from(userThreads.values())
    };
}

// Export utility functions for potential use in other modules
export { clearThread, getThreadStats };
