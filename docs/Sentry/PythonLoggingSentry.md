# Python Logging with Sentry

## Overview

Learn about logging with Python using Sentry. This note explains how to add support for Python logging with Sentry, including installation, initialization, and customization of logging behavior.

## Installation

Install `sentry-sdk` from PyPI:

```sh
pip install --upgrade sentry-sdk
```

## Initialization

The logging integration is a default integration and will be enabled automatically when you initialize the Sentry SDK.

```python
import sentry_sdk

sentry_sdk.init(
    dsn="https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
    # Add data like request headers and IP for users, if applicable;
    # see https://docs.sentry.io/platforms/python/data-management/data-collected/ for more info
    send_default_pii=True,
)
```

## Basic Usage

Here is an example of how to use logging with Sentry:

```python
import logging

def main():
    sentry_sdk.init(...)  # same as above

    logging.debug("I am ignored")
    logging.info("I am a breadcrumb")
    logging.error("I am an event", extra=dict(bar=43))
    logging.exception("An exception happened")

main()
```

### Explanation

- There will be an error event with the message `"I am an event"`.
- `"I am a breadcrumb"` will be attached as a breadcrumb to that event.
- `bar` will end up in the event's `extra` attributes.
- `"An exception happened"` will send the current exception from `sys.exc_info()` with the stack trace and everything to the Sentry Python SDK. If there's no exception, the current stack will be attached.
- The debug message `"I am ignored"` will not surface anywhere. To capture it, you need to lower `level` to `DEBUG` (See below).

## Customizing Logging Behavior

To change the default behavior of the logging integration, instantiate the integration manually and pass it to Sentry's `init` function:

```python
import logging
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration

# The SDK will honor the level set by the logging library, which is WARNING by default.
# If we want to capture records with lower severity, we need to configure
# the logger level first.
logging.basicConfig(level=logging.INFO)

sentry_sdk.init(
    # ...
    integrations=[
        LoggingIntegration(
            level=logging.INFO,        # Capture info and above as breadcrumbs
            event_level=logging.INFO   # Send records as events
        ),
    ],
)
```

### Keyword Arguments for `LoggingIntegration()`

- `level` (default `INFO`): The Sentry Python SDK will record log records with a level higher than or equal to `level` as breadcrumbs. Inversely, the SDK completely ignores any log record with a level lower than this one. If a value of `None` occurs, the SDK won't send log records as breadcrumbs.
- `event_level` (default `ERROR`): The Sentry Python SDK will report log records with a level higher than or equal to `event_level` as events as long as the logger itself is set to output records of those log levels (see note below). If a value of `None` occurs, the SDK won't send log records as events.

## Ignoring Specific Loggers

Sometimes a logger is extremely noisy and spams you with pointless errors. You can ignore that logger by calling `ignore_logger`:

```python
from sentry_sdk.integrations.logging import ignore_logger

ignore_logger("a.spammy.logger")

logger = logging.getLogger("a.spammy.logger")
logger.error("hi")  # no error sent to sentry
```

You can also use `before-send` and `before-breadcrumb` to ignore only certain messages. See [Filtering Events](https://docs.sentry.io/platforms/python/configuration/filtering/) for more information.

## Advanced Usage

Instead of using `LoggingIntegration`, you can use two regular logging `logging.Handler` subclasses that the integration exports.

**Usually, you don't need this.** You _can_ use this together with `default_integrations=False` if you want to opt into what the Sentry Python SDK captures. However, correctly setting up logging is difficult. Also, an opt-in approach to capture data will miss errors you may not think of on your own.

See the [API documentation](https://getsentry.github.io/sentry-python/integrations.html#module-sentry_sdk.integrations.logging) for more information.