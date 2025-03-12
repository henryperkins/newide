// sentryInit.js - Sentry initialization and configuration for frontend

// (UPDATED) Keep references to Sentry objects in top-level variables
let Sentry, BrowserTracing, Replay;
let isSentryInitialized = false; // Flag to prevent multiple initializations

/**
 * Safe method to check if window.Sentry was injected (e.g. via <script>),
 * otherwise create stubs to avoid runtime errors if Sentry is missing.
 */
function getSentryObjects() {
  if (typeof window.Sentry !== "undefined") {
    // If present on window, bind references
    Sentry = window.Sentry;
    BrowserTracing = window.Sentry.BrowserTracing;
    Replay = window.Sentry.Replay;
    return true;
  }

  // If Sentry is not in window, create a no-op stub for each method used
  if (typeof Sentry === "undefined") {
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
    console.warn("(sentryInit) Using a stub Sentry object — real monitoring disabled.");
    return false;
  }

  return false;
}

/**
 * (NEW) Build default tags based on environment or other heuristics.
 * This can help with quick environment identification in Sentry.
 */
function buildDefaultTags() {
  return {
    hostname: window.location.hostname,
    path: window.location.pathname,
    userAgent: navigator.userAgent,
    // Add more environment-specific tags here if needed
  };
}

/**
 * Initialize Sentry with optional Session Replay for the frontend
 * @param {Object} options - Additional config from your app
 */
export function initSentry(options = {}) {
  const hasSentry = getSentryObjects();
  if (isSentryInitialized) {
    console.log("Sentry already initialized. Skipping re-init.");
    return Sentry;
  }

  // If we don’t have real Sentry on window, we use the stub
  if (!hasSentry) {
    console.warn("Sentry globally unavailable - using stub only.");
    console.error("No Sentry script found. Error tracking is disabled.", {
      script_loaded: !!document.querySelector('script[src*="sentry"]'),
      browser: navigator.userAgent,
    });
    return Sentry;
  }

  // (UPDATED) Get release from window config or fallback
  const release = options.release || window.SENTRY_RELEASE || "newide@1.0.0";
  const environment = options.environment || "development";

  // Build config for Sentry.init()
  const config = {
    dsn:
      options.dsn ||
      window.SENTRY_DSN || 
      "https://<key>@<org>.ingest.sentry.io/<project>",
    environment,
    release,
    tracesSampleRate: options.tracesSampleRate ?? 1.0, // full tracing for dev, reduce in prod
    replaysSessionSampleRate: options.replaysSessionSampleRate ?? 0.1, // 10% by default
    replaysOnErrorSampleRate: options.replaysOnErrorSampleRate ?? 1.0, // 100% for errors
    integrations: [],
    _experiments: {
      enableTiming: true,
      enableLongTask: true,
    },

    // (UPDATED) Enhanced beforeSend hook for context + grouping
    beforeSend: (event, hint) => {
      // Example: attach additional environment info
      event.tags = event.tags || {};
      // Merge default tags
      Object.assign(event.tags, buildDefaultTags(), event.tags);

      if (
        event.exception &&
        event.exception.values &&
        event.exception.values.length > 0
      ) {
        event.contexts = event.contexts || {};
        event.contexts.browser = {
          name: navigator.userAgent,
          viewport_width: window.innerWidth,
          viewport_height: window.innerHeight,
        };

        // (NEW) Example: adding a custom “fingerprint” for grouping
        // This can unify or separate error grouping. Adjust as your app requires.
        // event.fingerprint = ['{{ default }}', window.location.pathname];
      }

      return event;
    },
  };

  // Add BrowserTracing integration if available
  if (typeof BrowserTracing === "function") {
    config.integrations.push(
      new BrowserTracing({
        // (NEW) Example: routing instrumentation if using e.g. React Router
        // routingInstrumentation: Sentry.reactRouterV6Instrumentation(...),
      }),
    );
  }

  // Add Replay if available
  if (typeof Replay === "function") {
    config.integrations.push(
      new Replay({
        maskAllText: options.maskAllText ?? false,
        blockAllMedia: options.blockAllMedia ?? false,
        maskAllInputs:
          options.maskAllInputs !== undefined ? options.maskAllInputs : true,
      }),
    );
  }

  // Make sure we only init if not already done
  try {
    if (Sentry._initialized) {
      console.log("Sentry indicates it was already initialized (Sentry._initialized found).");
      return Sentry;
    }

    console.log("Initializing Sentry with:", {
      environment: config.environment,
      release: config.release,
      tracesSampleRate: config.tracesSampleRate,
      replaysEnabled: config.integrations.some((i) => i instanceof Replay),
      browserTracingEnabled: config.integrations.some((i) => i instanceof BrowserTracing),
    });

    Sentry.init(config);
    isSentryInitialized = true;
    Sentry._initialized = true;
  } catch (error) {
    console.error("(sentryInit) Error initializing Sentry:", error);

    // Optionally store or track the init error
    try {
      localStorage.setItem("sentry_init_error", JSON.stringify({
        message: error.message,
        timestamp: new Date().toISOString(),
        stack: error.stack,
      }));
    } catch (e) {
      console.error("[sentryInit] Failed to store init error in localStorage:", e);
    }
  }

  // Apply manual tags or user context if given
  if (options.tags) {
    Sentry.setTags(options.tags);
  }
  if (options.user) {
    Sentry.setUser(options.user);
  }

  // Startup breadcrumb
  Sentry.addBreadcrumb({
    category: "lifecycle",
    message: "Sentry initialized successfully",
    level: "info",
    data: {
      environment: config.environment,
      release: config.release,
      time: new Date().toISOString(),
    },
  });

  return Sentry;
}

/**
 * Capture a frontend error in Sentry
 * @param {Error|any} error - The error to capture
 * @param {Object} context - Additional context for debugging
 */
export function captureError(error, context = {}) {
  if (Sentry && typeof Sentry.captureException === "function") {
    Sentry.captureException(error, { extra: context });
  } else {
    console.warn("(sentryInit) captureError: Sentry not found or not initialized.");
  }
}

/**
 * Capture a frontend message in Sentry
 * @param {string} message - Descriptive message text
 * @param {string} level - Severity level: info, warning, error, etc.
 * @param {Object} context - Additional data for debugging
 */
export function captureMessage(message, level = "info", context = {}) {
  if (Sentry && typeof Sentry.captureMessage === "function") {
    Sentry.captureMessage(message, { level, extra: context });
  } else {
    console.warn("(sentryInit) captureMessage: Sentry not found or not initialized.");
  }
}

/**
 * Start a Sentry transaction for performance monitoring
 * @param {string} name - Transaction name
 * @param {string} op - Operation category
 * @param {Object} data - Additional metadata
 * @returns {Transaction|null} The Sentry transaction or null if unavailable
 */
export function startTransaction(name, op, data = {}) {
  if (Sentry && typeof Sentry.startTransaction === "function") {
    const transaction = Sentry.startTransaction({ name, op, data });

    // Link transaction to current scope
    Sentry.getCurrentHub().configureScope((scope) => {
      scope.setSpan(transaction);
    });

    return transaction;
  } else {
    console.warn("(sentryInit) startTransaction: Sentry not found or not initialized.");
    return null;
  }
}

/**
 * Create a child span within the current transaction’s scope
 * @param {string} name - Span description
 * @param {string} op - Operation name
 * @returns {Span|null} Child span or null if no active transaction
 */
export function createSpan(name, op) {
  const transaction = Sentry?.getCurrentHub?.()?.getScope?.()?.getTransaction?.();
  if (!transaction) {
    console.warn("(sentryInit) createSpan: No active transaction found.");
    return null;
  }
  return transaction.startChild({ op, description: name });
}

/**
 * Set the active user in Sentry for correlation
 * @param {Object} user - e.g. { id, email, username }
 */
export function setUser(user) {
  if (Sentry && typeof Sentry.setUser === "function") {
    Sentry.setUser(user);
  } else {
    console.warn("(sentryInit) setUser: Sentry not found or not initialized.");
  }
}

/**
 * Add a breadcrumb to Sentry
 * @param {Object} breadcrumb - { category, message, level, data }
 */
export function addBreadcrumb(breadcrumb) {
  if (Sentry && typeof Sentry.addBreadcrumb === "function") {
    Sentry.addBreadcrumb(breadcrumb);
  } else {
    console.warn("(sentryInit) addBreadcrumb: Sentry not found or not initialized.");
  }
}

/**
 * Set a single tag for the current scope
 * @param {string} key 
 * @param {string} value 
 */
export function setTag(key, value) {
  if (Sentry && typeof Sentry.setTag === "function") {
    Sentry.setTag(key, value);
  } else {
    console.warn("(sentryInit) setTag: Sentry not found or not initialized.");
  }
}

/**
 * Attach extra context to the current Sentry scope
 * @param {string} key
 * @param {any} value
 */
export function setExtra(key, value) {
  if (Sentry && typeof Sentry.setExtra === "function") {
    Sentry.setExtra(key, value);
  } else {
    console.warn("(sentryInit) setExtra: Sentry not found or not initialized.");
  }
}

// (NEW) Export the Sentry object directly for advanced usage if needed
export { Sentry };
