// sentryInit.js - Sentry initialization and configuration for frontend

// Keep references to Sentry objects in top-level variables
let Sentry, BrowserTracing, Replay, FeedbackIntegration;
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

    // Enhanced beforeSend hook for context + grouping
    beforeSend: (event, hint) => {
      // Attach additional environment info
      event.tags = event.tags || {};
      // Merge default tags
      Object.assign(event.tags, buildDefaultTags(), event.tags);

      if (
        event.exception &&
        event.exception.values &&
        event.exception.values.length > 0
      ) {
        // Add browser context
        event.contexts = event.contexts || {};
        event.contexts.browser = {
          name: navigator.userAgent,
          viewport_width: window.innerWidth,
          viewport_height: window.innerHeight,
          language: navigator.language,
          platform: navigator.platform,
          memory: navigator.deviceMemory ? `${navigator.deviceMemory}GB` : 'unknown',
          connection: navigator.connection ? 
            (navigator.connection.effectiveType || navigator.connection.type || 'unknown') : 'unknown'
        };
        
        // Add page context
        event.contexts.page = {
          url: window.location.href,
          referrer: document.referrer,
          title: document.title
        };

        // Improve error grouping with custom fingerprinting
        const exception = event.exception.values[0];
        const errorType = exception.type || '';
        const errorValue = exception.value || '';
        
        // Group similar network errors together
        if (errorType.includes('NetworkError') || errorValue.includes('network') || 
            errorValue.includes('failed to fetch')) {
          event.fingerprint = ['network-error', window.location.pathname];
        }
        
        // Group similar API errors together
        else if (errorValue.includes('API') || errorValue.includes('api') || 
                errorValue.match(/status (?:4|5)\d\d/)) {
          // Extract status code if present
          const statusMatch = errorValue.match(/status (\d+)/);
          const status = statusMatch ? statusMatch[1] : 'unknown';
          event.fingerprint = ['api-error', status, window.location.pathname];
        }
        
        // Group model-specific errors
        else if (errorValue.includes('model') || errorValue.includes('inference')) {
          // Extract model name if present
          const modelMatch = errorValue.match(/model[:\s]+([a-zA-Z0-9-]+)/i);
          const model = modelMatch ? modelMatch[1] : 'unknown-model';
          event.fingerprint = ['model-error', model];
        }
      }

      return event;
    },
  };

  // Add BrowserTracing integration if available
  if (typeof BrowserTracing === "function") {
    config.integrations.push(
      new BrowserTracing({
        // Trace all XHR/fetch requests
        tracingOrigins: ["localhost", /^\//],
        
        // Track long tasks
        enableLongTask: true,
        
        // Track resource timing
        enableResourceTimingTracking: true,
        
        // Track navigation timing
        enableNavigationTimingTracking: true,
        
        // Track first input delay
        enableUserInteractionTracing: true,
        
        // Custom transaction name based on URL path
        beforeNavigate: (context) => {
          try {
            const url = context.name;
            
            // Check if the URL is valid before trying to parse it
            if (!url || typeof url !== 'string') {
              console.warn('Invalid URL in beforeNavigate (not a string):', url);
              return context; // Return unchanged context if URL is invalid
            }
            
            // For path-only URLs, use the current origin
            if (url.startsWith('/')) {
              try {
                const fullUrl = `${window.location.origin}${url}`;
                const parsedUrl = new URL(fullUrl);
                const path = parsedUrl.pathname;
                
                // Clean up path for better grouping
                const cleanPath = path.replace(/\/\d+\/?/g, '/{id}/');
                
                return {
                  ...context,
                  name: cleanPath || '/',
                  tags: {
                    ...context.tags,
                    route: cleanPath
                  }
                };
              } catch (pathError) {
                console.warn('Failed to parse path URL in beforeNavigate:', url, pathError);
                return context;
              }
            }
            
            // For URLs with protocol but no domain (e.g., https:///)
            if (/^https?:\/\/\/?$/.test(url) || url === 'https://' || url === 'http://') {
              console.warn('Invalid URL format (protocol only) in beforeNavigate:', url);
              return context;
            }
            
            // Make sure the URL has a protocol and valid domain
            let urlToProcess = url;
            if (!url.startsWith('http')) {
              urlToProcess = `https://${url.startsWith('//') ? url.slice(2) : url}`;
            }
            
            // Additional validation to ensure URL has a domain
            if (urlToProcess.match(/^https?:\/\/\/?$/)) {
              console.warn('URL missing domain in beforeNavigate:', urlToProcess);
              return context;
            }
            
            try {
              const parsedUrl = new URL(urlToProcess);
              const path = parsedUrl.pathname;
              
              // Clean up path for better grouping
              const cleanPath = path.replace(/\/\d+\/?/g, '/{id}/');
              
              return {
                ...context,
                name: cleanPath || '/',
                tags: {
                  ...context.tags,
                  route: cleanPath
                }
              };
            } catch (urlError) {
              console.warn('Failed to parse URL in beforeNavigate:', urlToProcess, urlError);
              return context; // Return unchanged context if URL parsing fails
            }
          } catch (error) {
            console.warn('Error in beforeNavigate:', error);
            return context; // Return unchanged context on any error
          }
        }
      }),
    );
  }

  // Add Replay if available
  if (typeof Replay === "function") {
    config.integrations.push(
      new Replay({
        // Privacy settings
        maskAllText: options.maskAllText ?? false,
        blockAllMedia: options.blockAllMedia ?? false,
        maskAllInputs: options.maskAllInputs !== undefined ? options.maskAllInputs : true,
        
        // Additional privacy settings
        maskTextSelector: "[data-sensitive], .user-content, .private-data",
        blockSelector: ".do-not-record, .private-media",
        
        // Network capture settings
        networkDetailAllowUrls: [
          // Allow capturing details for API calls to our own domain
          window.location.origin,
          // Add other allowed domains here
        ],
        networkRequestHeaders: ["content-type", "content-length"],
        networkResponseHeaders: ["content-type", "content-length"],
        
        // Performance optimization
        minReplayDuration: 5000, // Only record sessions longer than 5 seconds
        
        // Capture console logs in replay
        captureConsoleIntegration: true
      }),
    );
  }
  
  // Add Feedback integration if available
  if (typeof FeedbackIntegration === "function") {
    config.integrations.push(
      new FeedbackIntegration({
        // Feedback widget configuration
        colorScheme: "system",
        autoInject: false, // We'll manually trigger the feedback dialog
        buttonLabel: "Send Feedback",
        submitButtonLabel: "Submit Feedback",
        formTitle: "Report an issue",
        emailLabel: "Your email (optional)",
        emailPlaceholder: "email@example.com",
        messageLabel: "What happened?",
        messagePlaceholder: "Tell us what happened...",
        successMessageText: "Thank you for your feedback!",
        closeButtonLabel: "Close"
      })
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

/**
 * Create a performance transaction for tracking frontend operations
 * @param {string} name - Transaction name
 * @param {string} op - Operation category (e.g., 'ui.render', 'ui.interaction')
 * @param {Object} data - Additional metadata
 * @returns {Transaction|null} The Sentry transaction or null if unavailable
 */
export function createUITransaction(name, op = "ui.interaction", data = {}) {
  if (!Sentry || !isSentryInitialized) {
    console.warn("(sentryInit) createUITransaction: Sentry not initialized.");
    return null;
  }
  
  const transaction = Sentry.startTransaction({ 
    name, 
    op,
    data: {
      ...data,
      timestamp: new Date().toISOString()
    }
  });
  
  // Add default UI context
  transaction.setTag("ui.viewport_width", window.innerWidth);
  transaction.setTag("ui.viewport_height", window.innerHeight);
  transaction.setTag("ui.path", window.location.pathname);
  
  return transaction;
}

/**
 * Track a UI component render time
 * @param {string} componentName - Name of the component being rendered
 * @param {number} renderTime - Time in milliseconds it took to render
 */
export function trackComponentRender(componentName, renderTime) {
  if (!Sentry || !isSentryInitialized) {
    return;
  }
  
  // Add as a span if there's an active transaction
  const transaction = Sentry.getCurrentHub().getScope().getTransaction();
  if (transaction) {
    const span = transaction.startChild({
      op: "ui.render",
      description: `Render ${componentName}`
    });
    
    span.setData("render_time_ms", renderTime);
    span.finish();
  }
  
  // Also record as a measurement
  Sentry.setTag("last_component_render", componentName);
  Sentry.addBreadcrumb({
    category: "ui.performance",
    message: `Rendered ${componentName} in ${renderTime}ms`,
    data: { component: componentName, render_time_ms: renderTime }
  });
}

/**
 * Track a user interaction with timing
 * @param {string} action - The action being performed
 * @param {string} element - The element being interacted with
 * @param {number} responseTime - Time in milliseconds for the action to complete
 */
export function trackUserInteraction(action, element, responseTime) {
  if (!Sentry || !isSentryInitialized) {
    return;
  }
  
  Sentry.addBreadcrumb({
    category: "ui.interaction",
    message: `User ${action} on ${element}`,
    data: {
      action,
      element,
      response_time_ms: responseTime
    }
  });
  
  // If response time is slow, capture as a performance issue
  if (responseTime > 300) { // 300ms is generally considered slow for UI
    Sentry.captureMessage(
      `Slow UI interaction: ${action} on ${element} took ${responseTime}ms`,
      "warning",
      {
        tags: {
          ui_performance: "slow_interaction"
        },
        extra: {
          action,
          element,
          response_time_ms: responseTime
        }
      }
    );
  }
}

/**
 * Show the feedback dialog to collect user feedback
 * @param {string} title - Custom title for the feedback form
 * @param {Object} context - Additional context to include with the feedback
 */
export function showFeedbackDialog(title = "Send Feedback", context = {}) {
  if (!Sentry || !isSentryInitialized) {
    console.warn("(sentryInit) showFeedbackDialog: Sentry not initialized.");
    return;
  }
  
  try {
    Sentry.showReportDialog({
      title,
      subtitle: "Help us improve your experience",
      subtitle2: "Tell us what happened or what we can do better",
      labelName: "Name (optional)",
      labelEmail: "Email (optional)",
      labelComments: "What happened?",
      labelSubmit: "Submit Feedback",
      successMessage: "Thank you for your feedback!",
      errorFormEntry: "Some fields were invalid. Please correct the errors and try again.",
      errorGeneric: "An unknown error occurred while submitting your feedback. Please try again.",
      user: {
        name: localStorage.getItem("user_name") || "",
        email: localStorage.getItem("user_email") || ""
      },
      ...context
    });
  } catch (e) {
    console.error("Error showing feedback dialog:", e);
  }
}

// Export the Sentry object directly for advanced usage if needed
export { Sentry };
