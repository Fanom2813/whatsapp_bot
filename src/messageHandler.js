import { MESSAGE_GROUPING_DELAY } from './config.js';
import { chatWithAssistant } from './chat.js';

// Message Grouping state
const messageGroups = new Map(); // Store grouped messages by phone number
const groupingTimers = new Map(); // Store timers for each phone number
const processingContacts = new Set(); // Track contacts currently being processed

// Message Grouping Function
export function handleMessageGrouping(phoneNumber, messageBody, userName, client, openai, knowledgeBase) {
    // Check if we're already processing messages for this contact
    if (processingContacts.has(phoneNumber)) {
        console.log(`⏳ Already processing messages for ${phoneNumber} (${userName}), adding to queue...`);
        // Add to existing message group
        let messageGroup = messageGroups.get(phoneNumber) || [];
        messageGroup.push(messageBody);
        messageGroups.set(phoneNumber, messageGroup);
        return; // Don't set a new timer, let the current processing finish
    }

    // Get or create message group for this phone number
    let messageGroup = messageGroups.get(phoneNumber) || [];
    messageGroup.push(messageBody);
    messageGroups.set(phoneNumber, messageGroup);

    // Clear existing timer if there is one
    if (groupingTimers.has(phoneNumber)) {
        clearTimeout(groupingTimers.get(phoneNumber));
    }

    // Set new timer to process grouped messages
    const timer = setTimeout(async () => {
        await processGroupedMessages(phoneNumber, userName, client, openai, knowledgeBase);
    }, MESSAGE_GROUPING_DELAY);

    groupingTimers.set(phoneNumber, timer);
}

// Process Grouped Messages
async function processGroupedMessages(phoneNumber, userName, client, openai, knowledgeBase) {
    try {
        // Mark this contact as being processed
        processingContacts.add(phoneNumber);

        const messageGroup = messageGroups.get(phoneNumber);
        if (!messageGroup || messageGroup.length === 0) {
            // Clean up and return if no messages
            processingContacts.delete(phoneNumber);
            return;
        }

        // Combine all messages in the group
        const combinedMessage = messageGroup.join('\n\n');

        console.log(`📱 Processing grouped messages from ${phoneNumber} (${userName}):`);
        console.log(`📝 Combined message (${messageGroup.length} messages): "${combinedMessage}"`);
        console.log('─'.repeat(50)); // Visual separator

        // Get chat and show typing indicator
        const chatId = `${phoneNumber}@c.us`;
        const chat = await client.getChatById(chatId);
        chat.sendStateTyping();

        // Send combined message to AI assistant
        const assistantResponse = await chatWithAssistant(phoneNumber, combinedMessage, client, openai, knowledgeBase);

        if (!assistantResponse) {
            console.log(`⚠️ No response generated for ${phoneNumber} - likely due to parsing error`);
            return;
        }

        await chat.sendMessage(assistantResponse);

        console.log(`📤 Sent AI response to ${phoneNumber} (${userName}):`);
        console.log(`💬 AI: "${assistantResponse}"`);
        console.log('═'.repeat(50)); // End separator

        // Clear the message group and timer
        messageGroups.delete(phoneNumber);
        groupingTimers.delete(phoneNumber);

    } catch (error) {
        console.error(`❌ Error processing grouped messages for ${phoneNumber}:`, error);

        // Clean up on error
        messageGroups.delete(phoneNumber);
        groupingTimers.delete(phoneNumber);
    } finally {
        // Always remove from processing set
        processingContacts.delete(phoneNumber);

        // Check if there are any messages that came in while processing
        if (messageGroups.has(phoneNumber)) {
            const remainingMessages = messageGroups.get(phoneNumber);
            if (remainingMessages && remainingMessages.length > 0) {
                console.log(`🔄 Processing additional messages that arrived for ${phoneNumber} (${userName})`);
                // Set a new timer to process remaining messages
                const timer = setTimeout(async () => {
                    await processGroupedMessages(phoneNumber, userName, client, openai, knowledgeBase);
                }, MESSAGE_GROUPING_DELAY);
                groupingTimers.set(phoneNumber, timer);
            }
        }
    }
}

// Clear message grouping timers
export function clearMessageGroupingTimers() {
    groupingTimers.forEach(timer => clearTimeout(timer));
    groupingTimers.clear();
    processingContacts.clear();
    console.log('⏰ Message grouping timers cleared');
}
