class StatsDisplay {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`StatsDisplay container not found: #${containerId}`);
            return;
        }
        
        this.stats = {
            latency: 0,
            tokensPerSecond: 0,
            activeConnections: 0
        };

        this.initDisplay();
    }

    initDisplay() {
        this.container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-label">Latency:</span>
                    <span class="stat-value" id="latency-value">0ms</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Tokens/s:</span>
                    <span class="stat-value" id="tokens-value">0</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Connections:</span>
                    <span class="stat-value" id="connections-value">0</span>
                </div>
            </div>
        `;
    }

    updateStats(newStats) {
        Object.assign(this.stats, newStats);
        this.render();
    }

    render() {
        document.getElementById('latency-value').textContent = `${this.stats.latency}ms`;
        document.getElementById('tokens-value').textContent = this.stats.tokensPerSecond;
        document.getElementById('connections-value').textContent = this.stats.activeConnections;
    }
}

export default StatsDisplay;
