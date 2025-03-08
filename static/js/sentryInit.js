// sentryInit.js - Sentry initialization and configuration for frontend

// Get Sentry from window or create a stub
let Sentry, BrowserTracing, Replay;

// Flag to prevent multiple initializations
let isSentryInitialized = false;

// Initialize variables safely
function getSentryObjects() {
  if (typeof window.Sentry !== "undefined") {
    Sentry = window.Sentry;
    BrowserTracing = window.Sentry.BrowserTracing;
    Replay = window.Sentry.Replay;
    return true;
  }

  // Create stubs for missing objects
  if (typeof Sentry === "undefined") {
    // Create stub Sentry object with no-op methods if not available
    Sentry = {
      init: () => {},
      captureException: () => {},
      captureMessage: () => {},
      startTransaction: () => ({ finish: () => {} }),
      getCurrentHub: () => ({
        configureScope: () => {},
        getScope: () => ({ getTransaction: () => null }),
      }),
      setTags: () => {},
      setUser: () => {},
      setTag: () => {},
      setExtra: () => {},
      addBreadcrumb: () => {},
      _initialized: false,
    };
    console.warn("Using Sentry stub - real monitoring disabled");
    return false;
  }

  return false;
}

/**
 * Initialize Sentry with Session Replay for the frontend
 * @param {Object} options - Configuration options
 */
export function initSentry(options = {}) {
  // Get or create Sentry objects
  const hasSentry = getSentryObjects();

  // Prevent multiple initializations
  if (isSentryInitialized) {
    console.log(
      "Sentry already initialized, skipping duplicate initialization",
    );
    return Sentry;
  }

  // If no real Sentry is available, return the stub
  if (!hasSentry) {
    console.warn("Sentry SDK not loaded. Using stub implementation.");
    // Log this initial failure to console with more detail
    console.error(
      "Sentry SDK failed to load. Error tracking will be disabled.",
      {
        window_sentry_exists: typeof window.Sentry !== "undefined",
        script_loaded: document.querySelector('script[src*="sentry"]') !== null,
        browser: navigator.userAgent,
      },
    );
    return Sentry;
  }

  // Ensure we have a valid release value
  const release = options.release || window.SENTRY_RELEASE || "newide@1.0.0";

  // Default configuration
  const config = {
    dsn:
      options.dsn ||
      window.SENTRY_DSN ||
      "https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
    environment: options.environment || "development",
    release: release,

    // Performance monitoring
    tracesSampleRate: options.tracesSampleRate || 1.0,

    // Session replay
    replaysSessionSampleRate: options.replaysSessionSampleRate || 0.1, // Record 10% of sessions
    replaysOnErrorSampleRate: options.replaysOnErrorSampleRate || 1.0, // Record 100% of sessions with errors

    // Additional options
    integrations: [],

    // Before send hook to filter sensitive data and improve context
    beforeSend: (event, hint) => {
      // Check if there's exception data
      if (
        event.exception &&
        event.exception.values &&
        event.exception.values.length > 0
      ) {
        // Add browser information as context
        event.contexts = event.contexts || {};
        event.contexts.browser = {
          name: navigator.userAgent,
          viewport_width: window.innerWidth,
          viewport_height: window.innerHeight,
          memory: performance?.memory
            ? {
                totalJSHeapSize: performance.memory.totalJSHeapSize,
                usedJSHeapSize: performance.memory.usedJSHeapSize,
              }
            : "unavailable",
        };

        // Add additional tags for easier filtering
        event.tags = event.tags || {};

        // Add path information
        event.tags.path = window.location.pathname;

        // Detect if error is from streaming.js
        const errorValue = event.exception.values[0];
        if (errorValue && errorValue.stacktrace) {
          const frames = errorValue.stacktrace.frames || [];
          const isStreamingError = frames.some(
            (frame) =>
              frame.filename && frame.filename.includes("streaming.js"),
          );

          if (isStreamingError) {
            event.tags.errorSource = "streaming";
            event.tags.errorType = "frontend-streaming";
          }
        }
      }

      // Filter out any sensitive data here if needed

      return event;
    },
  };

  // Add BrowserTracing if available
  if (typeof BrowserTracing === "function") {
    config.integrations.push(new BrowserTracing());
  }

  // Only add Replay if it exists and we haven't initialized Sentry yet
  if (typeof Replay === "function") {
    config.integrations.push(
      new Replay({
        // Replay configuration
        maskAllText: options.maskAllText || false,
        blockAllMedia: options.blockAllMedia || false,
        maskAllInputs:
          options.maskAllInputs !== undefined ? options.maskAllInputs : true,
      }),
    );
  }

  try {
    // Check for existing initialization on the Sentry object itself
    if (Sentry._initialized) {
      console.log(
        "Sentry already initialized (detected via Sentry._initialized)",
      );
      return Sentry;
    }

    // Log configuration attempt (without sensitive data)
    console.log("Initializing Sentry with config:", {
      environment: config.environment,
      release: config.release,
      tracesSampleRate: config.tracesSampleRate,
      replaysEnabled: config.integrations.some((i) => i instanceof Replay),
      browserTracingEnabled: config.integrations.some(
        (i) => i instanceof BrowserTracing,
      ),
    });

    Sentry.init(config);
    isSentryInitialized = true;
    // Set a direct flag on the Sentry object for cross-module detection
    Sentry._initialized = true;
    console.log("Sentry initialized successfully");

    // Add a startup breadcrumb to track initialization
    Sentry.addBreadcrumb({
      category: "lifecycle",
      message: "Sentry initialized successfully",
      level: "info",
      data: {
        timestamp: new Date().toISOString(),
        environment: config.environment,
        release: config.release,
      },
    });
  } catch (error) {
    console.error("Error initializing Sentry:", error);
    // Try to log initialization failure to local storage for debugging
    try {
      localStorage.setItem(
        "sentry_init_error",
        JSON.stringify({
          message: error.message,
          timestamp: new Date().toISOString(),
          stack: error.stack,
        }),
      );
    } catch (e) {
      console.error("Failed to store Sentry init error:", e);
    }
  }

  // Add custom context if provided
  if (options.tags) {
    Sentry.setTags(options.tags);
  }

  if (options.user) {
    Sentry.setUser(options.user);
  }

  // Return the Sentry instance for further configuration
  return Sentry;
}

/**
 * Capture a frontend error with Sentry
 * @param {Error} error - The error to capture
 * @param {Object} context - Additional context for the error
 */
export function captureError(error, context = {}) {
  if (typeof Sentry !== "undefined") {
    Sentry.captureException(error, {
      extra: context,
    });
  } else {
    console.warn("Sentry is not found on window. Skipping captureException.");
  }
}

/**
 * Capture a frontend message with Sentry
 * @param {string} message - The message to capture
 * @param {string} level - The severity level (info, warning, error)
 * @param {Object} context - Additional context for the message
 */
export function captureMessage(message, level = "info", context = {}) {
  if (typeof Sentry !== "undefined") {
    Sentry.captureMessage(message, {
      level,
      extra: context,
    });
  } else {
    console.warn("Sentry is not found on window. Skipping captureMessage.");
  }
}

/**
 * Start a Sentry transaction for performance monitoring
 * @param {string} name - Transaction name
 * @param {string} op - Operation type
 * @param {Object} data - Additional data for the transaction
 * @returns {Transaction} The Sentry transaction object
 */
export function startTransaction(name, op, data = {}) {
  if (
    typeof Sentry !== "undefined" &&
    typeof Sentry.startTransaction === "function"
  ) {
    const transaction = Sentry.startTransaction({
      name,
      op,
      data,
    });

    // Set the transaction as current
    Sentry.getCurrentHub().configureScope((scope) => {
      scope.setSpan(transaction);
    });

    return transaction;
  } else {
    console.warn(
      "Sentry not found or startTransaction is not defined. Returning null.",
    );
    return null;
  }
}

/**
 * Create a span within the current transaction
 * @param {string} name - Span name
 * @param {string} op - Operation type
 * @returns {Span} The Sentry span object
 */
export function createSpan(name, op) {
  const transaction = Sentry.getCurrentHub().getScope().getTransaction();
  if (!transaction) {
    console.warn("No active transaction found when creating span:", name);
    return null;
  }

  return transaction.startChild({
    op,
    description: name,
  });
}

/**
 * Set user information for Sentry
 * @param {Object} user - User information
 */
export function setUser(user) {
  if (typeof Sentry !== "undefined" && typeof Sentry.setUser === "function") {
    Sentry.setUser(user);
  } else {
    console.warn("Sentry or setUser missing. Skipping setUser call.");
  }
}

/**
 * Add breadcrumb to Sentry
 * @param {Object} breadcrumb - Breadcrumb data
 */
export function addBreadcrumb(breadcrumb) {
  try {
    if (
      typeof Sentry !== "undefined" &&
      typeof Sentry.addBreadcrumb === "function"
    ) {
      Sentry.addBreadcrumb(breadcrumb);
    } else {
      console.warn(
        "Sentry or addBreadcrumb missing. Skipping breadcrumb:",
        breadcrumb,
      );
    }
  } catch (error) {
    console.error("Error adding breadcrumb:", error);
  }
}

/**
 * Set a tag for the current scope
 * @param {string} key - Tag key
 * @param {string} value - Tag value
 */
export function setTag(key, value) {
  if (typeof Sentry !== "undefined" && typeof Sentry.setTag === "function") {
    Sentry.setTag(key, value);
  } else {
    console.warn("Sentry or setTag missing. Skipping setTag call.");
  }
}

/**
 * Set extra context data for the current scope
 * @param {string} key - Context key
 * @param {any} value - Context value
 */
export function setExtra(key, value) {
  try {
    if (
      typeof Sentry !== "undefined" &&
      typeof Sentry.setExtra === "function"
    ) {
      Sentry.setExtra(key, value);
    } else {
      console.warn("Sentry or setExtra missing. Skipping setExtra call:", key);
    }
  } catch (error) {
    console.error("Error setting extra context:", error);
  }
}

// Export Sentry directly for advanced usage
export { Sentry };
