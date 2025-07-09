import pkg from 'whatsapp-web.js';
const { Client, Lo= pkg;
import qrcode from 'qrcode-terminal';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Load environment variables
dotenv.config();

// Get current file directory for knowledge base path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Model for Responses API
const MODEL = "gpt-4o";

// Custom assistant instructions
const ASSISTANT_INSTRUCTIONS = `You are Babu, a helpful AI assistant for Babu Motors, a car dealership and automotive service center. You are knowledgeable about:

- Car sales and inventory
- Automotive services and repairs
- Vehicle maintenance schedules
- Car parts and accessories
- Financing options
- Trade-in evaluations
- Service appointments

Always be friendly, professional, and helpful. When customers ask about specific services or vehicles, provide detailed and accurate information. If you need to schedule appointments or check specific inventory, let them know they can contact the dealership directly.

Keep responses concise but informative, perfect for WhatsApp conversations.`;

// Store conversation history by phone number (in production, use a database)
const userConversations = new Map();

// Initialize OpenAI client using environment variables
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

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
});

client.on('ready', () => {
    console.log('🚗 Babu Motors WhatsApp Bot is ready!');
    console.log('🤖 AI Assistant powered by OpenAI Assistant API');
    console.log(`🆔 Using Assistant ID: ${ASSISTANT_ID}`);
    console.log('� Thread management: Phone number based');
    console.log('💾 Thread storage: In-memory (Map)');
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

    try {
        // Get the contact's phone number
        const contact = await message.getContact();
        const phoneNumber = contact.number;
        const messageBody = message.body.trim();

        // Skip empty messages
        if (!messageBody) return;

        console.log(`📱 Received message from ${phoneNumber}: "${messageBody}"`);

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
            await message.reply("I apologize, but I'm experiencing technical difficulties. Please try again later.");
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

// Utility function to clear conversation for a phone number (useful for testing)
function clearConversation(phoneNumber) {
    if (userConversations.has(phoneNumber)) {
        console.log(`🗑️ Cleared conversation for ${phoneNumber}`);
        userConversations.delete(phoneNumber);
        return true;
    }
    return false;
}

// Utility function to get conversation statistics
function getConversationStats() {
    return {
        totalConversations: userConversations.size,
        phoneNumbers: Array.from(userConversations.keys()),
        messageCount: Array.from(userConversations.values()).reduce((total, messages) => total + messages.length, 0)
    };
}

// Export utility functions for potential use in other modules
export { clearConversation, getConversationStats };

// Function to get or create conversation history for a phone number
function getOrCreateConversation(phoneNumber) {
    console.log(`🔍 Getting/creating conversation for phone: ${phoneNumber}`);
    
    if (!userConversations.has(phoneNumber)) {
        console.log(`🆕 Creating new conversation for ${phoneNumber}`);
        userConversations.set(phoneNumber, []);
    } else {
        console.log(`📞 Using existing conversation for ${phoneNumber} (${userConversations.get(phoneNumber).length} messages)`);
    }
    
    return userConversations.get(phoneNumber);
}

// Function to send message to assistant using Responses API and get response
async function chatWithAssistant(phoneNumber, userMessage) {
    try {
        console.log(`🤖 Processing message from ${phoneNumber}: "${userMessage}"`);

        // Get conversation history for this phone number
        const conversationHistory = getOrCreateConversation(phoneNumber);
        
        // Add user message to conversation history
        conversationHistory.push({
            role: "user",
            content: userMessage
        });
        
        console.log(`� Added user message to conversation (total: ${conversationHistory.length} messages)`);

        // Prepare messages for the Responses API
        const messages = [
            // Start with system instructions
            {
                role: "system",
                content: ASSISTANT_INSTRUCTIONS
            },
            // Add conversation history
            ...conversationHistory
        ];

        console.log(`� Creating response with ${messages.length} messages`);
        
        // Create response using Responses API
        const response = await openai.responses.create({
            model: MODEL,
            input: messages,
            instructions: ASSISTANT_INSTRUCTIONS,
            // Optional: Add tools if needed
            // tools: [...] 
        });

        console.log(`✅ Response created successfully`);
        
        // Extract the assistant's response
        const assistantResponse = response.output_text;
        
        // Add assistant response to conversation history
        conversationHistory.push({
            role: "assistant",
            content: assistantResponse
        });

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
        
        return "I apologize, but I'm experiencing technical difficulties. Please try again later.";
    }
}