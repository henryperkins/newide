// Simple test script to verify Sentry initialization fixes

// Mock the window object with Sentry, BrowserTracing, and Replay
const window = {
  Sentry: {
    init: function(config) {
      console.log('Sentry.init called with config:', JSON.stringify(config));
      // Mark as initialized
      this._initialized = true;
    },
    setTags: function() {},
    setUser: function() {},
    captureMessage: function() {},
    captureException: function() {},
    startTransaction: function() { return { finish: function() {} }; },
    getCurrentHub: function() { 
      return { 
        configureScope: function() {},
        getScope: function() { return { getTransaction: function() { return null; } }; }
      };
    }
  },
  BrowserTracing: function() {},
  Replay: function(options) {
    console.log('Replay constructor called with options:', JSON.stringify(options));
    
    // Simulate the behavior that throws the error
    if (this._isInitialized) {
      throw new Error('Multiple Sentry Session Replay instances are not supported');
    }
    this._isInitialized = true;
  }
};

// Load our sentryInit.js code
const Sentry = window.Sentry;
const BrowserTracing = window.BrowserTracing;
const Replay = window.Replay;
let isSentryInitialized = false;

// Import initSentry function (manually re-implemented for testing)
function initSentry(options = {}) {
  // Prevent multiple initializations
  if (isSentryInitialized) {
    console.log('Sentry already initialized, skipping duplicate initialization');
    return Sentry;
  }
  
  // Ensure we have a valid release value
  const release = options.release || window.SENTRY_RELEASE || 'newide@1.0.0';
  
  // Default configuration
  const config = {
    dsn: options.dsn || window.SENTRY_DSN,
    environment: options.environment || 'development',
    release: release,
    
    // Performance monitoring
    tracesSampleRate: options.tracesSampleRate || 1.0,
    
    // Session replay
    replaysSessionSampleRate: options.replaysSessionSampleRate || 0.1,
    replaysOnErrorSampleRate: options.replaysOnErrorSampleRate || 1.0,
    
    // Additional options
    integrations: [
      ...(typeof BrowserTracing === "function" ? [new BrowserTracing()] : [])
    ],
    
    // Before send hook to filter sensitive data
    beforeSend: (event) => {
      return event;
    }
  };
  
  // Only add Replay if it exists and we haven't initialized Sentry yet
  if (typeof Replay === "function" && !isSentryInitialized) {
    config.integrations.push(
      new Replay({
        maskAllText: options.maskAllText || false,
        blockAllMedia: options.blockAllMedia || false,
        maskAllInputs: options.maskAllInputs !== undefined ? options.maskAllInputs : true,
      })
    );
  }

  // Initialize Sentry
  if (typeof Sentry !== 'undefined') {
    try {
      // Check for existing initialization on the Sentry object itself
      if (Sentry._initialized) {
        console.log('Sentry already initialized (detected via Sentry._initialized)');
        return Sentry;
      }
      
      Sentry.init(config);
      isSentryInitialized = true;
      // Set a direct flag on the Sentry object for cross-module detection
      Sentry._initialized = true;
      console.log('Sentry initialized with Session Replay');
    } catch (error) {
      console.error('Error initializing Sentry:', error);
    }
  } else {
    console.warn("Sentry is not found on window. Skipping init.");
    return null;
  }
  
  return Sentry;
}

// Test scenario: try to initialize Sentry multiple times
console.log('\n=== Testing Multiple Sentry Initializations ===\n');

// First initialization (should succeed)
console.log('First initialization:');
initSentry({
  dsn: 'https://example-dsn@sentry.io/12345',
  environment: 'test',
});

// Second initialization (should be skipped due to isSentryInitialized flag)
console.log('\nSecond initialization (should be skipped due to isSentryInitialized):');
initSentry({
  dsn: 'https://different-dsn@sentry.io/67890',
  environment: 'production',
});

// Third initialization (should be skipped due to Sentry._initialized)
console.log('\nThird initialization (should be skipped due to Sentry._initialized):');
// Reset the local flag to simulate module reload
isSentryInitialized = false;
initSentry({
  dsn: 'https://third-dsn@sentry.io/54321',
  environment: 'staging',
});

console.log('\n=== Test Complete ===');
