import pocketbase from './pb.js';

/**
 * Ensures a chat exists for the given phone, and adds a message to chat_message.
 * @param {Object} params
 * @param {string} params.phone - The phone number (chat identifier)
 * @param {string} params.name - The user's name
 * @param {Object} params.message - The message object (see below)
 * @returns {Promise<{chat: Object, chatMessage: Object}>}
 */
export async function upsertChatAndAddMessage({ phone, name, message }) {
    if (!phone || !name || !message) {
        throw new Error('Missing required parameters');
    }
    // 1. Try to find the chat by phone
    let chat;
    try {
        const result = await pocketbase.collection('chat').getList(1, 1, { filter: `phone = "${phone}"` });
        chat = result.items[0];
    } catch (err) {
        // If not found, continue to create
        if (err.status !== 404) throw err;
    }
    // 2. If not found, create the chat
    if (!chat) {
        chat = await pocketbase.collection('chat').create({
            phone,
            name,
            status: 'active',
            lastMessage: message.text || '',
            unread: message.sender === 'user' ? 1 : 0,
            online: true
        });
    } else {
        // 3. If found, update lastMessage and unread count
        await pocketbase.collection('chat').update(chat.id, {
            lastMessage: message.text || '',
            unread: message.sender === 'user' ? (chat.unread || 0) + 1 : chat.unread,
            online: true
        });
    }
    // 4. Add the message to chat_message
    const chatMessage = await pocketbase.collection('chat_message').create({
        ...message,
        chat: chat.id
    });
    return { chat, chatMessage };
} 