import { MAX_HISTORY_MESSAGES, CHAT_MODEL } from './config.js';

// Get conversation history from WhatsApp
async function getConversationHistory(phoneNumber, client, currentMessage, limit = MAX_HISTORY_MESSAGES) {
    try {
        const chatId = `${phoneNumber}@c.us`;
        const chat = await client.getChatById(chatId);

        // Fetch messages from WhatsApp
        const messages = await chat.fetchMessages({ limit: limit + 10 }); // Fetch extra to account for filtering

        const formattedHistory = [];

        // Process messages in reverse order (oldest first)
        for (const msg of messages) {
            if (msg.body && msg.body.trim()) {
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
                    content = `${start}...${end}`;
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
You are Shilla, the official customer care representative for Babu Motors Uganda Ltd.
Your role is to respond to customer inquiries on WhatsApp with clear, helpful, short and concise answers related only to Babu Motors
**Knowledge Base Context:**
{context}
Based on the context provided and our previous conversation, please answer the following query.
Rules:
Write ONLY the text of the message you would send.
The message must be casual and human-like.
message must be short, concise, and to the point.
You can assist with Any updates or info related to Babu Motors Uganda
You're a person, not some robot. If something's confusing,tell them to contact babu motors directly.
ABSOLUTELY DO NOT OUTPUT ANY of the following:
Role play actions in asterisks (e.g., *smiles*, *sends a photo*, *laughs*).
Quotation marks (" ") enclosing the message.
Labels (e.g., You:, Message:).
System descriptions (e.g., Typing..., [seen]).
Explanations about your tone or thoughts.
The other person's potential reply.
`

// RAG-powered Chat Function with Memory
export async function chatWithAssistant(phoneNumber, userMessage, client, openai, knowledgeBase) {
    try {
        console.log(`🤖 Processing message from ${phoneNumber}: "${userMessage}"`);

        // 1. Retrieve conversation history from WhatsApp
        const userHistory = await getConversationHistory(phoneNumber, client, userMessage);

        // 2. Search the knowledge base based on the latest user message for relevant context
        const context = await knowledgeBase.search(userMessage);

        // 3. Augment the system prompt with context
        const augmentedInstructions = ASSISTANT_INSTRUCTIONS.replace('{context}', context);

        // 4. Construct the full message payload for OpenAI
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

        // 5. Create a response with the augmented prompt and conversation history
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            messages: messages,
        });

        const assistantResponse = response.choices[0].message.content;

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
