### Overview

The FastAPI integration adds support for the [FastAPI Framework](https://fastapi.tiangolo.com/).

### Installation

Install `sentry-sdk` from PyPI with the `fastapi` extra:

```bash
pip install --upgrade 'sentry-sdk[fastapi]'
```

If you have the `fastapi` package in your dependencies, the FastAPI integration will be enabled automatically when you initialize the Sentry SDK.

### Configuration

#### Basic Configuration

Initialize Sentry with the necessary configuration:

```python
import sentry_sdk

sentry_sdk.init(
    dsn="https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
    # Add data like request headers and IP for users, if applicable;
    # see https://docs.sentry.io/platforms/python/data-management/data-collected/ for more info
    send_default_pii=True,
    # Set traces_sample_rate to 1.0 to capture 100%
    # of transactions for tracing.
    traces_sample_rate=1.0,
    # Set profiles_sample_rate to 1.0 to profile 100%
    # of sampled transactions.
    # We recommend adjusting this value in production.
    profiles_sample_rate=1.0,
)
```

#### Minimal Example to Trigger an Error

```python
from fastapi import FastAPI

sentry_sdk.init(...)  # same as above

app = FastAPI()

@app.get("/sentry-debug")
async def trigger_error():
    division_by_zero = 1 / 0
```

When you point your browser to [http://localhost:8000/sentry-debug](http://localhost:8000/sentry-debug) a transaction will be created in the Performance section of [sentry.io](https://sentry.io/). Additionally, an error event will be sent to [sentry.io](https://sentry.io/) and will be connected to the transaction.

It takes a couple of moments for the data to appear in [sentry.io](https://sentry.io/).

### Available Data

The following information about your FastAPI project will be available to you on Sentry.io:

- By default, all exceptions leading to an Internal Server Error are captured and reported. The HTTP status codes to report on are configurable via the `failed_request_status_codes` [option](#options).
- Request data such as URL, HTTP method, headers, form data, and JSON payloads is attached to all issues.
- Sentry excludes raw bodies and multipart file uploads.
- Sentry also excludes personally identifiable information (such as user ids, usernames, cookies, authorization headers, IP addresses) unless you set `send_default_pii` to `True`.

### Components Monitored

- Middleware stack
- Middleware `send` and `receive` callbacks
- Database queries
- Redis commands

### Advancaed Usage

By adding `FastApiIntegration` to your `sentry_sdk.init()` call explicitly, you can set options for `FastApiIntegration` to change its behavior. Because FastAPI is based on the Starlette framework, both integrations, `StarletteIntegration` and `FastApiIntegration`, must be instantiated.

```python
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration

sentry_sdk.init(
    # same as above
    integrations=[
        StarletteIntegration(
            transaction_style="endpoint",
            failed_request_status_codes={403, *range(500, 599)},
            http_methods_to_capture=("GET",),
        ),
        FastApiIntegration(
            transaction_style="endpoint",
            failed_request_status_codes={403, *range(500, 599)},
            http_methods_to_capture=("GET",),
        ),
    ]
)

```

You can pass the following keyword arguments to `StarletteIntegration()` and `FastApiIntegration()`:


`transaction_style`: This option lets you influence how the transactions are named in Sentry. For example:

```python
import sentry_sdk
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration

sentry_sdk.init(
    # ...
    integrations=[
        StarletteIntegration(
            transaction_style="endpoint",
        ),
        FastApiIntegration(
            transaction_style="endpoint",
        ),
    ],
)

app = FastAPI()

@app.get("/catalog/product/{product_id}")
async def product_detail(product_id):
    return {...}

```

In the above code, the transaction name will be:

`"/catalog/product/{product_id}"` if you set `transaction_style="url"`
`"product_detail"` if you set `transaction_style="endpoint"`

The default is `"url"`.

- `failed_request_status_codes`:

A `set` of integers that will determine which status codes should be reported to Sentry.

The `failed_request_status_codes` option determines whether [`HTTPException`](https://fastapi.tiangolo.com/reference/exceptions/?h=httpexception) exceptions should be reported to Sentry. Unhandled exceptions that don't have a `status_code` attribute will always be reported to Sentry.

Examples of valid `failed_request_status_codes`:

- `{500}` will only send events on HTTP 500.
- `{400, *range(500, 600)}` will send events on HTTP 400 as well as the 5xx range.
- `{500, 503}` will send events on HTTP 500 and 503.
- `set()` (the empty set) will not send events for any HTTP status code.

The default is `{*range(500, 600)}`, meaning that all 5xx status codes are reported to Sentry.

- `http_methods_to_capture`:

A tuple containing all the HTTP methods that should create a transaction in Sentry.

The default is `("CONNECT", "DELETE", "GET", "PATCH", "POST", "PUT", "TRACE",)`.

(Note that `OPTIONS` and `HEAD` are missing by default.)

- FastAPI: 0.79.0+
- Python: 3.7+