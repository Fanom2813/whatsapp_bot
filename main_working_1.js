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

// Model for Responses API
const MODEL = "gpt-4o";

const previousResponses = new Map();


// Custom assistant instructions
const ASSISTANT_INSTRUCTIONS = `You are Shilla, the official AI assistant for Babu Motors Uganda Ltd. Your role is to respond on WhatsApp to new and existing customers with clear, helpful, and concise answers related only to Babu Motors.

✅ You can assist with:
– Vehicle bookings and requirements
– “Drive to Own” program
– Application process and required documents
– Insurance, payments, deliveries, and support
– Any updates or info related to Babu Motors Uganda

❌ If someone asks about other companies, services, or unrelated topics, kindly respond:
"I'm here to help only with Babu Motors Uganda. For anything else, please reach out to the relevant company."

🗣️ Keep your tone friendly, natural, and professional — as if you're a helpful team member of Babu Motors.`;


// Initialize OpenAI client using environment variables
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Variable to store file ID
let fileId;

// Upload Markdown file once at startup
async function uploadKnowledgeBase() {
    try {
        console.log('📚 Uploading knowledge base file...');
        const fileResp = await openai.files.create({
            file: fs.createReadStream(path.join(__dirname, 'data.md')),
            purpose: 'assistants',
        });
        fileId = fileResp.id;
        console.log(`✅ Knowledge base uploaded successfully. File ID: ${fileId}`);
    } catch (error) {
        console.error('❌ Error uploading knowledge base:', error);
        throw error;
    }
}

const client = new Client({
    authStrategy: new LocalAuth()
});



client.on('ready', () => {
    console.log('🚗 Babu Motors WhatsApp Bot is ready!');
    console.log('🤖 AI Assistant powered by OpenAI Responses API');
    console.log(`📱 Model: ${MODEL}`);
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

client.on('message_create', async message => {
    // Skip if message is from the bot itself
    if (message.fromMe) return;
    if (!message.from.includes('205')) return;

    try {
        // Get the contact's phone number
        const contact = await message.getContact();
        const phoneNumber = contact.number;
        const messageBody = message.body.trim();

        // Skip empty messages
        if (!messageBody) return;

        console.log(`📱 Received message from ${phoneNumber}: "${messageBody}"`);

        // Get response from assistant
        const assistantResponse = await chatWithAssistant(phoneNumber, messageBody);


        // Send the assistant's response
        await message.reply(assistantResponse);

        console.log(`📤 Sent response to ${phoneNumber}`);

    } catch (error) {
        console.error('❌ Error handling message:', error);

        // Send error message to user
        try {
            await message.reply("I apologize, but I'm experiencing technical difficulties. Please try again later.");
        } catch (replyError) {
            console.error('❌ Error sending error message:', replyError);
        }
    }
});

// Initialize everything
async function initialize() {
    try {
        // Upload knowledge base first
        await uploadKnowledgeBase();

        // Then initialize WhatsApp client
        await client.initialize();
    } catch (error) {
        console.error('❌ Error during initialization:', error);
        process.exit(1);
    }
}

// Start initialization
initialize();

process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down Babu Motors WhatsApp Bot...');

    // Log conversation statistics
    console.log(`📊 Active conversations: ${userConversations.size}`);
    if (userConversations.size > 0) {
        console.log('📞 Phone numbers with active conversations:');
        userConversations.forEach((messages, phoneNumber) => {
            console.log(`   - ${phoneNumber}: ${messages.length} messages`);
        });
    }

    await client.destroy();
    process.exit(0);
});

// Function to send message to assistant using Responses API and get response
async function chatWithAssistant(phoneNumber, userMessage) {
    try {

        const previousResponseId = previousResponses.get(phoneNumber) || null;


        console.log(`🤖 Processing message from ${phoneNumber}: "${userMessage}"`);

        console.log(`🚀 Creating response with ${userMessage.length} messages`);

        // Create response using Responses API
        const response = await openai.responses.create({
            model: MODEL,
            input: userMessage,
            instructions: ASSISTANT_INSTRUCTIONS,
            previous_response_id: previousResponseId,
            tools: [
                {
                    type: "file_search",
                    vector_store_ids: ['vs_yh3ntxtqFoUSIu2DL9wyGRdY']
                }
            ]
        });

        previousResponses.set(phoneNumber, response.id);

        console.log(`✅ Response created successfully`);

        // Extract the assistant's response
        const assistantResponse = response.output_text;


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

        return "I apologize, but I'm experiencing technical difficulties. Please try again later.";
    }
}
