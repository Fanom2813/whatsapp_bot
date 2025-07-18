import { MESSAGE_GROUPING_DELAY } from './config.js';
import { chatWithAssistant } from './chat.js';
import { addMessage } from './historyStore.js';
import axios from 'axios';
import { upsertChatAndAddMessage } from './chatPocketbase.js';
import PocketBase from 'pocketbase';

// Message Grouping state
const messageGroups = new Map(); // Store grouped messages by phone number
const groupingTimers = new Map(); // Store timers for each phone number
const processingContacts = new Set(); // Track contacts currently being processed

// Message Grouping Function
export function handleMessageGrouping(phoneNumber, messageBody, userName, client, openai, knowledgeBase, messageId) {
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
        await processGroupedMessages(phoneNumber, userName, client, openai, knowledgeBase, messageId);
    }, MESSAGE_GROUPING_DELAY);

    groupingTimers.set(phoneNumber, timer);
}

// Add a sendMessage function that uses the WhatsApp SDK if provided
export async function sendMessage(phoneNumber, message, whatsapp) {
    // Ensure message is a string
    let safeMessage = message;
    if (typeof safeMessage !== 'string') {
        console.warn('⚠️ Message to send is not a string. Converting to string:', safeMessage);
        try {
            safeMessage = JSON.stringify(safeMessage);
        } catch (e) {
            safeMessage = String(safeMessage);
        }
    }
    // Only use whatsapp.messages.text for sending messages
    if (whatsapp) {
        try {
            var r = await whatsapp.messages.text({ body: safeMessage }, phoneNumber);
            console.log(`📤 Sent AI response to ${phoneNumber} via WhatsApp API.`);
        } catch (err) {
            console.error('❌ Error sending message via WhatsApp API:', err);
        }
    } else {
        // Fallback: just log the message (for webhook-only mode/testing)
        console.log(`(DEV) Would send to ${phoneNumber}: ${safeMessage}`);
    }
}

// Helper to send typing indicator using WhatsApp Cloud API
// Accepts only messageId
async function sendTypingIndicator(messageId) {
    try {
        const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
        const ACCESS_TOKEN = process.env.CLOUD_API_ACCESS_TOKEN;
        const API_VERSION = process.env.CLOUD_API_VERSION || 'v19.0';
        if (!WA_PHONE_NUMBER_ID || !ACCESS_TOKEN) {
            console.warn('WA_PHONE_NUMBER_ID or CLOUD_API_ACCESS_TOKEN not set. Skipping typing indicator.');
            return;
        }
        if (!messageId) {
            console.warn('No messageId provided for typing indicator. Skipping.');
            return;
        }
        const url = `https://graph.facebook.com/${API_VERSION}/${WA_PHONE_NUMBER_ID}/messages`;
        const payload = {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
            typing_indicator: {
                type: 'text'
            }
        };
        await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✍️ Sent typing indicator for message ${messageId}`);
    } catch (err) {
        console.warn('⚠️ Failed to send typing indicator:', err?.response?.data || err.message);
    }
}

/**
 * Retrieves the WhatsApp profile image URL for a given phone number using the Cloud API.
 * Note: The official API only supports fetching the business profile for your own number.
 * @param {string} phoneNumberId - The WhatsApp Business Phone Number ID.
 * @returns {Promise<string|null>} The profile picture URL, or null if not found.
 */
export async function getBusinessProfileImage(phoneNumberId) {
    const ACCESS_TOKEN = process.env.CLOUD_API_ACCESS_TOKEN;
    const API_VERSION = process.env.CLOUD_API_VERSION || 'v19.0';
    if (!phoneNumberId || !ACCESS_TOKEN) {
        console.warn('phoneNumberId or CLOUD_API_ACCESS_TOKEN not set. Cannot fetch business profile image.');
        return null;
    }
    const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/whatsapp_business_profile?fields=profile_picture_url`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
            },
        });
        return response.data?.profile_picture_url || null;
    } catch (error) {
        console.error('❌ Error fetching WhatsApp business profile image:', error?.response?.data || error.message);
        return null;
    }
}

// Update processGroupedMessages to upsert chat and add message to PocketBase
async function processGroupedMessages(phoneNumber, userName, whatsapp, openai, knowledgeBase, messageId) {
    try {
        await sendTypingIndicator(messageId);
        processingContacts.add(phoneNumber);
        const messageGroup = messageGroups.get(phoneNumber);
        if (!messageGroup || messageGroup.length === 0) {
            processingContacts.delete(phoneNumber);
            return;
        }
        const combinedMessage = messageGroup.join('\n\n');
        console.log(`📱 Processing grouped messages from ${phoneNumber} (${userName}):`);
        console.log(`📝 Combined message (${messageGroup.length} messages): "${combinedMessage}"`);
        messageGroup.forEach((msg, index) => {
            console.log(`  ${index + 1}. "${msg}"`);
        });
        console.log('─'.repeat(50));
        // Store user message in history
        addMessage(phoneNumber, 'user', combinedMessage);
        // Fetch business profile image for this phone number (if possible)
        const profilePictureUrl = await getBusinessProfileImage(phoneNumber);
        // Upsert chat and add message to PocketBase
        await upsertChatAndAddMessage({
            phone: phoneNumber,
            name: userName,
            message: {
                text: combinedMessage,
                sender: 'user',
                type: 'text',
                status: 'sent'
            },
            profilePictureUrl
        });
        // Send combined message to AI assistant
        const assistantResponse = await chatWithAssistant(phoneNumber, combinedMessage, whatsapp, openai, knowledgeBase);
        if (!assistantResponse) {
            console.log(`⚠️ No response generated for ${phoneNumber} - likely due to parsing error`);
            return;
        }
        // Store assistant response in history
        addMessage(phoneNumber, 'assistant', assistantResponse);
        await sendMessage(phoneNumber, assistantResponse, whatsapp);
        // Upsert AI response in PocketBase
        await upsertChatAndAddMessage({
            phone: phoneNumber,
            name: userName,
            message: {
                text: assistantResponse,
                sender: 'ai',
                type: 'text',
                status: 'sent'
            },
            profilePictureUrl
        });
        console.log(`📤 Sent AI response to ${phoneNumber} (${userName}):`);
        console.log(`💬 AI: "${assistantResponse}"`);
        console.log('═'.repeat(50));
        messageGroups.delete(phoneNumber);
        groupingTimers.delete(phoneNumber);
    } finally {
        processingContacts.delete(phoneNumber);
    }
}

// Clear message grouping timers
export function clearMessageGroupingTimers() {
    groupingTimers.forEach(timer => clearTimeout(timer));
    groupingTimers.clear();
    processingContacts.clear();
    console.log('⏰ Message grouping timers cleared');
}
