import { askWithFile } from './assistants-helper.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function simpleExample() {
    try {
        console.log('🧪 Simple example: Asking about Babu Motors...\n');

        const dataFilePath = path.join(__dirname, 'data.md');
        const question = "What are the weekly payment options in the Drive to Own program?";

        const assistantConfig = {
            name: "Babu Motors Helper",
            instructions: `You are Babu, a helpful assistant for Babu Motors Uganda Limited. 
            Use the uploaded documentation to provide accurate information about the Drive to Own program.
            Be professional and helpful in your responses.`
        };

        console.log(`❓ Question: ${question}`);
        console.log('⏳ Getting response...\n');

        const response = await askWithFile(
            dataFilePath,
            question,
            process.env.OPENAI_API_KEY,
            assistantConfig
        );

        console.log('💬 Response:');
        console.log(response);

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

// Run the example
simpleExample();
