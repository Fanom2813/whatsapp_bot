import { MAX_HISTORY_MESSAGES, CHAT_MODEL } from './config.js';
import fs from 'fs';
import path from 'path';
import { getHistory } from './historyStore.js';

// Get conversation history from in-memory store
async function getConversationHistory(phoneNumber, client, currentMessage, limit = MAX_HISTORY_MESSAGES) {
    try {
        // Use in-memory history instead of WhatsApp SDK
        const formattedHistory = getHistory(phoneNumber, limit);
        console.log(`📜 Fetched ${formattedHistory.length} messages from in-memory history for ${phoneNumber}`);
        return formattedHistory;
    } catch (error) {
        console.error(`❌ Error fetching conversation history for ${phoneNumber}:`, error);
        return [];
    }
}
// Assistant Instructions (default)
const DEFAULT_ASSISTANT_INSTRUCTIONS = `You are "Shilla," a friendly and professional customer care representative for Babu Motors Uganda Ltd. Your entire knowledge is limited to the context provided for each query.

Your Primary Task:
Generate a single, natural-sounding WhatsApp reply to customer inquiries. You must base your entire response exclusively on the provided "Knowledge Base Context" and our conversation. Do not use any external knowledge.
## Overarching Principle: Conversational Awareness ##

This is your most important principle. Before generating any reply, you MUST check the WhatsApp Log.

Avoid Repetition: If the user's latest message is the same as (or very similar to) the one they just sent, and you have already provided a detailed answer, DO NOT give the same detailed answer again.

Guide the Conversation: Instead, acknowledge their persistence and ask a targeted follow-up question based on the solutions you already offered. Your goal is to guide them to the next logical step.
## Core Content Rules ##

1. Handling Relevant Inquiries (About Babu Motors):

Rule A: Persona: Your tone should be casual, warm, and helpful. Write like a real person, not a robot.

Rule B: Handling Vague Questions: If a user asks a general question (How can I get a car?), ask a clarifying question to understand their needs before providing information.

Rule C: Handling Requests for Unavailable Vehicles: If a user requests a vehicle NOT on the DTO list (e.g., "BMW"), follow the 3-part response: 1) State it's not on the DTO plan, 2) List available DTO cars, 3) Offer alternative purchase options (Savings/Cash/Credit) and ask which they'd like to hear about.

Rule D: Cost & Price Questions: For an available vehicle, if a user asks for the "cost," state the initial deposit, security deposit, and payment plans.

2. Handling Off-Topic Inquiries (NOT About Babu Motors):

If a user asks a question not about Babu Motors, politely decline and steer the conversation back to your services.

AVAILABLE CARS : Toyota Wish, Toyota Noah, Toyota Sienta,Toyota Ractis,  Toyota Probox, Toyota Succeed, Toyota Isis, Toyota Rumion, Toyota Aqua Hybrid, Toyota Fielder Hybrid, Toyota Passo Settee, Toyota Fielder (Gasoline), Toyota Raum], PURCHASE OPTION: Savings Account, Cash Purchase, Credit Financing
Knowledge Base Context:
{context}
 `;

let assistantInstructions = DEFAULT_ASSISTANT_INSTRUCTIONS;

export function setAssistantInstructions(newPrompt) {
    if (typeof newPrompt === 'string' && newPrompt.trim().length > 0) {
        assistantInstructions = newPrompt;
        console.log('✅ Assistant instructions updated from settings collection.');
    } else {
        assistantInstructions = DEFAULT_ASSISTANT_INSTRUCTIONS;
        console.log('⚠️ Assistant instructions reset to default.');
    }
}

// Helper function to extract recent user messages for better knowledge base search
function extractRecentUserMessages(userHistory, currentMessage, limit = 1) {
    try {
        // Get the last few user messages (not assistant messages)
        const recentUserMessages = userHistory
            .filter(msg => msg.role === 'user')
            .slice(-limit)
            .map(msg => msg.content);

        // Combine recent user messages with current message
        const combinedMessages = [...recentUserMessages, currentMessage];

        // Join them with spaces and limit total length to avoid token limits
        const combinedContext = combinedMessages.join(' ').substring(0, 500);

        console.log(`🔍 Search context: "${combinedContext}"`);
        return combinedContext;
    } catch (error) {
        console.error('❌ Error extracting recent user messages:', error);
        return currentMessage; // Fallback to current message only
    }
}

// RAG-powered Chat Function with Memory
export async function chatWithAssistant(phoneNumber, userMessage, client, openai, knowledgeBase) {
    try {
        console.log(`🤖 Processing message from ${phoneNumber}: "${userMessage}"`);

        // 1. Retrieve conversation history from WhatsApp
        const userHistory = await getConversationHistory(phoneNumber, client, userMessage);

        // 2. Create enhanced search context by combining current message with recent user messages
        const searchContext = extractRecentUserMessages(userHistory, userMessage);

        // 3. Search the knowledge base using the enhanced context for better results
        const context = await knowledgeBase.search(searchContext);

        // 4. Augment the system prompt with context
        const augmentedInstructions = assistantInstructions.replace('{context}', context);

        // 5. Construct the full message payload for OpenAI
        const messages = [
            { role: 'system', content: augmentedInstructions },
            ...userHistory, // Add the conversation history
            { role: 'user', content: userMessage } // Add the current user message
        ];

        console.log(`📝 Sending to OpenAI - Total messages: ${messages.length}`);
        console.log(`📝 Current user message: "${userMessage}"`);
        console.log(`📝 History messages: ${userHistory.length}`);

        // Log the last few messages for debugging
        if (userHistory.length > 0) {
            console.log('📜 Last few history messages:');
            userHistory.slice(-3).forEach((msg, index) => {
                console.log(`  ${index + 1}. ${msg.role}: "${msg.content}"`);
            });
        }

        // 6. Create a response with the augmented prompt and conversation history
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            messages: messages,
            temperature: 0.7
        });

        const assistantResponse = response.choices[0].message.content;

        // Check if the assistant failed to answer
        const fallbackMessage = "I don't have enough information to answer that";
        if (
            assistantResponse &&
            assistantResponse.trim().toLowerCase().includes(fallbackMessage.toLowerCase())
        ) {
            const failedLogPath = path.resolve(process.cwd(), 'failed_to_answer.txt');
            const logEntry = `Phone: ${phoneNumber}\nQuestion: ${userMessage}\nTime: ${new Date().toISOString()}\n---\n`;
            try {
                // Ensure the file exists (create if not)
                fs.openSync(failedLogPath, 'a');
                fs.appendFileSync(failedLogPath, logEntry, 'utf8');
                console.log(`❗ Logged unanswered question to failed_to_answer.txt`);
            } catch (logErr) {
                console.error('❌ Failed to log unanswered question:', logErr);
            }
        }

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
