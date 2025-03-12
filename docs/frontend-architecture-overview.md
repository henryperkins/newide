# Frontend Architecture Overview

This document provides an overview of how the frontend components in the codebase map to the architecture diagram.

## Architecture Components

Based on the mermaid diagram, the frontend architecture consists of the following key elements:

### Frontend Layer
- **User Input**: Handling user message entry
- **Chat Interface**: Main UI for displaying conversations
- **Streaming Renderer**: Real-time rendering of model responses
- **Conversation Manager**: Managing chat history and session state

### API Layer
- **Chat Router**: Handles chat requests
- **Session Router**: Manages user sessions
- **Security Router**: Authentication and authorization
- **Config Router**: Application configuration

### Services Layer
- **Chat Service**: Core chat logic
- **Model Stats Service**: Tracking model usage
- **Config Service**: Managing application settings
- **Session Manager**: Session state management
- **Client Pool**: Interface to external AI models

### External Services
- **Azure OpenAI**: For DeepSeek and standard models
- **Azure AI Inference**: For O1/O3 models

## Code Implementation

The current codebase implements these architectural components across several files:

### Core System Files

#### `init.js` - Application Initialization
- **Entry Point** for the entire frontend application
- Orchestrates initialization of all components in the correct order
- Ensures a valid session exists before initializing other components
- Initializes UI components, event listeners, and theme settings
- Sets up error handling and fallback UI for graceful degradation
- Manages mobile/desktop specific features through responsive design

#### `config.js` - Configuration Management
- Implements the **Config Service** component from the architecture
- Manages application-wide settings (model selection, reasoning effort, etc.)
- Handles communication with the Config Router in the API layer
- Provides model-specific configuration and capabilities detection
- Updates UI elements based on selected model capabilities
- Persists configuration to both localStorage and server

#### `session.js` - Session Management
- Implements the **Session Manager** component from the architecture
- Handles session creation, validation, and retrieval
- Provides automatic recovery for invalid sessions
- Communicates with the Session Router in the API layer
- Manages conversation state persistence
- Handles authentication state through session tokens

#### `fileManager.js` - File Context Management
- Manages file uploads and processing for context enrichment
- Handles file validation, storage, and organization
- Provides token estimation for uploaded files
- Implements drag-and-drop and click-to-upload interfaces
- Supports various file types (text, PDF, DOCX, etc.)
- Integrates with Azure Search for document processing
- Tracks and displays file statistics (count, size, estimated tokens)

### Frontend Layer Components

- `chat.js`: Implements the **Chat Interface** and **User Input** components
  - Handles user message submission
  - Manages the chat UI and streaming/non-streaming responses
  - Configures model parameters based on selected model

- `streaming.js`: Connects to the streaming API endpoints
  - Implements Server-Sent Events (SSE) connection handling
  - Processes incoming stream chunks

- `ui/streamRenderer.js`: Implements the **Streaming Renderer** component
  - Efficiently renders streaming content with minimal DOM updates
  - Handles incremental rendering of message content
  - Manages rendering chain-of-thought content

- `ui/deepseekProcessor.js`: Specialized processing for DeepSeek model responses
  - Processes chunk data from DeepSeek models
  - Extracts and separates main content from chain-of-thought content
  - Handles `<think>` tags and renders "Chain of Thought" UI elements
  - Provides markdown rendering for thinking blocks
  - Implements toggle functionality for showing/hiding thinking content

- `ui/conversationManager.js`: Implements the **Conversation Manager**
  - Manages conversation history and persistence
  - Handles creating, loading, and deleting conversations
  - Provides UI for browsing, searching, and filtering conversations
  - Implements conversation pinning and archiving functionality

- `ui/sidebarManager.js`: Controls sidebar UI and navigation
  - Manages sidebar visibility and state
  - Handles responsive layout adjustments for mobile/desktop
  - Provides toggle functionality for both settings and conversation sidebars
  - Implements touch and keyboard accessibility features

- `ui/notificationManager.js`: Handles UI notifications and error display
  - Implements various notification types (info, success, warning, error)
  - Provides error handling with appropriate user feedback
  - Manages typing indicators and loading states
  - Implements modal dialogs for confirmations and error details
  - Handles error classification and recovery suggestions

- `ui/statsDisplay.js`: Tracks and displays performance metrics
  - Implements the **Model Stats Service** component from the architecture
  - Tracks performance metrics (latency, tokens per second, etc.)
  - Monitors token usage (prompt, completion, reasoning tokens)
  - Provides real-time statistics during model inference
  - Supports throttled UI updates for better performance
  - Integrates with mobile UI for consistent stats across viewports

- `ui/tabManager.js`: Manages tab-based UI navigation
  - Provides tab-switching functionality with accessibility support
  - Handles responsive design for mobile/desktop views
  - Manages tab content visibility and state
  - Implements keyboard navigation between tabs
  - Ensures proper focus management for accessibility

### Services Layer Components

- `models.js`: Contains the `ModelManager` class that implements the **Client Pool**
  - Manages model configurations for different AI models
  - Handles switching between models
  - Communicates with external API endpoints
  - Determines which model/endpoint to use based on requested model type
  - Handles model-specific parameters and capabilities

- `utils/modelUtils.js`: Support for model-specific configurations
  - Provides default configurations for different AI models
  - Determines model capabilities based on model type
  - Configures appropriate API versions and endpoints

## Key Integration Points

1. **Application Lifecycle**:
   - `init.js` bootstraps the application
   - Initializes all components in the correct order
   - Ensures models, configuration, and UI components are ready
   - Sets up event listeners and handles session initialization

2. **Chat Flow**:
   - User input is captured in `chat.js`
   - Requests are sent to the backend via the API layer
   - Responses are processed by `streaming.js` or directly handled by `chat.js`
   - Content is rendered using `streamRenderer.js` or `deepseekProcessor.js`
   - Notifications for errors or important events via `notificationManager.js`
   - Performance statistics tracked and displayed by `statsDisplay.js`

3. **Model Selection**:
   - The `modelManager` in `models.js` acts as the **Client Pool** from the architecture diagram
   - `config.js` manages the model configuration and capabilities
   - Together they determine which model to use (DeepSeek-R1, O1, etc.)
   - Configure the appropriate API endpoint (Azure OpenAI or Azure AI Inference)
   - Set model-specific parameters (reasoning effort, temperature, etc.)

4. **Session and Conversation Management**:
   - `session.js` provides the core session management functionality
   - It validates, creates, and maintains the user's session
   - `conversationManager.js` implements the conversation persistence
   - Handles creating, loading, and deleting conversations
   - Communicates with the Session Router to maintain state
   - The sidebar UI is managed by `sidebarManager.js` for user navigation
   - Tab navigation is handled by `tabManager.js` for UI organization

5. **File Context Processing**:
   - `fileManager.js` handles file uploads and organization
   - Provides file context to enhance AI responses
   - Estimates token usage for context awareness
   - Integrates with Azure Search for advanced document processing
   - Manages file lifecycle (upload, validation, removal)

6. **Error Handling and User Feedback**:
   - `notificationManager.js` provides consistent error handling and user feedback
   - Classifies errors and suggests appropriate actions
   - Maintains UI state during interactions via typing indicators
   - Prevents duplicate notifications and error messages
   - Recovers gracefully from network or API errors

## How Data Flows

1. User enters a message in the chat interface (`chat.js`)
2. If file context is needed, `fileManager.js` provides the necessary file information
3. The message is sent to the backend through the Chat Router
4. `session.js` ensures a valid session exists for the request
5. The Chat Service determines which model to use via the Client Pool (`models.js`) and configuration (`config.js`)
6. The request is forwarded to the appropriate external service (Azure OpenAI or Azure AI Inference)
7. The response streams back through the API layer
8. For DeepSeek models, `deepseekProcessor.js` handles the chain-of-thought processing
9. The Streaming Renderer (`streamRenderer.js`) displays the response in real-time
10. Performance statistics are captured and displayed by `statsDisplay.js`
11. The Conversation Manager (`conversationManager.js`) persists the conversation to the database
12. Any errors or important notifications are presented to the user through `notificationManager.js`

This architecture ensures a clean separation of concerns where:
- UI components handle user interaction and rendering
- API layer manages communication with the backend
- Services coordinate business logic and external service integration