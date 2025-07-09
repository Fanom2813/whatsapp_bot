import OpenAI from 'openai';
import fs from 'fs';

/**
 * Helper class for OpenAI Assistants API with file search capability
 */
export class AssistantWithFileSearch {
    constructor(apiKey) {
        this.openai = new OpenAI({ apiKey });
        this.assistant = null;
        this.uploadedFiles = [];
    }

    /**
     * Upload a file for assistant use
     * @param {string} filePath - Path to the file to upload
     * @returns {Promise<Object>} File object
     */
    async uploadFile(filePath) {
        try {
            const file = await this.openai.files.create({
                file: fs.createReadStream(filePath),
                purpose: "assistants",
            });

            this.uploadedFiles.push(file);
            console.log(`✅ File uploaded: ${file.id}`);
            return file;
        } catch (error) {
            console.error('❌ Error uploading file:', error);
            throw error;
        }
    }

    /**
     * Create an assistant with file search capability
     * @param {Object} config - Assistant configuration
     * @returns {Promise<Object>} Assistant object
     */
    async createAssistant(config) {
        try {
            const {
                name,
                instructions,
                model = "gpt-4o",
                fileIds = []
            } = config;

            this.assistant = await this.openai.beta.assistants.create({
                name,
                instructions,
                model,
                tools: [{ type: "file_search" }],
                tool_resources: {
                    file_search: {
                        vector_stores: fileIds.length > 0 ? [{
                            file_ids: fileIds
                        }] : []
                    }
                }
            });

            console.log(`✅ Assistant created: ${this.assistant.id}`);
            return this.assistant;
        } catch (error) {
            console.error('❌ Error creating assistant:', error);
            throw error;
        }
    }

    /**
     * Create a thread for conversation
     * @returns {Promise<Object>} Thread object
     */
    async createThread() {
        try {
            const thread = await this.openai.beta.threads.create({
                tool_resources: {
                    file_search: {
                        vector_store_ids: [], // Will use assistant's vector store
                    }
                }
            });

            console.log(`✅ Thread created: ${thread.id}`);
            return thread;
        } catch (error) {
            console.error('❌ Error creating thread:', error);
            throw error;
        }
    }

    /**
     * Send a message and get response
     * @param {string} threadId - Thread ID
     * @param {string} message - User message
     * @returns {Promise<string>} Assistant response
     */
    async sendMessage(threadId, message) {
        try {
            if (!this.assistant) {
                throw new Error('Assistant not created. Call createAssistant() first.');
            }

            // Add user message
            await this.openai.beta.threads.messages.create(threadId, {
                role: "user",
                content: message
            });

            // Run the assistant
            const run = await this.openai.beta.threads.runs.create(threadId, {
                assistant_id: this.assistant.id,
            });

            // Wait for completion
            let runStatus = await this.openai.beta.threads.runs.retrieve(threadId, run.id);
            while (runStatus.status !== "completed" && runStatus.status !== "failed" && runStatus.status !== "cancelled") {
                await new Promise(resolve => setTimeout(resolve, 1000));
                runStatus = await this.openai.beta.threads.runs.retrieve(threadId, run.id);
            }

            if (runStatus.status === "failed") {
                throw new Error(`Run failed: ${runStatus.last_error?.message}`);
            }

            if (runStatus.status === "cancelled") {
                throw new Error('Run was cancelled');
            }

            // Get the latest assistant message
            const messages = await this.openai.beta.threads.messages.list(threadId, {
                limit: 1,
                order: 'desc'
            });

            const assistantMessage = messages.data[0];
            if (assistantMessage.role !== 'assistant') {
                throw new Error('Expected assistant message');
            }

            const textContent = assistantMessage.content.find(content => content.type === 'text');
            return textContent ? textContent.text.value : "No response generated.";

        } catch (error) {
            console.error('❌ Error sending message:', error);
            throw error;
        }
    }

    /**
     * Convenient method to ask a question with a file
     * @param {string} filePath - Path to the knowledge file
     * @param {string} question - Question to ask
     * @param {Object} assistantConfig - Assistant configuration
     * @returns {Promise<string>} Assistant response
     */
    async askWithFile(filePath, question, assistantConfig) {
        try {
            // Upload file
            const file = await this.uploadFile(filePath);

            // Create assistant
            const config = {
                ...assistantConfig,
                fileIds: [file.id]
            };
            await this.createAssistant(config);

            // Create thread
            const thread = await this.createThread();

            // Send message and get response
            const response = await this.sendMessage(thread.id, question);

            return response;
        } catch (error) {
            console.error('❌ Error in askWithFile:', error);
            throw error;
        }
    }

    /**
     * Clean up resources
     */
    async cleanup() {
        try {
            // Delete assistant
            if (this.assistant) {
                await this.openai.beta.assistants.del(this.assistant.id);
                console.log('🗑️ Assistant deleted');
            }

            // Delete uploaded files
            for (const file of this.uploadedFiles) {
                await this.openai.files.del(file.id);
                console.log(`🗑️ File deleted: ${file.id}`);
            }

            this.assistant = null;
            this.uploadedFiles = [];
        } catch (error) {
            console.error('❌ Error during cleanup:', error);
        }
    }
}

/**
 * Simple helper function for one-off questions
 * @param {string} filePath - Path to the knowledge file
 * @param {string} question - Question to ask
 * @param {string} apiKey - OpenAI API key
 * @param {Object} assistantConfig - Assistant configuration
 * @returns {Promise<string>} Assistant response
 */
export async function askWithFile(filePath, question, apiKey, assistantConfig = {}) {
    const helper = new AssistantWithFileSearch(apiKey);

    try {
        const defaultConfig = {
            name: "File Search Assistant",
            instructions: "You are a helpful assistant that uses uploaded documents to answer questions.",
            model: "gpt-4o"
        };

        const config = { ...defaultConfig, ...assistantConfig };
        const response = await helper.askWithFile(filePath, question, config);

        return response;
    } finally {
        await helper.cleanup();
    }
}
