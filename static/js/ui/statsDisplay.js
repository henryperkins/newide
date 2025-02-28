// statsDisplay.js

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
        totalTokens: 0,
        chunkCount: 0,
        partialTokens: 0
      };
      
      // Add throttling variables
      this.lastUpdateTime = 0;
      this.updateThrottleMs = 3000; // Only update UI every 3 seconds
      this.pendingUpdate = false;

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
      // Ping endpoint every 30s to get # of active connections
      setInterval(async () => {
        try {
          const response = await fetch('/api/model-stats/connections');
          const data = await response.json();
          
          // Fix: correctly access the connection data from the response structure
          // The API returns { "connections": { ... } } with connection data nested
          if (data.connections && data.connections.concurrent_connections !== undefined) {
            this.stats.activeConnections = data.connections.concurrent_connections;
          } else if (data.active_connections !== undefined) {
            // Fallback for backward compatibility
            this.stats.activeConnections = data.active_connections;
          } else {
            this.stats.activeConnections = 0;
          }
        } catch (e) {
          // Reduce console noise by only logging if debug mode is enabled
          if (window.DEBUG_MODE) {
            console.error('Failed to fetch active connections', e);
          }
          this.stats.activeConnections = 0;
        }
        this.render();
      }, 30000);
    }
  
    render() {
      if (!this.container) return;
  
      this.container.querySelector('#latency-value').textContent =
        `${this.stats.latency}ms`;

      const chunkEl = this.container.querySelector('#chunks-value');
      const partialTokensEl = this.container.querySelector('#partial-tokens-value');
      if (chunkEl) chunkEl.textContent = this.stats.chunkCount;
      if (partialTokensEl) partialTokensEl.textContent = this.stats.partialTokens;
  
      // Show tokensPerSecond as one decimal place, e.g. "12.3 t/s"
      this.container.querySelector('#tokens-value').textContent =
        `${this.stats.tokensPerSecond.toFixed(1)} t/s`;
  
      this.container.querySelector('#connections-value').textContent =
        this.stats.activeConnections;
  
      this.container.querySelector('#total-tokens-value').textContent =
        this.stats.totalTokens.toLocaleString();
    }
  
    triggerAnimations() {
      // Brief highlight animation on updated values
      this.container.querySelectorAll('.stat-value').forEach(el => {
        el.classList.add('stat-update-flash');
        setTimeout(() => el.classList.remove('stat-update-flash'), 300);
      });
    }
    
    updateStats(newStats) {
      // Merge the new stats into our existing stats object
      Object.assign(this.stats, newStats);
      
      // Throttle the UI updates
      const now = Date.now();
      if (now - this.lastUpdateTime >= this.updateThrottleMs) {
        this.render();
        this.triggerAnimations();
        this.lastUpdateTime = now;
        this.pendingUpdate = false;
      } else if (!this.pendingUpdate) {
        // Schedule an update for later if we haven't already
        this.pendingUpdate = true;
        setTimeout(() => {
          if (this.pendingUpdate) {
            this.render();
            this.triggerAnimations();
            this.lastUpdateTime = Date.now();
            this.pendingUpdate = false;
          }
        }, this.updateThrottleMs);
      }
    }
  }

