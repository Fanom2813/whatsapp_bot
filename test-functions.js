// test-functions.js - Test script for function calling
import { functionDefinitions, executeFunctionCall } from './function-tools.js';
import dotenv from 'dotenv';

dotenv.config();

async function testFunctions() {
    console.log('🧪 Testing Babu Motors Function Calling System\n');

    const testPhone = '256726411562';

    // Test 1: Check Balance
    console.log('1️⃣ Testing check_account_balance...');
    const balanceResult = await executeFunctionCall('check_account_balance', { phone_number: testPhone });
    console.log('✅ Balance check:', balanceResult.success ? 'PASSED' : 'FAILED');
    if (balanceResult.success) {
        console.log(`   Customer: ${balanceResult.customer_name}`);
        console.log(`   Progress: ${balanceResult.progress_percentage}%`);
    }
    console.log();

    // Test 2: Vehicle Status
    console.log('2️⃣ Testing check_vehicle_status...');
    const vehicleResult = await executeFunctionCall('check_vehicle_status', { phone_number: testPhone });
    console.log('✅ Vehicle status:', vehicleResult.success ? 'PASSED' : 'FAILED');
    if (vehicleResult.success) {
        console.log(`   Vehicle: ${vehicleResult.vehicle_plate}`);
        console.log(`   Status: ${vehicleResult.status}`);
    }
    console.log();

    // Test 3: Payment History
    console.log('3️⃣ Testing get_payment_history...');
    const historyResult = await executeFunctionCall('get_payment_history', { phone_number: testPhone, limit: 3 });
    console.log('✅ Payment history:', historyResult.success ? 'PASSED' : 'FAILED');
    if (historyResult.success) {
        console.log(`   Recent payments: ${historyResult.recent_payments.length}`);
    }
    console.log();

    // Test 4: Payment Initiation
    console.log('4️⃣ Testing initiate_payment...');
    const paymentResult = await executeFunctionCall('initiate_payment', {
        phone_number: testPhone,
        amount: 300000,
        payment_method: 'mtn_momo'
    });
    console.log('✅ Payment initiation:', paymentResult.success ? 'PASSED' : 'FAILED');
    if (paymentResult.success) {
        console.log(`   Reference: ${paymentResult.payment_reference}`);
    }
    console.log();

    // Test 5: Help Menu
    console.log('5️⃣ Testing get_help_menu...');
    const helpResult = await executeFunctionCall('get_help_menu', {});
    console.log('✅ Help menu:', helpResult.success ? 'PASSED' : 'FAILED');
    console.log();

    console.log('🎉 All function tests completed!');
    console.log('\n📋 Available Functions:');
    functionDefinitions.forEach((func, index) => {
        console.log(`   ${index + 1}. ${func.name} - ${func.description}`);
    });
}

// Run tests
testFunctions().catch(console.error);
