import { getCurrentConfig } from "/static/js/config.js";

export async function buildAzureOpenAIUrl(deploymentName, apiVersion) {
  const config = await getCurrentConfig();
  const endpoint = config.azureOpenAI?.endpoint || "https://aoai-east-2272068338224.cognitiveservices.azure.com";
  const baseUrl = new URL(endpoint);
  const apiUrl = new URL(
    `openai/deployments/${deploymentName}/chat/completions`, 
    baseUrl
  );
  apiUrl.searchParams.append('api-version', apiVersion);
  return apiUrl.toString();
}
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

export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (error) {
        console.error('Clipboard write failed:', error);
        return false;
    }
}

export function updateTokenUsage(usage) {
    if (!usage) return;

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

export function debounce(fn, delay = 300) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

export function throttle(fn, limit = 300) {
    let lastCall = 0;
    return (...args) => {
        const now = Date.now();
        if (now - lastCall >= limit) {
            lastCall = now;
            fn.apply(this, args);
        }
    };
}

export function sanitizeInput(text) {
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
}

export function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
    );
}
