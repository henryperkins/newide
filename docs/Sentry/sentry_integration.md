# Sentry Integration for FastAPI Application

This document explains how Sentry has been integrated into the FastAPI application for error tracking, performance monitoring, profiling, and session replay.

## Overview

[Sentry](https://sentry.io) is an error tracking and monitoring tool that helps developers identify and fix issues in their applications. It provides real-time error tracking, performance monitoring, profiling, session replay, and detailed error reports.

## Configuration

Sentry has been integrated into the FastAPI application with the following configuration:

1. **Dependencies**: The `sentry-sdk[fastapi]` package has been added to `requirements.txt`.

2. **Environment Variables**: The following environment variables have been added to the `.env` file:
   - `SENTRY_DSN`: The Data Source Name (DSN) for your Sentry project
   - `SENTRY_ENVIRONMENT`: The environment name (e.g., development, production)
   - `SENTRY_RELEASE`: The release version of your application
   - `SENTRY_TRACES_SAMPLE_RATE`: The sample rate for performance monitoring (0.0 to 1.0)
   - `SENTRY_PROFILES_SAMPLE_RATE`: The sample rate for profiling (0.0 to 1.0)
   - `SENTRY_MAX_BREADCRUMBS`: Maximum number of breadcrumbs to record
   - `SENTRY_SEND_DEFAULT_PII`: Whether to send personally identifiable information
   - `SENTRY_SERVER_NAME`: Server name for identification
   - `SENTRY_ATTACH_STACKTRACE`: Whether to attach stacktraces to messages

3. **Initialization**: Sentry is initialized in `main.py` with the FastAPI integration:

```python
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

# Initialize Sentry
sentry_sdk.init(
    # Basic configuration
    dsn=config.settings.SENTRY_DSN,
    environment=config.settings.SENTRY_ENVIRONMENT,
    release=config.settings.SENTRY_RELEASE,
    
    # Performance monitoring
    traces_sample_rate=config.settings.SENTRY_TRACES_SAMPLE_RATE,
    profiles_sample_rate=config.settings.SENTRY_PROFILES_SAMPLE_RATE,
    
    # Data management
    max_breadcrumbs=config.settings.SENTRY_MAX_BREADCRUMBS,
    send_default_pii=config.settings.SENTRY_SEND_DEFAULT_PII,
    server_name=config.settings.SENTRY_SERVER_NAME,
    
    # Error reporting behavior
    attach_stacktrace=config.settings.SENTRY_ATTACH_STACKTRACE,
    
    # Integrations
    integrations=[
        FastApiIntegration(transaction_style="url"),
    ],
)
```

## Usage

### Automatic Error Tracking

With the FastAPI integration, Sentry automatically captures unhandled exceptions and errors in your application. You don't need to add any additional code for basic error tracking.

### Manual Error Reporting

You can manually report errors and messages to Sentry using the following methods:

1. **Capture Exceptions**:

```python
try:
    # Your code that might raise an exception
    result = 1 / 0
except Exception as e:
    sentry_sdk.capture_exception(e)
```

2. **Capture Messages**:

```python
sentry_sdk.capture_message("Something went wrong", level="error")
```

3. **Set User Context**:

```python
sentry_sdk.set_user({"id": user_id, "email": user_email, "username": username})
```

4. **Add Custom Context**:

```python
with sentry_sdk.configure_scope() as scope:
    scope.set_tag("page_locale", "de-at")
    scope.set_extra("metadata", {"key": "value"})
```

### Test Endpoint

A test endpoint has been added to verify the Sentry integration:

```
GET /sentry-test
```

This endpoint deliberately raises an exception to test Sentry error reporting. You can access it at:

```
http://localhost:8000/sentry-test
```

## Performance Monitoring and Profiling

Sentry provides performance monitoring through its tracing feature and profiling capabilities. The `traces_sample_rate` and `profiles_sample_rate` configurations determine what percentage of transactions will be captured.

### Custom Transactions

You can create custom transactions to monitor specific operations:

```python
from sentry_sdk import start_transaction

with start_transaction(op="task", name="my-task"):
    # Your code to monitor
    do_something()
```

### Function-Level Profiling

The application uses function-level profiling with the `@sentry_sdk.profile` decorator to identify performance bottlenecks in critical functions:

```python
@sentry_sdk.profile(tags={"operation": "model_switch", "phase": "start"})
async def track_model_switch(self, session_id, from_model, to_model, tracking_id=None, metadata=None):
    # Function implementation
```

This decorator adds profiling information to Sentry for the decorated function, including execution time and call frequency. The `tags` parameter allows you to categorize and filter profiling data in the Sentry dashboard.

### Profiling Spans

For more granular profiling within functions, the application uses profiling spans:

```python
with sentry_sdk.start_profiling_span(description="DB Insert Model Transition"):
    # Code to profile
    await self.db.execute(...)
```

Profiling spans allow you to measure the performance of specific code blocks within a function, helping to identify which parts of a function are taking the most time.

### Performance Measurements

The application also records custom measurements for important metrics:

```python
sentry_sdk.set_measurement("stream_duration_seconds", stream_duration)
sentry_sdk.set_measurement("prompt_tokens", prompt_tokens)
sentry_sdk.set_measurement("completion_tokens", completion_tokens)
sentry_sdk.set_measurement("total_tokens", total_tokens)
```

These measurements provide additional context for performance analysis in the Sentry dashboard.

## Key Profiled Components

The following key components have been profiled:

1. **Model Tracking Service**:
   - `track_model_switch`: Tracks the start of model transitions
   - `complete_model_switch`: Records the completion of model transitions
   - `get_model_usage_by_session`: Retrieves model usage data for a session

2. **Chat Service**:
   - `process_chat_message`: Processes chat messages and calls the AI model
   - `get_file_context`: Retrieves file content for context
   - `save_conversation`: Saves conversation data to the database

3. **Chat Router**:
   - `chat_sse`: Handles Server-Sent Events (SSE) for streaming responses
   - `generate_stream_chunks`: Generates streaming chunks from model responses

## Viewing Errors, Performance Data, and Profiles

To view the data captured by Sentry:

1. Log in to your Sentry account at https://sentry.io
2. Navigate to your project
3. View the "Issues" tab for error reports
4. View the "Performance" tab for transaction data
5. View the "Profiling" tab for profiling data

## Troubleshooting

If Sentry is not capturing errors or profiling data as expected:

1. Verify that the `SENTRY_DSN` is correct in your `.env` file
2. Check that Sentry is properly initialized in `main.py`
3. Ensure that the `sentry-sdk[fastapi]` package is installed
4. Verify that `profiles_sample_rate` is set to a value greater than 0
5. Try using the test endpoint to verify the integration

## Session Replay

Sentry Session Replay records user interactions with your application, allowing you to see exactly what users experienced when an error occurred. This feature is implemented in the frontend JavaScript code.

### Session Replay Configuration

Session Replay is configured in the `sentryInit.js` file:

```javascript
// Initialize Sentry with Session Replay
initSentry({
  dsn: window.SENTRY_DSN || 'https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528',
  environment: window.SENTRY_ENVIRONMENT || 'development',
  release: window.SENTRY_RELEASE || '1.0.0',
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1, // Record 10% of sessions
  replaysOnErrorSampleRate: 1.0, // Record 100% of sessions with errors
  maskAllInputs: true, // Mask all input fields for privacy
});
```

### Privacy Considerations

Session Replay is configured with privacy in mind:

- `maskAllInputs: true`: All input fields are automatically masked to prevent capturing sensitive information
- `replaysSessionSampleRate: 0.1`: Only 10% of sessions are recorded by default
- `replaysOnErrorSampleRate: 1.0`: 100% of sessions with errors are recorded to ensure all error contexts are captured

### User Action Tracking

The application uses breadcrumbs to track user actions, which provides context for session replays:

```javascript
import('./sentryInit.js').then(module => {
  module.addBreadcrumb({
    category: 'ui.action',
    message: 'User clicked send message button',
    level: 'info'
  });
});
```

These breadcrumbs help identify what actions a user took before an error occurred.

### Manual Error Reporting

Users can manually report errors using the "Report Error" button that appears when an error occurs:

```javascript
reportButton.addEventListener('click', () => {
  import('./sentryInit.js').then(module => {
    module.captureMessage('User manually reported error', 'error', { 
      error: error.toString(),
      stack: error.stack,
      location: window.location.href
    });
  });
});
```

## Additional Resources

- [Sentry Documentation](https://docs.sentry.io/)
- [Sentry Python SDK Documentation](https://docs.sentry.io/platforms/python/)
- [Sentry FastAPI Integration](https://docs.sentry.io/platforms/python/integrations/fastapi/)
- [Sentry Profiling Documentation](https://docs.sentry.io/platforms/python/profiling/)
- [Sentry Session Replay Documentation](https://docs.sentry.io/platforms/javascript/session-replay/)
