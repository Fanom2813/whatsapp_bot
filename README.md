# Babu Motors WhatsApp Bot with Function Calling

A sophisticated WhatsApp bot for Babu Motors Uganda that combines RAG (Retrieval-Augmented Generation) with OpenAI function calling to provide customers with both general information and account-specific services.

## Features

### 🤖 Dual Response System
- **RAG System**: Answers general questions about Babu Motors, policies, and procedures using the knowledge base
- **Function Calling**: Handles account-specific requests like balance checks, payments, and vehicle status

### 🛠️ Available Functions

1. **Account Management**
   - `check_account_balance` - View balance, payment status, and arrears
   - `get_payment_history` - Recent payment transactions
   - `calculate_payoff_amount` - Total amount to own vehicle

2. **Payment Services**
   - `initiate_payment` - Start mobile money payments (MTN MoMo, Airtel Money)
   - Support for custom payment amounts

3. **Vehicle Services**
   - `check_vehicle_status` - Vehicle status, GPS, and inspection schedule
   - `schedule_inspection` - Book inspection appointments

4. **Help & Support**
   - `get_help_menu` - Show available commands

## Setup

### 1. Environment Variables
Create a `.env` file with:
```
OPENAI_API_KEY=your_openrouter_api_key
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run the Bot
```bash
npm start
```

### 4. Test Functions (Optional)
```bash
node test-functions.js
```

## Usage Examples

### Customer Queries

**General Information (RAG):**
- "What is the weekly payment amount?"
- "How does the Drive-to-Own model work?"
- "What happens if I miss a payment?"

**Account Specific (Function Calling):**
- "check my balance"
- "make payment"
- "pay 300000"
- "vehicle status"
- "schedule inspection"
- "payment history"
- "help"

## Bot Intelligence

The bot automatically determines whether to use:
- **RAG System** for general knowledge queries
- **Function Calling** for account-specific requests

Keywords that trigger function calling:
- balance, payment, pay, amount, owe, debt, arrears
- inspection, schedule, appointment, vehicle status
- history, payoff, settlement, help, menu

## Mock Data

The bot currently uses mock customer data for testing. In production, replace the `mockCustomerData` in `function-tools.js` with actual database connections.

## Files Structure

- `main.js` - Main WhatsApp bot with dual response system
- `function-tools.js` - Function definitions and implementations
- `rag-system.js` - RAG system for general knowledge queries
- `babu_motors_knowledge.md` - Knowledge base
- `test-functions.js` - Function testing script

## Production Considerations

1. **Database Integration**: Replace mock data with real database connections
2. **Payment Gateway**: Integrate with actual mobile money APIs
3. **Authentication**: Add proper customer authentication
4. **Error Handling**: Enhanced error handling and logging
5. **Rate Limiting**: Implement rate limiting for API calls
6. **Security**: Add input validation and sanitization

## Example Responses

### Balance Check
```
💰 ACCOUNT BALANCE - John Doe
🚗 Vehicle: UBJ 123A

📊 Payment Progress: 53.8%
💵 Total Amount: UGX 15,600,000
✅ Paid: UGX 8,400,000
⏳ Remaining: UGX 7,200,000

📅 Payment Schedule:
• Weekly Payment: UGX 300,000
• Last Payment: 2025-07-05
• Next Due: 2025-07-12

✅ Account Status: Current

Type "make payment" to initiate a payment or "payment history" to see recent transactions.
```

### Payment Initiation
```
💳 PAYMENT INITIATED

💰 Amount: UGX 300,000
📱 Method: MTN MOMO
🔖 Reference: BM1720425600000

📝 Instructions:
*165*3*300000*256785123456#

⏱️ Expected completion: 5-10 minutes

You will receive a confirmation SMS once payment is processed.
```

## Support

For technical issues or questions:
- Email: support@babumotors.com
- Phone: 0785 123 456
