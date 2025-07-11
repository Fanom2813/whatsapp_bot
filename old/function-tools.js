// function-tools.js
import dotenv from 'dotenv';
dotenv.config();

// Mock database - In production, this would connect to your actual database
const mockCustomerData = {
    '256726411562': {
        customerId: 'C001',
        name: 'John Doe',
        vehicleId: 'V001',
        vehiclePlate: 'UBJ 123A',
        totalAmount: 15600000, // UGX 15.6M
        paidAmount: 8400000,   // UGX 8.4M
        weeklyPayment: 300000,  // UGX 300K
        lastPaymentDate: '2025-07-05',
        nextPaymentDue: '2025-07-12',
        arrears: 0,
        penalties: 0,
        lastInspection: '2025-04-15',
        nextInspection: '2025-07-15',
        vehicleStatus: 'active',
        paymentHistory: [
            { date: '2025-07-05', amount: 300000, type: 'weekly_payment' },
            { date: '2025-06-28', amount: 300000, type: 'weekly_payment' },
            { date: '2025-06-21', amount: 300000, type: 'weekly_payment' }
        ]
    }
};

// Function definitions for OpenAI function calling
export const functionDefinitions = [
    {
        name: "get_help_menu",
        description: "Show available commands and help information",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    },
    {
        name: "check_account_balance",
        description: "Check customer's account balance, payment status, and arrears",
        parameters: {
            type: "object",
            properties: {
                phone_number: {
                    type: "string",
                    description: "Customer's phone number"
                }
            },
            required: ["phone_number"]
        }
    },
    {
        name: "initiate_payment",
        description: "Initiate a payment for the customer using mobile money",
        parameters: {
            type: "object",
            properties: {
                phone_number: {
                    type: "string",
                    description: "Customer's phone number"
                },
                amount: {
                    type: "number",
                    description: "Payment amount in UGX"
                },
                payment_method: {
                    type: "string",
                    enum: ["mtn_momo", "airtel_money", "bank_transfer"],
                    description: "Preferred payment method"
                }
            },
            required: ["phone_number", "amount", "payment_method"]
        }
    },
    {
        name: "check_vehicle_status",
        description: "Check vehicle status, GPS location, and inspection schedule",
        parameters: {
            type: "object",
            properties: {
                phone_number: {
                    type: "string",
                    description: "Customer's phone number"
                }
            },
            required: ["phone_number"]
        }
    },
    {
        name: "schedule_inspection",
        description: "Schedule a vehicle inspection appointment",
        parameters: {
            type: "object",
            properties: {
                phone_number: {
                    type: "string",
                    description: "Customer's phone number"
                },
                preferred_date: {
                    type: "string",
                    description: "Preferred inspection date (YYYY-MM-DD format)"
                },
                preferred_time: {
                    type: "string",
                    description: "Preferred time (e.g., '10:00 AM', '2:30 PM')"
                }
            },
            required: ["phone_number", "preferred_date", "preferred_time"]
        }
    },
    {
        name: "get_payment_history",
        description: "Retrieve customer's payment history and transaction details",
        parameters: {
            type: "object",
            properties: {
                phone_number: {
                    type: "string",
                    description: "Customer's phone number"
                },
                limit: {
                    type: "number",
                    description: "Number of recent transactions to retrieve (default: 10)"
                }
            },
            required: ["phone_number"]
        }
    },
    {
        name: "calculate_payoff_amount",
        description: "Calculate the total amount needed to pay off the vehicle completely",
        parameters: {
            type: "object",
            properties: {
                phone_number: {
                    type: "string",
                    description: "Customer's phone number"
                }
            },
            required: ["phone_number"]
        }
    }
];

// Function implementations
export const functionImplementations = {
    check_account_balance: async (args) => {
        const { phone_number } = args;
        const customer = mockCustomerData[phone_number];

        if (!customer) {
            return {
                success: false,
                message: "Customer not found. Please contact Babu Motors for assistance."
            };
        }

        const remainingAmount = customer.totalAmount - customer.paidAmount;
        const progressPercentage = ((customer.paidAmount / customer.totalAmount) * 100).toFixed(1);

        // Calculate days since last payment
        const lastPayment = new Date(customer.lastPaymentDate);
        const today = new Date();
        const daysSincePayment = Math.floor((today - lastPayment) / (1000 * 60 * 60 * 24));

        // Calculate if there are arrears (more than 7 days since last payment)
        let currentArrears = 0;
        let currentPenalties = 0;

        if (daysSincePayment > 7) {
            const weeksOverdue = Math.floor(daysSincePayment / 7);
            currentArrears = weeksOverdue * customer.weeklyPayment;
            currentPenalties = currentArrears * 0.005 * weeksOverdue; // 0.5% per week
        }

        return {
            success: true,
            customer_name: customer.name,
            vehicle_plate: customer.vehiclePlate,
            total_amount: customer.totalAmount,
            paid_amount: customer.paidAmount,
            remaining_amount: remainingAmount,
            progress_percentage: progressPercentage,
            weekly_payment: customer.weeklyPayment,
            last_payment_date: customer.lastPaymentDate,
            next_payment_due: customer.nextPaymentDue,
            days_since_payment: daysSincePayment,
            current_arrears: currentArrears,
            current_penalties: currentPenalties,
            account_status: currentArrears > 0 ? 'overdue' : 'current'
        };
    },

    initiate_payment: async (args) => {
        const { phone_number, amount, payment_method } = args;
        const customer = mockCustomerData[phone_number];

        if (!customer) {
            return {
                success: false,
                message: "Customer not found. Please contact Babu Motors for assistance."
            };
        }

        // In production, this would integrate with actual payment APIs
        const paymentReference = `BM${Date.now()}`;

        // Simulate payment processing
        const paymentInstructions = {
            mtn_momo: `*165*3*${amount}*256785123456#`,
            airtel_money: `*185*9*${amount}*256785123456#`,
            bank_transfer: "Account: Babu Motors Ltd\nBank: Stanbic Bank\nAccount No: 9030012345678"
        };

        return {
            success: true,
            payment_reference: paymentReference,
            amount: amount,
            payment_method: payment_method,
            instructions: paymentInstructions[payment_method],
            message: `Payment of UGX ${amount.toLocaleString()} initiated. Reference: ${paymentReference}. Please complete the payment using the provided instructions.`,
            expected_completion: "5-10 minutes"
        };
    },

    check_vehicle_status: async (args) => {
        const { phone_number } = args;
        const customer = mockCustomerData[phone_number];

        if (!customer) {
            return {
                success: false,
                message: "Customer not found. Please contact Babu Motors for assistance."
            };
        }

        // Calculate days until next inspection
        const nextInspection = new Date(customer.nextInspection);
        const today = new Date();
        const daysUntilInspection = Math.ceil((nextInspection - today) / (1000 * 60 * 60 * 24));

        return {
            success: true,
            vehicle_plate: customer.vehiclePlate,
            vehicle_id: customer.vehicleId,
            status: customer.vehicleStatus,
            last_inspection: customer.lastInspection,
            next_inspection: customer.nextInspection,
            days_until_inspection: daysUntilInspection,
            inspection_status: daysUntilInspection > 0 ? 'current' : 'overdue',
            gps_status: 'active',
            location_last_updated: new Date().toISOString().split('T')[0]
        };
    },

    schedule_inspection: async (args) => {
        const { phone_number, preferred_date, preferred_time } = args;
        const customer = mockCustomerData[phone_number];

        if (!customer) {
            return {
                success: false,
                message: "Customer not found. Please contact Babu Motors for assistance."
            };
        }

        // In production, this would check actual availability and book the appointment
        const appointmentId = `INSP${Date.now()}`;

        return {
            success: true,
            appointment_id: appointmentId,
            scheduled_date: preferred_date,
            scheduled_time: preferred_time,
            location: "Babu Motors, Ntinda - Kampala",
            contact: "0785 123 456",
            message: `Inspection scheduled for ${preferred_date} at ${preferred_time}. Appointment ID: ${appointmentId}. Please bring your vehicle to our Ntinda location.`,
            reminder: "You will receive a reminder SMS 24 hours before your appointment."
        };
    },

    get_payment_history: async (args) => {
        const { phone_number, limit = 10 } = args;
        const customer = mockCustomerData[phone_number];

        if (!customer) {
            return {
                success: false,
                message: "Customer not found. Please contact Babu Motors for assistance."
            };
        }

        const recentPayments = customer.paymentHistory.slice(0, limit);
        const totalPaid = recentPayments.reduce((sum, payment) => sum + payment.amount, 0);

        return {
            success: true,
            customer_name: customer.name,
            vehicle_plate: customer.vehiclePlate,
            recent_payments: recentPayments,
            total_in_period: totalPaid,
            total_all_time: customer.paidAmount,
            message: `Here are your last ${recentPayments.length} payment(s).`
        };
    },

    calculate_payoff_amount: async (args) => {
        const { phone_number } = args;
        const customer = mockCustomerData[phone_number];

        if (!customer) {
            return {
                success: false,
                message: "Customer not found. Please contact Babu Motors for assistance."
            };
        }

        const remainingAmount = customer.totalAmount - customer.paidAmount;

        // Calculate any outstanding arrears and penalties
        const lastPayment = new Date(customer.lastPaymentDate);
        const today = new Date();
        const daysSincePayment = Math.floor((today - lastPayment) / (1000 * 60 * 60 * 24));

        let arrears = 0;
        let penalties = 0;

        if (daysSincePayment > 7) {
            const weeksOverdue = Math.floor(daysSincePayment / 7);
            arrears = weeksOverdue * customer.weeklyPayment;
            penalties = arrears * 0.005 * weeksOverdue;
        }

        const totalPayoffAmount = remainingAmount + arrears + penalties;
        const savings = remainingAmount * 0.05; // 5% early payoff discount

        return {
            success: true,
            remaining_principal: remainingAmount,
            current_arrears: arrears,
            current_penalties: penalties,
            total_payoff_amount: totalPayoffAmount,
            early_payoff_discount: savings,
            discounted_payoff: totalPayoffAmount - savings,
            message: `Your total payoff amount is UGX ${totalPayoffAmount.toLocaleString()}. With early payoff discount: UGX ${(totalPayoffAmount - savings).toLocaleString()}`
        };
    },

    get_help_menu: async () => {
        return {
            success: true,
            menu: `🚗 **BABU MOTORS - AVAILABLE SERVICES**

📊 **Account Management:**
• "check balance" - View account balance and payment status
• "payment history" - See recent payment transactions
• "calculate payoff" - Get total amount to own vehicle

💳 **Payments:**
• "make payment" - Initiate mobile money payment
• "pay [amount]" - Quick payment (e.g., "pay 300000")

🚗 **Vehicle Services:**
• "vehicle status" - Check vehicle and GPS status
• "schedule inspection" - Book inspection appointment

💬 **General Help:**
• "help" - Show this menu
• Ask any questions about your lease agreement

Need immediate assistance? Call: 0785 123 456`
        };
    }
};

// Helper function to execute functions
export async function executeFunctionCall(functionName, args) {
    if (functionImplementations[functionName]) {
        try {
            return await functionImplementations[functionName](args);
        } catch (error) {
            console.error(`Error executing function ${functionName}:`, error);
            return {
                success: false,
                message: "An error occurred while processing your request. Please try again or contact support."
            };
        }
    } else {
        return {
            success: false,
            message: "Function not found."
        };
    }
}
