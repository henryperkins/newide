// Main application logic

import { modelManager } from './models.js';
import { displayManager } from './ui/displayManager.js';
import { notificationManager } from './ui/notificationManager.js';
import { markdownParser } from './ui/markdownParser.js';
import { fileManager } from './fileManager.js';

class ChatApplication {
    constructor() {
        this.sessionId = null;
        this.userInput = document.getElementById('user-input');
        this.sendButton = document.getElementById('send-button');
        this.chatHistory = document.getElementById('chat-history');
        this.isProcessing = false;

        this.init();
    }

    async init() {
        try {
            // Initialize session
            const response = await fetch('/api/session/create', {
                method: 'POST'
            });
            const data = await response.json();
            this.sessionId = data.session_id;

            // Set up event listeners
            this.setupEventListeners();
            
            // Initialize file handling
            await fileManager.init(this.sessionId);

            // Initial model capabilities check
            await this.checkModelCapabilities();
        } catch (error) {
            console.error('Initialization error:', error);
            notificationManager.showError('Failed to initialize chat application');
        }
    }

    setupEventListeners() {
        // Send message on button click
        this.sendButton.addEventListener('click', () => this.sendMessage());

        // Send message on Enter (but new line on Shift+Enter)
        this.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Auto-resize textarea
        this.userInput.addEventListener('input', () => {
            this.userInput.style.height = 'auto';
            this.userInput.style.height = this.userInput.scrollHeight + 'px';
        });

        // Handle model changes
        window.addEventListener('modelChanged', async (e) => {
            await this.checkModelCapabilities();
        });
    }

    async checkModelCapabilities() {
        const capabilities = await modelManager.getModelCapabilities();
        if (capabilities) {
            // Update UI based on model capabilities
            const streamToggle = document.querySelector('.stream-toggle input');
            if (streamToggle) {
                streamToggle.disabled = !capabilities.capabilities.supports_streaming;
                if (!capabilities.capabilities.supports_streaming) {
                    streamToggle.checked = false;
                }
            }
        }
    }

    async sendMessage() {
        if (this.isProcessing || !this.userInput.value.trim()) return;

        try {
            this.isProcessing = true;
            this.sendButton.disabled = true;

            const message = this.userInput.value.trim();
            this.userInput.value = '';
            this.userInput.style.height = 'auto';

            // Add user message to display
            displayManager.addMessage('user', message);

            // Get current model and settings
            const currentModel = modelManager.currentModel;
            const useStreaming = document.querySelector('.stream-toggle input')?.checked && 
                               MODEL_CONFIGS[currentModel].features.streaming;
            
            // Prepare request parameters
            const params = {
                message,
                session_id: this.sessionId,
                model: currentModel,
                include_files: fileManager.hasFiles(),
                use_file_search: document.getElementById('azure-search')?.checked || false
            };

            if (MODEL_CONFIGS[currentModel].features.reasoning) {
                const reasoningSlider = document.getElementById('reasoning-effort-slider');
                if (reasoningSlider) {
                    const efforts = ['low', 'medium', 'high'];
                    params.reasoning_effort = efforts[reasoningSlider.value - 1];
                }
            }

            if (useStreaming) {
                await this.handleStreamingResponse(params);
            } else {
                await this.handleStandardResponse(params);
            }

        } catch (error) {
            console.error('Error sending message:', error);
            notificationManager.showError('Failed to send message');
        } finally {
            this.isProcessing = false;
            this.sendButton.disabled = false;
        }
    }

    async handleStreamingResponse(params) {
        try {
            const response = await fetch('/api/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });

            if (!response.ok) throw new Error('Stream request failed');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedResponse = '';
            
            displayManager.startNewMessage('assistant');

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.choices && data.choices[0]?.delta?.content) {
                                const content = data.choices[0].delta.content;
                                accumulatedResponse += content;
                                displayManager.appendToLastMessage(content);
                            }
                        } catch (e) {
                            console.error('Error parsing SSE data:', e);
                        }
                    }
                }
            }

            // Update token counts if available in the last chunk
            if (accumulatedResponse) {
                const lastChunk = JSON.parse(accumulatedResponse);
                if (lastChunk.usage) {
                    modelManager.updateTokenCounts(lastChunk.usage);
                }
            }

        } catch (error) {
            console.error('Streaming error:', error);
            notificationManager.showError('Error during streaming response');
        }
    }

    async handleStandardResponse(params) {
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-version': '2024-05-01-preview'
                },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: params.message }],
                    model: params.model,
                    session_id: params.session_id,
                    reasoning_effort: params.reasoning_effort,
                    include_files: params.include_files,
                    use_file_search: params.use_file_search
                })
            });

            if (!response.ok) throw new Error('Request failed');

            const data = await response.json();
            const content = data.choices[0].message.content;

            displayManager.addMessage('assistant', content);
            
            // Update token counts
            if (data.usage) {
                modelManager.updateTokenCounts(data.usage);
            }

        } catch (error) {
            console.error('Standard response error:', error);
            notificationManager.showError('Error getting response');
        }
    }
}

// Initialize the application when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatApplication();
});
