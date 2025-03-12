// store.js
// Unified global store for theme, session ID, stats, and current model state

// Basic event emitter to allow subscription to changes
class StoreEmitter {
  constructor() {
    this.listeners = {};
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  emit(event, payload) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((callback) => callback(payload));
    }
  }
}

// GlobalStore class implementing a centralized approach
export class GlobalStore extends StoreEmitter {
  constructor() {
    super();

    // Try to load persisted fields from localStorage
    this._theme = localStorage.getItem('appTheme') || 'light';
    this._sessionId = localStorage.getItem('sessionId') || null;
    this._currentModel = localStorage.getItem('currentModel') || null;
    // Stats is ephemeral; optionally can track usage details but no localStorage usage by default
    this._statsDisplay = null;

    // Model configs now unified in the global store
    this._modelConfigs = {};

    // Additional ephemeral states
    this._tokenDetailsVisible = localStorage.getItem('tokenDetailsVisible') === 'true';
    this._conversation = localStorage.getItem('conversation')
      ? JSON.parse(localStorage.getItem('conversation'))
      : [];
    // We'll store welcomeMessageShown in localStorage so it persists between sessions if desired
    this._welcomeMessageShown = localStorage.getItem('welcomeMessageShown') === 'true';
  }

  // Model Configs
  get modelConfigs() {
    return this._modelConfigs;
  }
  set modelConfigs(value) {
    this._modelConfigs = value || {};
    this.emit('modelConfigsChanged', this._modelConfigs);
  }

  // THEME
  get theme() {
    return this._theme;
  }
  set theme(value) {
    if (value !== this._theme) {
      this._theme = value;
      localStorage.setItem('appTheme', value);
      this.emit('themeChanged', value);
    }
  }

  // SESSION
  get sessionId() {
    return this._sessionId;
  }
  set sessionId(value) {
    if (value !== this._sessionId) {
      this._sessionId = value;
      localStorage.setItem('sessionId', value || '');
      this.emit('sessionChanged', value);
    }
  }

  // MODEL
  get currentModel() {
    return this._currentModel;
  }
  set currentModel(value) {
    if (value !== this._currentModel) {
      this._currentModel = value;
      localStorage.setItem('currentModel', value || '');
      this.emit('modelChanged', value);
    }
  }

  // Additional config fields

  // Reasoning Effort
  get reasoningEffort() {
    return this._reasoningEffort || 'normal'; // default to 'normal'
  }
  set reasoningEffort(value) {
    this._reasoningEffort = value;
    localStorage.setItem('reasoningEffort', value);
    this.emit('reasoningEffortChanged', value);
  }

  // Selected Model (different from currentModel if needed)
  get selectedModel() {
    return this._selectedModel || this.currentModel || 'DeepSeek-R1';
  }
  set selectedModel(value) {
    this._selectedModel = value;
    localStorage.setItem('selectedModel', value);
    this.emit('selectedModelChanged', value);
  }

  // Streaming Enabled
  get streamingEnabled() {
    return this._streamingEnabled === true;
  }
  set streamingEnabled(value) {
    this._streamingEnabled = Boolean(value);
    localStorage.setItem('streamingEnabled', this._streamingEnabled ? 'true' : 'false');
    this.emit('streamingEnabledChanged', this._streamingEnabled);
  }

  // Font Size
  get fontSize() {
    return this._fontSize || 'text-base';
  }
  set fontSize(value) {
    this._fontSize = value;
    localStorage.setItem('fontSize', value);
    this.emit('fontSizeChanged', value);
  }

  // STATS
  get statsDisplay() {
    return this._statsDisplay;
  }
  set statsDisplay(instance) {
    this._statsDisplay = instance;
    // not persisting stats instance in localStorage
    this.emit('statsInitialized', instance);
  }

  // Additional ephemeral states
  get tokenDetailsVisible() {
    return this._tokenDetailsVisible;
  }
  set tokenDetailsVisible(value) {
    this._tokenDetailsVisible = Boolean(value);
    localStorage.setItem('tokenDetailsVisible', this._tokenDetailsVisible ? 'true' : 'false');
    this.emit('tokenDetailsVisibilityChanged', this._tokenDetailsVisible);
  }

  get conversation() {
    return this._conversation;
  }
  set conversation(value) {
    if (!Array.isArray(value)) {
      console.warn('conversation must be an array');
      return;
    }
    this._conversation = value;
    localStorage.setItem('conversation', JSON.stringify(value));
    this.emit('conversationChanged', value);
  }

  get welcomeMessageShown() {
    return this._welcomeMessageShown;
  }
  set welcomeMessageShown(value) {
    this._welcomeMessageShown = Boolean(value);
    localStorage.setItem('welcomeMessageShown', this._welcomeMessageShown ? 'true' : 'false');
    this.emit('welcomeMessageShownChanged', this._welcomeMessageShown);
  }
}

// Create a single export instance to act as the global store
export const globalStore = new GlobalStore();