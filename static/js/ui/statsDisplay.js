// StatsDisplay.js
export default class StatsDisplay {
    constructor(containerId = 'performance-stats') {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`StatsDisplay container not found: #${containerId}`);
            return;
        }
        
        this.stats = {
            latency: 0,
            tokensPerSecond: 0,
            activeConnections: 0,
            totalTokens: 0
        };

        this.initDisplay();
        this.startConnectionTracking();
    }

    initDisplay() {
        this.container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-label">Latency</span>
                    <span class="stat-value" id="latency-value">0ms</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Speed</span>
                    <span class="stat-value" id="tokens-value">0 t/s</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Connections</span>
                    <span class="stat-value" id="connections-value">0</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Total Tokens</span>
                    <span class="stat-value" id="total-tokens-value">0</span>
                </div>
            </div>
        `;
    }

    startConnectionTracking() {
        // Simulate connection tracking - replace with real WebSocket connections
        setInterval(() => {
            this.stats.activeConnections = Math.floor(Math.random() * 10); // Demo data
            this.render();
        }, 5000);
    }

    updateStats(newStats) {
        Object.assign(this.stats, newStats);
        this.render();
        this.triggerAnimations();
    }

    render() {
        if (!this.container) return;
        
        this.container.querySelector('#latency-value').textContent = 
            `${this.stats.latency}ms`;
        this.container.querySelector('#tokens-value').textContent = 
            `${this.stats.tokensPerSecond.toFixed(1)} t/s`;
        this.container.querySelector('#connections-value').textContent = 
            this.stats.activeConnections;
        this.container.querySelector('#total-tokens-value').textContent = 
            this.stats.totalTokens.toLocaleString();
    }

    triggerAnimations() {
        this.container.querySelectorAll('.stat-value').forEach(el => {
            el.classList.add('stat-update-flash');
            setTimeout(() => el.classList.remove('stat-update-flash'), 300);
        });
    }
}
