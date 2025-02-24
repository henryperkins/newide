  // init.js - Application bootstrapping and overall initialization logic

/**
 * This file organizes the core initialization steps (DOMContentLoaded, 
 * Azure config, session handling, markdown setup, UI event handlers, etc.)
 * that were originally in main.js. 
 */

import { configureMarkdown, injectMarkdownStyles } from "/static/js/ui/markdownParser.js";
import { showNotification } from "/static/js/ui/notificationManager.js";
import { initializeSession } from "/static/js/session.js";
import { initializeFileManager } from "/static/js/fileManager.js";
import { getCurrentConfig, updateConfig, updateModelSpecificUI } from "/static/js/config.js";
import { sendMessage, regenerateResponse } from "/static/js/chat.js";

/** 
 * Global stats display instance
 * (so we can reference it in other modules if needed).
 * If you prefer storing it in a separate module, do so
 * and then import here. 
 */
export let statsDisplay = null;

/**
 * Add DOMContentLoaded listener to bootstrap the app
 */
document.addEventListener("DOMContentLoaded", async () => {
    // Enforce login requirement: if no JWT token found, redirect to login
    const token = localStorage.getItem("access_token");
    if (!token) {
        window.location.href = "static/login.html";
        return;
    }

    try {
        // Initialize stats display for performance metrics
        statsDisplay = new StatsDisplay();

    // Basic markdown support
    await initializeMarkdownSupport();

    // Initialize session
    await initializeSessionHandling();
    
    if (sessionId) {
        try {
            const response = await fetch(`/api/conversations/history?session_id=${sessionId}`);
            if (response.ok) {
                const messages = await response.json();
                // For each message in the DB, call displayMessage
                for (const msg of messages) {
                    displayMessage(msg.content, msg.role);
                }
            }
        } catch (error) {
            console.error("Failed to load conversation from DB:", error);
        }
    }

    // Initialize Azure config
    await initializeAzureConfig();

    // Wire up UI event handlers
    await initializeUIEventHandlers();

    // Initialize file handling logic
    await initializeFileHandling();

    // Initialize mobile menu gestures
    initializeMobileMenuGestures();

    console.log(`Application initialized successfully at ${new Date().toISOString()}`);

    try {
        const response = await fetch("/api/conversations/sessions");
        if (!response.ok) {
            console.error("Failed to fetch conversation sessions:", response.statusText);
        } else {
            const sessions = await response.json();
            const historyPanel = document.getElementById("conversation-history-pane");
            if (historyPanel) {
                // Clear existing entries
                historyPanel.innerHTML = "";
                // Create a headline
                const headline = document.createElement("h3");
                headline.textContent = "Conversation History";
                historyPanel.appendChild(headline);

                // List each session
                sessions.forEach(sess => {
                    const sessDiv = document.createElement("div");
                    sessDiv.classList.add("session-entry");
                    sessDiv.textContent = `Session ${sess.session_id.slice(0, 8)}… (${sess.message_count} messages)`;
                    sessDiv.onclick = async () => {
                        // Clear current chat
                        const chatHistory = document.getElementById("chat-history");
                        if (chatHistory) chatHistory.innerHTML = "";

                        // Fetch that session's entire message list
                        try {
                            const convoResp = await fetch(`/api/conversations/history?session_id=${sess.session_id}`);
                            if (!convoResp.ok) {
                                console.error("Failed to load conversation messages:", convoResp.statusText);
                                return;
                            }
                            const messages = await convoResp.json();
                            messages.forEach(msg => {
                                displayMessage(msg.content, msg.role);
                            });
                        } catch (error) {
                            console.error("Error fetching conversation messages:", error);
                        }
                    };
                    historyPanel.appendChild(sessDiv);
                });
            }
        }
    } catch (error) {
        console.error("Error fetching conversation sessions:", error);
    }
  } catch (error) {
    handleApplicationError(error, "initialize");
  }
});

/**
 * Initialize Azure config with retry logic
 */
async function initializeAzureConfig(retryCount = 3, retryDelay = 1000) {
  try {
    let lastError = null;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        const response = await fetch("/api/config/", {
          headers: { Accept: "application/json" }
        });

        if (response.status === 422) {
          const errorData = await response.json();
          console.error("[initializeAzureConfig] Validation error:", errorData);
          throw new Error(
            `Config validation failed: ${errorData.detail || "Unknown validation error"}`
          );
        }
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const config = await response.json();
        console.log("[initializeAzureConfig] Config response:", config);

        // Validate required fields
        const requiredFields = {
          deploymentName: "deployment name",
          models: "model configuration",
          "azureOpenAI.apiKey": "API key"
        };

        for (const [field, label] of Object.entries(requiredFields)) {
          const value = field
            .split(".")
            .reduce((obj, key) => obj?.[key], config);
          if (!value) {
            throw new Error(`Missing ${label} in configuration`);
          }
        }

        if (!config.models?.[config.deploymentName]) {
          throw new Error(
            `No model configuration found for deployment: ${config.deploymentName}`
          );
        }

        const modelConfig = config.models[config.deploymentName];

        window.azureOpenAIConfig = {
          endpoint: modelConfig.endpoint || "https://o1models.openai.azure.com",
          apiKey: config.azureOpenAI.apiKey,
          deploymentName: config.deploymentName
        };

        console.log(
          "[initializeAzureConfig] Successfully initialized with deployment:",
          config.deploymentName
        );
        return true;
      } catch (error) {
        lastError = error;
        console.warn(
          `[initializeAzureConfig] Attempt ${attempt}/${retryCount} failed:`,
          error
        );

        // Don't retry validation errors
        if (error.message.includes("validation failed") || error.message.includes("422")) {
          break;
        }

        if (attempt < retryCount) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
        }
      }
    }
    // All attempts failed
    throw lastError || new Error("Failed to initialize Azure configuration");
  } catch (error) {
    handleInitializationError(error);
  }
}

/**
 * Provide fallback for critical initialization failure
 */
function handleInitializationError(error) {
  console.error("Critical initialization error:", error);
  showNotification(
    `Failed to initialize application: ${error.message}`,
    "error",
    10000
  );
  const chatInterface = document.getElementById("chat-interface");
  const errorDisplay = document.getElementById("error-display");

  if (chatInterface) chatInterface.style.display = "none";
  if (errorDisplay) errorDisplay.style.display = "block";
}

/**
 * Basic application-level error handling
 */
function handleApplicationError(error, context) {
  console.error(`[handleApplicationError - ${context}]`, error);
  showNotification("Application error in " + context + ": " + error.message, "error");
}

/**
 * Setup basic markdown support
 */
async function initializeMarkdownSupport() {
  if (!configureMarkdown()) {
    showNotification(
      "Markdown support limited - required libraries not loaded",
      "warning",
      8000
    );
  }
  injectMarkdownStyles();
}

/**
 * Initialize session
 */
async function initializeSessionHandling() {
  const sessionInitialized = await initializeSession();
  if (!sessionInitialized) {
    throw new Error("Failed to initialize session");
  }
}

/**
 * Initialize UI event handlers
 */
async function initializeUIEventHandlers() {
  // Configuration sync helper
  const syncConfigToStorage = async () => {
    const devConfigEl = document.getElementById("developer-config");
    const sliderEl = document.getElementById("reasoning-effort-slider");
    const fileSearchEl = document.getElementById("use-file-search");
    const modelSelEl = document.getElementById("model-selector");

    const config = {
      developerConfig: devConfigEl ? devConfigEl.value : "",
      reasoningEffort: ["low", "medium", "high"][
        sliderEl && sliderEl.value ? sliderEl.value - 1 : 1
      ],
      includeFiles: fileSearchEl && fileSearchEl.checked ? true : false,
      selectedModel: modelSelEl && modelSelEl.value ? modelSelEl.value : "o1model-east2"
    };
    localStorage.setItem("appConfig", JSON.stringify(config));
    await updateConfig(config);
  };

  // Model selector changes
  const modelSelector = document.getElementById("model-selector");
  if (modelSelector) {
    modelSelector.addEventListener("change", async (e) => {
      try {
        const configBefore = await getCurrentConfig();
        configBefore.selectedModel = e.target.value;
        await updateConfig(configBefore);

        showNotification(`Switched to ${e.target.value} model`, "info", 2000);
        await updateModelSpecificUI(e.target.value);

        // Update .model-info text
        const modelInfoEl = document.querySelector(".model-info p");
        if (modelInfoEl) {
          if (e.target.value === "o1") {
            modelInfoEl.innerHTML =
              "<strong>Model Info:</strong> Using Azure OpenAI o1 model (no streaming)";
          } else {
            modelInfoEl.innerHTML =
              "<strong>Model Info:</strong> Using DeepSeek R1 model (streaming available)";
          }
        }
      } catch (error) {
        console.error("Model switch error:", error);
        showNotification("Failed to switch model", "error");
      }
    });
    // Initialize model-specific UI
    try {
      const config = await getCurrentConfig();
      await updateModelSpecificUI(config.selectedModel);
    } catch (error) {
      console.error("Failed to initialize model UI:", error);
      showNotification("Failed to initialize model UI", "error");
    }
  }

  // Sending a message
  const sendButton = document.getElementById("send-button");
  const userInput = document.getElementById("user-input");
  if (sendButton) {
    sendButton.addEventListener("click", async (e) => {
      console.log("[INIT] Send button clicked; will call sendMessage()");
      showNotification("Button clicked!", "info", 3000);

      e.preventDefault();
      e.stopPropagation();
      await syncConfigToStorage();
      await sendMessage();
    });
  }
  if (userInput) {
    userInput.addEventListener("keypress", async (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        await syncConfigToStorage();
        await sendMessage();
      }
    });
  }

  // Reasoning effort slider
  const slider = document.getElementById("reasoning-effort-slider");
  if (slider) {
    slider.addEventListener("input", () => {
      updateReasoningEffortDisplay();
    });
    // Ensure valid initial value
    slider.value = Math.max(1, Math.min(3, parseInt(slider.value) || 2));
    updateReasoningEffortDisplay();
  }

  // Regeneration handler
  const regenerateButton = document.getElementById("regenerate-button");
  if (regenerateButton) {
    regenerateButton.addEventListener("click", regenerateResponse);
  }

  // Tab switching with accessibility
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      const tabId = button.dataset.targetTab;
      if (tabId) {
        switchTab(tabId);
        // Update URL hash for deep linking
        window.location.hash = tabId;
      }
    });
    // Keyboard navigation
    button.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        button.click();
      }
    });
  });

  // Handle deep linking on page load
  if (window.location.hash) {
    const tabId = window.location.hash.slice(1);
    const tabButton = document.querySelector(`[data-target-tab="${tabId}"]`);
    if (tabButton) {
      tabButton.click();
    }
  }
}

/**
 * Initialize file handling
 */
async function initializeFileHandling() {
  initializeFileManager();
}

/**
 * For updating reasoning effort slider UI
 */
function updateReasoningEffortDisplay() {
  const slider = document.getElementById("reasoning-effort-slider");
  const displayEl = document.getElementById("reasoning-effort-display");
  if (!slider || !displayEl) return;

  const val = parseInt(slider.value, 10);
  const label = val === 1 ? "Low" : val === 3 ? "High" : "Medium";
  displayEl.textContent = label;
}

/**
 * For basic tab switching logic
 */
function initializeMobileMenuGestures() {
  const mobileToggle = document.querySelector('.mobile-tab-toggle');
  const sidebar = document.querySelector('.sidebar');
  
  if (mobileToggle && sidebar) {
    let touchStartX = 0;
    
    // Swipe handling
    document.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    document.addEventListener('touchend', e => {
      const touchEndX = e.changedTouches[0].screenX;
      const deltaX = touchEndX - touchStartX;

      if (Math.abs(deltaX) > 50) {
        if (deltaX > 0 && !sidebar.classList.contains('active')) {
          sidebar.classList.add('active');
          mobileToggle.classList.add('active');
          mobileToggle.setAttribute('aria-expanded', 'true');
        } else if (deltaX < 0 && sidebar.classList.contains('active')) {
          sidebar.classList.remove('active');
          mobileToggle.classList.remove('active');
          mobileToggle.setAttribute('aria-expanded', 'false');
        }
      }
    });

    // Click outside handling
    document.addEventListener('click', e => {
      const isSidebarClick = e.target.closest('.sidebar');
      const isToggleClick = e.target.closest('.mobile-tab-toggle');
      
      if (!isSidebarClick && !isToggleClick && sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
        mobileToggle.classList.remove('active');
        mobileToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.remove("active");
    content.setAttribute("aria-hidden", "true");
  });
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.remove("active");
    button.setAttribute("aria-selected", "false");
  });

  const selectedContent = document.getElementById(tabId);
  const selectedTab = document.querySelector(`[data-target-tab="${tabId}"]`);
  if (selectedContent) {
    selectedContent.classList.add("active");
    selectedContent.setAttribute("aria-hidden", "false");
  }
  if (selectedTab) {
    selectedTab.classList.add("active");
    selectedTab.setAttribute("aria-selected", "true");
  }
}
