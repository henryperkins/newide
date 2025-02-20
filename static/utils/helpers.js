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
        if (el) el.textContent = value.toLocaleString();
    };

    setText('prompt-tokens', usage.prompt_tokens || 0);
    setText('completion-tokens', usage.completion_tokens || 0);
    setText('total-tokens', usage.total_tokens || 0);

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
