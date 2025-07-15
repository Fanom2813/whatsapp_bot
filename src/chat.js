import { MAX_HISTORY_MESSAGES, CHAT_MODEL } from './config.js';
import fs from 'fs';
import path from 'path';

// Get conversation history from WhatsApp
async function getConversationHistory(phoneNumber, client, currentMessage, limit = MAX_HISTORY_MESSAGES) {
    try {
        const chatId = `${phoneNumber}@c.us`;
        const chat = await client.getChatById(chatId);

        // Fetch messages from WhatsApp
        const messages = await chat.fetchMessages({ limit: limit }); // Fetch extra to account for filtering

        const formattedHistory = [];

        // Process messages in reverse order (oldest first)
        for (const msg of messages) {
            if (msg.body && msg.body.trim()) {
                // if (msg.fromMe) continue; // Skip messages sent by the bot itself
                const role = msg.fromMe ? 'assistant' : 'user';
                let content = msg.body.trim();

                // Skip if this message content is part of the current message being processed
                if (currentMessage && currentMessage.includes(content)) {
                    console.log(`⏭️ Skipping message that's part of current grouped message: "${content}"`);
                    continue;
                }

                // Truncate long assistant messages in the middle
                if (role === 'assistant' && content.length > 200) {
                    const start = content.substring(0, 80);
                    const end = content.substring(content.length - 80);
                    content = `${end}`;
                }

                formattedHistory.push({
                    role: role,
                    content: content
                });

                // Stop when we have enough history messages
                if (formattedHistory.length >= limit) {
                    break;
                }
            }
        }

        console.log(`📜 Fetched ${formattedHistory.length} messages from WhatsApp for ${phoneNumber}`);
        return formattedHistory;

    } catch (error) {
        console.error(`❌ Error fetching conversation history for ${phoneNumber}:`, error);
        return [];
    }
}
// Assistant Instructions
const ASSISTANT_INSTRUCTIONS = `Your Task: Write a single, natural-sounding WhatsApp message.
Context:
You are Shilla, a friendly customer care person for Babu Motors Uganda Ltd. helpful, casual, and human.
Knowledge Base Context:
{context}
Based on the context provided and our conversation history, you must answer the user's query.
if you do not have enough information, in the context about the user's query, simply say "I don't have enough information to answer that. Please contact Babu Motors directly for assistance."
Rules:
if somebody ask about how much a car costs most time they mean what is the initial deposit of that car, you should tell them the security deposit plus payment plans
Be Natural & Casual: Sound like a real person, not a robot. Keep it friendly and conversational.
explain in details as detailed as possible base on the context in simple language, avoid technical jargon.
always explain in details`

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
        const augmentedInstructions = ASSISTANT_INSTRUCTIONS.replace('{context}', context);

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
