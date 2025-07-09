import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import OpenAI from 'openai';
import { answerWithRAG, getActiveConversationsCount, getConversationStatus, clearUserConversation, getUserMessages, setUserMessages } from './rag-system.js';
import { functionDefinitions, executeFunctionCall } from './function-tools.js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get current file directory for knowledge base path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KNOWLEDGE_BASE_PATH = path.join(__dirname, 'babu_motors_knowledge.md');

// Initialize OpenAI client using environment variables
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENAI_API_KEY
});

const client = new Client({
    authStrategy: new LocalAuth()
});

// Function to determine if a message requires function calling or RAG
function requiresFunctionCall(message) {
    const functionKeywords = [
        'balance', 'payment', 'pay', 'amount', 'owe', 'debt', 'arrears',
        'inspection', 'schedule', 'appointment', 'vehicle status', 'history',
        'payoff', 'settlement', 'total amount', 'check account', 'account status',
        'help', 'menu', 'commands', 'services', 'options'
    ];

    const lowerMessage = message.toLowerCase();

    // Check for exact matches first
    if (['help', 'menu', '!help', '/help'].includes(lowerMessage.trim())) {
        return true;
    }

    // Check for payment amount patterns (e.g., "pay 300000")
    if (/\b(pay|payment)\s+\d+/.test(lowerMessage)) {
        return true;
    }

    return functionKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Function to get unified conversation context for better continuity
function getConversationContextText(userId, isFunction = false) {
    const status = getConversationStatus(userId);

    if (!status.hasActiveConversation) {
        return "";
    }

    const contextType = isFunction ? "function calling" : "general knowledge";
    return `
CONVERSATION CONTINUITY CONTEXT:
- This customer (ID: ${userId}) has an ongoing conversation
- Message count: ${status.messageCount}
- Current request type: ${contextType}
- Please maintain natural conversation flow and acknowledge previous context when relevant
- The customer may be switching between general questions and specific account services

IMPORTANT: Maintain conversational continuity and context from previous interactions.
`;
}

// Enhanced function to handle both RAG and function calling
async function generateResponse(message, customerPhone) {
    try {
        // Clean phone number to use as user ID for consistent conversation tracking
        const userId = customerPhone.replace(/[^\d]/g, '');

        // First, determine if this requires function calling
        if (requiresFunctionCall(message)) {
            return await handleFunctionCallingRequest(message, customerPhone);
        } else {
            // Use RAG for general knowledge queries with user ID for conversation continuity
            return await answerWithRAG(message, KNOWLEDGE_BASE_PATH, userId);
        }
    } catch (error) {
        console.error('Error generating response:', error);
        return "I'm sorry, I'm having trouble processing your request right now. Please try again later or contact Babu Motors Uganda directly for assistance.";
    }
}

// Function to handle requests that require function calling
async function handleFunctionCallingRequest(message, customerPhone) {
    try {
        // Extract user ID for conversation continuity
        const userId = customerPhone.replace(/[^\d]/g, '');

        // Get or initialize conversation messages for this user
        let messages = getUserMessages(userId) || [];

        // Enhanced conversation context preparation
        const conversationContext = getConversationContextText(userId, true);

        // If no previous conversation, start with system message
        if (messages.length === 0) {
            messages.push({
                role: "system",
                content: `You are an AI assistant for Babu Motors Uganda, a vehicle leasing company. You help customers with their Drive-to-Own (DTO) lease accounts.

${conversationContext}

Your capabilities include:
- Checking account balances and payment status
- Initiating payments via mobile money
- Checking vehicle status and inspection schedules
- Scheduling vehicle inspections
- Retrieving payment history
- Calculating payoff amounts

Always be professional, helpful, and provide clear information. When customers ask about payments, balances, or account status, use the appropriate function to get real-time data.

The customer's phone number is: ${customerPhone}`
            });
        }

        // Add the current user message
        messages.push({ role: "user", content: message });

        const response = await openai.chat.completions.create({
            model: "deepseek/deepseek-chat-v3-0324:free",
            messages: messages,
            tools: functionDefinitions.map(func => ({ type: "function", function: func })),
            tool_choice: "auto",
            temperature: 0.3
        });

        const assistantMessage = response.choices[0].message;

        // Add the assistant's response to the conversation
        messages.push(assistantMessage);

        // Check if the response contains tool calls
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            let finalResponse = "";

            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);

                // Add customer phone if not provided
                if (!functionArgs.phone_number) {
                    functionArgs.phone_number = customerPhone;
                }

                console.log(`🔧 Executing function: ${functionName} with args:`, functionArgs);

                const functionResult = await executeFunctionCall(functionName, functionArgs);

                // Add function result to conversation
                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(functionResult)
                });

                // Format the response based on the function result
                finalResponse += formatFunctionResponse(functionName, functionResult);
            }

            // Store updated conversation for this user
            setUserMessages(userId, messages);
            console.log(`💾 Updated function calling conversation for user ${userId} (${messages.length} messages)`);

            return finalResponse;
        } else {
            // No function call needed, return the AI's direct response
            // Store updated conversation for this user
            setUserMessages(userId, messages);
            console.log(`💾 Updated conversation for user ${userId} (${messages.length} messages)`);

            return assistantMessage.content;
        }

    } catch (error) {
        console.error('Error in function calling:', error);
        return "I apologize, but I'm having trouble accessing your account information right now. Please try again in a moment or contact Babu Motors directly at 0785 123 456 for immediate assistance.";
    }
}

// Function to format responses from function calls
function formatFunctionResponse(functionName, result) {
    if (!result.success) {
        return `❌ ${result.message}\n\n`;
    }

    switch (functionName) {
        case 'get_help_menu':
            return result.menu;

        case 'check_account_balance':
            return `💰 **ACCOUNT BALANCE - ${result.customer_name}**\n` +
                `🚗 Vehicle: ${result.vehicle_plate}\n\n` +
                `📊 **Payment Progress:** ${result.progress_percentage}%\n` +
                `💵 **Total Amount:** UGX ${result.total_amount.toLocaleString()}\n` +
                `✅ **Paid:** UGX ${result.paid_amount.toLocaleString()}\n` +
                `⏳ **Remaining:** UGX ${result.remaining_amount.toLocaleString()}\n\n` +
                `📅 **Payment Schedule:**\n` +
                `• Weekly Payment: UGX ${result.weekly_payment.toLocaleString()}\n` +
                `• Last Payment: ${result.last_payment_date}\n` +
                `• Next Due: ${result.next_payment_due}\n\n` +
                `${result.current_arrears > 0 ?
                    `⚠️ **OVERDUE:**\n• Arrears: UGX ${result.current_arrears.toLocaleString()}\n• Penalties: UGX ${result.current_penalties.toLocaleString()}\n\n` :
                    '✅ **Account Status:** Current\n\n'}` +
                `Type "make payment" to initiate a payment or "payment history" to see recent transactions.`;

        case 'initiate_payment':
            return `💳 **PAYMENT INITIATED**\n\n` +
                `💰 Amount: UGX ${result.amount.toLocaleString()}\n` +
                `📱 Method: ${result.payment_method.replace('_', ' ').toUpperCase()}\n` +
                `🔖 Reference: ${result.payment_reference}\n\n` +
                `📝 **Instructions:**\n${result.instructions}\n\n` +
                `⏱️ Expected completion: ${result.expected_completion}\n\n` +
                `You will receive a confirmation SMS once payment is processed.`;

        case 'check_vehicle_status':
            return `🚗 **VEHICLE STATUS - ${result.vehicle_plate}**\n\n` +
                `📍 **Status:** ${result.status.toUpperCase()}\n` +
                `🛰️ **GPS:** ${result.gps_status.toUpperCase()}\n` +
                `📅 **Last Location Update:** ${result.location_last_updated}\n\n` +
                `🔧 **Inspection Schedule:**\n` +
                `• Last Inspection: ${result.last_inspection}\n` +
                `• Next Inspection: ${result.next_inspection}\n` +
                `• Days Until Due: ${result.days_until_inspection}\n` +
                `• Status: ${result.inspection_status.toUpperCase()}\n\n` +
                `${result.days_until_inspection <= 7 ?
                    '⚠️ Inspection due soon! Type "schedule inspection" to book an appointment.' :
                    'Type "schedule inspection" if you want to book your next inspection early.'}`;

        case 'schedule_inspection':
            return `📅 **INSPECTION SCHEDULED**\n\n` +
                `🆔 **Appointment ID:** ${result.appointment_id}\n` +
                `📅 **Date:** ${result.scheduled_date}\n` +
                `⏰ **Time:** ${result.scheduled_time}\n` +
                `📍 **Location:** ${result.location}\n` +
                `📞 **Contact:** ${result.contact}\n\n` +
                `${result.reminder}\n\n` +
                `Please arrive 15 minutes early and bring your vehicle registration documents.`;

        case 'get_payment_history':
            let historyText = `📋 **PAYMENT HISTORY - ${result.customer_name}**\n` +
                `🚗 Vehicle: ${result.vehicle_plate}\n\n`;

            result.recent_payments.forEach((payment, index) => {
                historyText += `${index + 1}. ${payment.date} - UGX ${payment.amount.toLocaleString()} (${payment.type.replace('_', ' ')})\n`;
            });

            historyText += `\n💵 **Total (Recent):** UGX ${result.total_in_period.toLocaleString()}\n` +
                `💰 **Total (All Time):** UGX ${result.total_all_time.toLocaleString()}`;

            return historyText;

        case 'calculate_payoff_amount':
            return `💰 **PAYOFF CALCULATION**\n\n` +
                `🏦 **Principal Remaining:** UGX ${result.remaining_principal.toLocaleString()}\n` +
                `${result.current_arrears > 0 ? `⚠️ **Current Arrears:** UGX ${result.current_arrears.toLocaleString()}\n` : ''}` +
                `${result.current_penalties > 0 ? `💸 **Penalties:** UGX ${result.current_penalties.toLocaleString()}\n` : ''}` +
                `💵 **Total Payoff:** UGX ${result.total_payoff_amount.toLocaleString()}\n\n` +
                `🎉 **Early Payoff Discount:** UGX ${result.early_payoff_discount.toLocaleString()}\n` +
                `✨ **Discounted Total:** UGX ${result.discounted_payoff.toLocaleString()}\n\n` +
                `Type "make payment ${result.discounted_payoff}" to pay off your vehicle completely!`;

        default:
            return `✅ Request completed successfully.\n\n${result.message || ''}`;
    }
}

// Legacy function for backward compatibility
async function generateBabuMotorsResponse(message) {
    try {
        const response = await answerWithRAG(message, KNOWLEDGE_BASE_PATH);
        return response;
    } catch (error) {
        console.error('Error generating response:', error);
        return "I'm sorry, I'm having trouble processing your request right now. Please try again later or contact Babu Motors Uganda directly for assistance.";
    }
}

client.on('ready', () => {
    console.log('Babu Motors WhatsApp Bot is ready!');
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('message_create', async message => {
    // Skip if message is from the bot itself
    if (message.fromMe) return;

    // For testing purposes, only reply to specific number (remove this in production)
    if (!message.from.includes('256726411562')) return;

    console.log(`Received message from ${message.from}: ${message.body}`);

    // Handle ping command for testing
    if (message.body === '!ping') {
        const userId = message.from.split('@')[0].replace(/[^\d]/g, '');
        const conversationStatus = getConversationStatus(userId);
        const activeCount = getActiveConversationsCount();

        await client.sendMessage(message.from,
            `pong - Babu Motors Bot is active! 🚗\n\n` +
            `💬 Your conversation: ${conversationStatus.hasActiveConversation ? 'Active' : 'New'}\n` +
            `📊 Total active conversations: ${activeCount}`
        );
        return;
    }

    // Handle clear conversation command
    if (message.body === '!clear') {
        const userId = message.from.split('@')[0].replace(/[^\d]/g, '');
        const cleared = clearUserConversation(userId);
        const statusMessage = cleared ?
            `✅ Your conversation history has been cleared. Starting fresh!` :
            `ℹ️ No active conversation found to clear.`;

        await client.sendMessage(message.from, statusMessage);
        return;
    }

    // Extract customer phone number from WhatsApp ID
    const customerPhone = message.from.split('@')[0];
    const userId = customerPhone.replace(/[^\d]/g, '');

    try {
        // Log conversation status before processing
        const conversationStatus = getConversationStatus(userId);
        console.log(`👤 User ${userId} conversation status:`, conversationStatus);

        // Enhanced conversation logging
        if (conversationStatus.hasActiveConversation) {
            console.log(`📚 Continuing conversation - Message count: ${conversationStatus.messageCount}`);
        } else {
            console.log(`🆕 New conversation starting for user ${userId}`);
        }

        // Use the enhanced response system that handles both RAG and function calling
        const response = await generateResponse(message.body, customerPhone);

        // Send response
        await client.sendMessage(message.from, response);

        // Log conversation status after processing
        const newStatus = getConversationStatus(userId);
        console.log(`📊 After processing - Active conversations: ${getActiveConversationsCount()}`);
        if (newStatus.hasActiveConversation) {
            console.log(`💾 Updated conversation for user ${userId}: ${newStatus.messageCount} messages`);
        }

        // Clear typing indicator
        // await client.sendPresenceUpdate('paused', message.from);

    } catch (error) {
        console.error('Error handling message:', error);
        await client.sendMessage(message.from, "I apologize, but I'm experiencing technical difficulties. Please try again in a moment or contact Babu Motors directly at 0785 123 456.");
    }
});

client.initialize();