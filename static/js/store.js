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
    this._loadPersistedState();
  }

  _STATE_VERSION = 2;

  _loadPersistedState() {
    const raw = localStorage.getItem('globalStore');
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.version === this._STATE_VERSION) {
      // Current version
      this._theme = parsed.theme ?? 'light';
      this._activeConversationId = parsed.activeConversationId ?? null;
      this._sidebars = parsed.sidebars ?? {
        settings: { open: false, position: 'right', lastInteraction: Date.now() },
        conversations: { open: false, position: 'left', lastInteraction: Date.now() }
      };
      // Add additional fields as needed (stats, conversation, etc.)
    } else {
      // Migrate from older version or first run
      this._theme = localStorage.getItem('appTheme') || 'light';
      this._activeConversationId = localStorage.getItem('activeConversationId') || null;
      // Default or legacy sidebar data
      this._sidebars = {
        settings: { open: false, position: 'right', lastInteraction: Date.now() },
        conversations: { open: false, position: 'left', lastInteraction: Date.now() }
      };
      this._saveToStorage();
    }
  }

  _saveToStorage() {
    const state = {
      version: this._STATE_VERSION,
      theme: this._theme,
      activeConversationId: this._activeConversationId,
      sidebars: this._sidebars
      // Add other persisted fields if needed
    };
    localStorage.setItem('globalStore', JSON.stringify(state));
  }

  async transaction(updateFn) {
    const raw = localStorage.getItem('globalStore');
    const currentState = raw ? JSON.parse(raw) : {};
    const newState = await updateFn({ ...currentState });
    newState.version = this._STATE_VERSION;
    localStorage.setItem('globalStore', JSON.stringify(newState));
    this._loadPersistedState(); // Refresh memory with updated state
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
    if (typeof value !== 'string' && value !== null) {
      throw new Error('Invalid session ID');
    }
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

  get activeConversationId() {
    return this._activeConversationId || localStorage.getItem('activeConversationId');
  }
  set activeConversationId(value) {
    this._activeConversationId = value;
    localStorage.setItem('activeConversationId', value);
    this.emit('conversationChanged', value);
  }
}

// Create a single export instance to act as the global store
export const globalStore = new GlobalStore();
