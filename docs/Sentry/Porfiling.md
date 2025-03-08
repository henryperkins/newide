# Profiling with Sentry

Profiling allows you to monitor your application's performance by sampling the program's call stack in various environments. This feature collects function-level information about your code, enabling you to fine-tune performance, enhance user experience, and optimize resource usage.

## Basic Profiling Setup

To enable profiling in your Python application:

```python
import sentry_sdk

def profiles_sampler(sampling_context):
    # Custom sampling logic - return value between 0.0 and 1.0 or a boolean
    # Example: Sample more for certain endpoints
    op = sampling_context.get("transaction_context", {}).get("op", "")
    name = sampling_context.get("transaction_context", {}).get("name", "")
    
    # Sample all API endpoints at higher rate
    if op == "http.server" and "/api/" in name:
        return 1.0
    # Use lower sampling rate for everything else
    return 0.1

sentry_sdk.init(
    dsn="YOUR_DSN",  # Replace with environment variable reference
    
    # Set a uniform sample rate (recommended for development only)
    profiles_sample_rate=0.1,  # 10% sampling in production
    
    # OR use dynamic sampling for more control
    profiles_sampler=profiles_sampler
)
```

## Function-Level Profiling

The `@sentry_sdk.profile()` decorator lets you profile specific functions:

```python
import sentry_sdk

@sentry_sdk.profile()
def expensive_operation():
    # This function will be profiled
    results = process_data()
    return results
```

## Code Block Profiling with Span

For profiling specific code blocks within functions:

```python
def complex_function():
    # Regular code here
    
    # Start profiling a specific section
    with sentry_sdk.start_profiling_span(description="Data processing"):
        process_large_dataset()
    
    # Continue with non-profiled code
    finalize_results()
```

## Continuous Profiling

Starting from Sentry SDK version 2.21.0, continuous profiling allows you to collect data without the 30-second limitation:

### Manual Start and Stop

```python
import sentry_sdk

sentry_sdk.init(
    dsn="YOUR_DSN",  # Use environment variable
    traces_sample_rate=0.1,
    
    # Collect profiles for 10% of sessions
    profile_session_sample_rate=0.1,
)

# Start profiler manually
sentry_sdk.profiler.start_profiler()

# Application code runs here...

# Stop profiler when appropriate
sentry_sdk.profiler.stop_profiler()
```

### Automatic Start with Transactions

For web applications, automatically start profiling with transactions:

```python
import sentry_sdk

sentry_sdk.init(
    dsn="YOUR_DSN",  # Use environment variable
    traces_sample_rate=0.1,
    profile_session_sample_rate=0.1,
    _experiments={
      "continuous_profiling_auto_start": True,
    },
)
```

## Best Practices

1. **Production Sampling**: Keep sampling rates low in production (0.01-0.1 range)
2. **Focus Areas**: Target performance-critical code with manual profiling
3. **Transaction Linking**: Ensure profiles are linked to transactions for better context
4. **Analysis**: Check the "Profiling" tab in Sentry to identify hotspots
5. **Memory Usage**: Be aware that profiling adds some overhead; adjust sampling accordingly

## Troubleshooting

- **No Profiles Appearing**: Verify the SDK version supports profiling
- **High Overhead**: Reduce sampling rate or focus on specific function profiling
- **Sampled Function Not Showing**: Ensure the function actually executes during sampling period

## Additional Resources

- [Sentry Profiling Documentation](https://docs.sentry.io/product/profiling/)
- [Performance Monitoring Guide](https://docs.sentry.io/product/performance/)