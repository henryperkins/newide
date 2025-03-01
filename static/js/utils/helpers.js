import { getCurrentConfig } from "/static/js/config.js";

/**
 * Builds a complete Azure OpenAI API URL
 * @param {string} deploymentName - The deployment name to use
 * @param {string} apiVersion - The API version
 * @returns {Promise<string>} The complete API URL
 */
export async function buildAzureOpenAIUrl(deploymentName, apiVersion) {
  const config = await getCurrentConfig();
  const endpoint = config.azureOpenAI?.endpoint || "https://o1models.openai.azure.com";
  const baseUrl = new URL(endpoint);
  const apiUrl = new URL(
    `openai/deployments/${deploymentName}/chat/completions`, 
    baseUrl
  );
  apiUrl.searchParams.append('api-version', apiVersion);
  return apiUrl.toString();
}

/**
 * Formats a file size in bytes to a human-readable string
 * @param {number} bytes - The size in bytes
 * @returns {string} Formatted size string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes) {
    if (typeof bytes !== 'number' || bytes < 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    const threshold = 1024;
    
    if (bytes < threshold) return `${bytes} B`;
    
    let u = 0;
    while (bytes >= threshold && u < units.length - 1) {
        bytes /= threshold;
        u++;
    }
    
    return `${bytes.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

/**
 * Copies text to the clipboard
 * @param {string} text - The text to copy
 * @returns {Promise<boolean>} Whether the copy was successful
 */
export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (error) {
        console.error('Clipboard write failed:', error);
        return false;
    }
}

/**
 * Updates token usage display in the UI
 * @param {Object} usage - Token usage statistics
 */
export function updateTokenUsage(usage) {
    if (!usage) return;

    const tokenUsage = document.querySelector('.token-usage-compact');
    if (!tokenUsage) return;

    // Show token usage when there's data
    tokenUsage.classList.add('active');

    // Create toggle button if it doesn't exist
    if (!document.querySelector('.token-usage-toggle')) {
        const toggle = document.createElement('button');
        toggle.className = 'token-usage-toggle';
        toggle.innerHTML = '📊';
        toggle.title = 'Toggle token usage';
        toggle.onclick = () => {
            tokenUsage.classList.toggle('active');
            localStorage.setItem('token-usage-visible', tokenUsage.classList.contains('active'));
        };
        tokenUsage.appendChild(toggle);

        // Restore previous state
        const wasVisible = localStorage.getItem('token-usage-visible') === 'true';
        if (!wasVisible) {
            tokenUsage.classList.remove('active');
        }
    }

    // Update basic token counters
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = value.toLocaleString();
            el.parentElement.style.display = value > 0 ? 'block' : 'none';
        }
    };

    setText('prompt-tokens', usage.prompt_tokens || 0);
    setText('completion-tokens', usage.completion_tokens || 0);
    setText('total-tokens', usage.total_tokens || 0);
    setText('vision-tokens', usage.vision_tokens || 0);

    // Handle reasoning tokens if available
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
    if (reasoningTokens > 0) {
        const baseCompletionTokens = usage.completion_tokens - reasoningTokens;
        setText('reasoning-tokens', reasoningTokens);
        setText('base-completion-tokens', baseCompletionTokens);
        
        // Calculate and display percentage
        const reasoningPercent = ((reasoningTokens / usage.completion_tokens) * 100).toFixed(1);
        const reasoningContainer = document.getElementById('reasoning-tokens').parentElement;
        if (reasoningContainer) {
            const breakdown = document.createElement('div');
            breakdown.className = 'token-breakdown';
            breakdown.innerHTML = `
                <div class="reasoning-bar" style="width: ${reasoningPercent}%"></div>
                <span>${reasoningPercent}% of completion tokens</span>
            `;
            reasoningContainer.appendChild(breakdown);
        }
    }

    // Handle advanced metrics
    const metricsContainer = document.getElementById('advanced-token-metrics') || 
        createAdvancedMetricsContainer();

    metricsContainer.innerHTML = generateMetricsHTML(usage);
}

/**
 * Creates the advanced metrics container if it doesn't exist
 * @returns {HTMLElement} The metrics container
 */
function createAdvancedMetricsContainer() {
    const container = document.createElement('div');
    container.id = 'advanced-token-metrics';
    container.className = 'advanced-metrics';
    
    const tokenStats = document.getElementById('token-stats');
    if (tokenStats) {
        tokenStats.appendChild(container);
    }
    
    return container;
}

/**
 * Generates HTML for the advanced metrics display
 * @param {Object} usage - Token usage statistics
 * @returns {string} HTML string
 */
function generateMetricsHTML(usage) {
    let html = '';
    
    // Reasoning tokens metric
    if (usage.completion_details?.reasoning_tokens) {
        const tokens = usage.completion_details.reasoning_tokens;
        const percent = ((tokens / usage.completion_tokens) * 100).toFixed(1);
        html += `
            <div class="metric reasoning">
                <div class="metric-header">
                    <span>Reasoning Tokens</span>
                    <span>${tokens.toLocaleString()}</span>
                </div>
                <div class="metric-bar">
                    <div class="metric-fill" style="width: ${percent}%"></div>
                </div>
                <div class="metric-footer">${percent}% of completion</div>
            </div>
        `;
    }

    // Cached tokens metric
    if (usage.prompt_details?.cached_tokens) {
        const tokens = usage.prompt_details.cached_tokens;
        const percent = ((tokens / usage.prompt_tokens) * 100).toFixed(1);
        html += `
            <div class="metric cached">
                <div class="metric-header">
                    <span>Cached Tokens</span>
                    <span>${tokens.toLocaleString()}</span>
                </div>
                <div class="metric-bar">
                    <div class="metric-fill" style="width: ${percent}%"></div>
                </div>
                <div class="metric-footer">${percent}% of prompt</div>
            </div>
        `;
    }

    return html;
}

/**
 * Toggles the theme between light and dark
 */
export function toggleTheme() {
    const theme = document.documentElement.getAttribute('data-theme');
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    const toggle = document.querySelector('.theme-toggle');
    if (toggle) {
        toggle.setAttribute('data-theme', newTheme);
    }
}

/**
 * Initializes theme based on user preference or system setting
 */
export function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    const toggle = document.createElement('button');
    toggle.className = 'theme-toggle';
    toggle.setAttribute('data-theme', savedTheme);
    toggle.setAttribute('aria-label', 'Toggle dark mode');
    toggle.onclick = toggleTheme;
    
    const header = document.querySelector('.chat-header');
    if (header) {
        header.appendChild(toggle);
    }
}

/**
 * Creates a debounced version of a function
 * @param {Function} fn - The function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(fn, delay = 300) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Creates a throttled version of a function
 * @param {Function} fn - The function to throttle
 * @param {number} limit - Throttle limit in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(fn, limit = 300) {
    let timeoutId;
    let lastCall = 0;
    return (...args) => {
        const now = Date.now();
        if (now - lastCall >= limit) {
            lastCall = now;
            fn.apply(this, args);
        }
    };
}

/**
 * Sanitizes input text to prevent XSS attacks
 * @param {string} text - Input text
 * @returns {string} Sanitized text
 */
export function sanitizeInput(text) {
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
}

/**
 * Checks if the current device is mobile
 * @returns {boolean} True if mobile device
 */
export function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
    );
}

/**
 * Creates a cache with expiration for frequently accessed data
 * @param {number} maxAge - Maximum age in milliseconds
 * @returns {Object} Cache interface
 */
export function createCache(maxAge = 60000) {
  const cache = new Map();
  
  return {
    get(key) {
      const item = cache.get(key);
      if (!item) return undefined;
      
      const now = Date.now();
      if (now > item.expiry) {
        cache.delete(key);
        return undefined;
      }
      
      return item.value;
    },
    
    set(key, value) {
      const expiry = Date.now() + maxAge;
      cache.set(key, { value, expiry });
      return value;
    },
    
    clear() {
      cache.clear();
    }
  };
}

/**
 * Standardized fetch error handling
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<any>} - Parsed response
 */
export async function fetchWithErrorHandling(url, options = {}) {
  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw {
        status: response.status,
        message: errorData.detail || errorData.message || response.statusText,
        data: errorData
      };
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API error: ${error.message || error}`);
    throw error;
  }
}

/**
 * Simple event bus for pub/sub communication between components
 */
export const eventBus = {
  events: {},
  
  subscribe(event, callback) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(callback);
    return () => this.unsubscribe(event, callback);
  },
  
  publish(event, data) {
    if (!this.events[event]) return;
    this.events[event].forEach(callback => callback(data));
  },
  
  unsubscribe(event, callback) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(cb => cb !== callback);
  }
};

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in ms
 * @returns {Promise<any>} - Result of the function
 */
export async function retry(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't wait on the final attempt
      if (attempt < maxRetries - 1) {
        // Exponential backoff with jitter
        const delay = baseDelay * Math.pow(2, attempt) * (0.9 + Math.random() * 0.2);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Check if the current environment is mobile
 * @returns {boolean} True if mobile
 */
export function isMobileEnvironment() {
  return window.matchMedia('(max-width: 768px)').matches || 
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Fetch with exponential backoff retry logic
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<Response>} - The fetch response
 */
export async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  return retry(async () => {
    const response = await fetch(url, options);
    
    // If the request was successful or it's a client error (4xx), don't retry
    if (response.ok || (response.status >= 400 && response.status < 500)) {
      return response;
    }
    
    // Only retry on server errors (5xx)
    if (response.status >= 500) {
      throw new Error(`Server error (${response.status})`);
    }
    
    return response; // Don't retry on other status codes
  }, maxRetries);
}