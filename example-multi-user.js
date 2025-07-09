// example-multi-user.js - Example of using the updated RAG system with multiple users

import {
    answerWithRAG,
    initializeKnowledgeBase,
    clearUserConversation,
    getConversationStatus,
    getActiveConversationsCount
} from './rag-system.js';

// Example usage for WhatsApp bot or multi-user chat application

async function handleUserMessage(userId, message, knowledgeBasePath) {
    try {
        console.log(`\n📱 User ${userId}: ${message}`);

        // Get conversation status before processing
        const status = getConversationStatus(userId);
        console.log(`💬 Conversation status:`, status);

        // Process the message with RAG and maintain conversation continuity
        const response = await answerWithRAG(message, knowledgeBasePath, userId);

        console.log(`🤖 Bot response: ${response}`);
        console.log(`📊 Active conversations: ${getActiveConversationsCount()}`);

        return response;
    } catch (error) {
        console.error(`❌ Error handling message for user ${userId}:`, error);
        return "Sorry, I encountered an error. Please try again.";
    }
}

// Example simulation of multiple users
async function simulateMultiUserConversation() {
    const knowledgePath = './babu_motors_knowledge.md';

    try {
        // Initialize the knowledge base once
        await initializeKnowledgeBase(knowledgePath);

        console.log("🚀 Starting multi-user conversation simulation...\n");

        // User A asks about pricing
        await handleUserMessage("user_alice", "What are your car prices?", knowledgePath);

        // User B asks about location
        await handleUserMessage("user_bob", "Where is your office located?", knowledgePath);

        // User A continues their conversation (should have context from previous message)
        await handleUserMessage("user_alice", "Do you offer payment plans?", knowledgePath);

        // User B continues their conversation 
        await handleUserMessage("user_bob", "What are your working hours?", knowledgePath);

        // User A asks a follow-up (continuing their thread)
        await handleUserMessage("user_alice", "What's the minimum down payment?", knowledgePath);

        // Show conversation statuses
        console.log("\n📈 Final conversation statuses:");
        console.log("Alice:", getConversationStatus("user_alice"));
        console.log("Bob:", getConversationStatus("user_bob"));

        // Optional: Clear a specific user's conversation
        console.log("\n🧹 Clearing Alice's conversation...");
        clearUserConversation("user_alice");
        console.log("Alice after clear:", getConversationStatus("user_alice"));

    } catch (error) {
        console.error("❌ Simulation error:", error);
    }
}

// Example WhatsApp bot integration function
function createWhatsAppBotHandler(knowledgeBasePath) {
    return async function (phoneNumber, message) {
        // Use phone number as user ID for conversation continuity
        const userId = phoneNumber.replace(/[^\d]/g, ''); // Clean phone number

        return await handleUserMessage(userId, message, knowledgeBasePath);
    };
}

// Example Express.js webhook handler
function createWebhookHandler(knowledgeBasePath) {
    return async function (req, res) {
        try {
            const { userId, message } = req.body;

            if (!userId || !message) {
                return res.status(400).json({ error: 'Missing userId or message' });
            }

            const response = await handleUserMessage(userId, message, knowledgeBasePath);

            res.json({
                response,
                conversationStatus: getConversationStatus(userId)
            });
        } catch (error) {
            console.error('Webhook error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}

// Export examples for use in other files
export {
    handleUserMessage,
    simulateMultiUserConversation,
    createWhatsAppBotHandler,
    createWebhookHandler
};

// Run simulation if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    simulateMultiUserConversation();
}
