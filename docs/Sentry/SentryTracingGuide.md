# Span Data Conventions

The Span Interface specifies a series of _timed_ application events that have a start and end time. Below describes the conventions for the Span interface for the `data` field on the span.

The `data` field on the span is expected to follow [OpenTelemetry's semantic conventions for attributes](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/general/trace.md) as much as possible.

Keys on the `data` field should be lower-case and use underscores instead of camel-case. There are some exceptions to this, but these exist because of backwards compatibility.

Below describes the conventions for the Span interface for the `data` field on the span that are currently used by the product or are important to bring up.

| Attribute           | Type   | Description                                                                                                   | Examples                                           |
|---------------------|--------|---------------------------------------------------------------------------------------------------------------|----------------------------------------------------|
| `code.filepath`     | string | The source code file name that identifies the code unit as uniquely as possible (preferably an absolute file path). | `/app/myapplication/http/handler/server.py`        |
| `code.lineno`       | number | The line number in `code.filepath` best representing the operation. It SHOULD point within the code unit named in `code.function` | `42`                                               |
| `code.function`     | string | The method or function name, or equivalent (usually rightmost part of the code unit's name).                 | `server_request`                                   |
| `code.namespace`    | string | The "namespace" within which `code.function` is defined. Usually the qualified class or module name, such that `code.namespace` + some separator + `code.function` form a unique identifier for the code unit. | `http.handler`                                     |

| Attribute                 | Type   | Description                                              | Examples                          |
|---------------------------|--------|----------------------------------------------------------|-----------------------------------|
| `http.query`             | string | The Query string present in the URL.                     | `?foo=bar&bar=baz`                |
| `http.fragment`          | string | The Fragments present in the URI (Browser SDKs only).    | `#details`                        |
| `http.request.method`     | string | The HTTP method used.                                    | `GET`                             |
| `http.response.status_code` | int   | The status HTTP response.                               | `404`                             |
| `http.response_content_length` | number | The encoded body size of the response (in bytes).       | `123`                             |
| `http.decoded_response_content_length` | number | The decoded body size of the response (in bytes).       | `456`                             |
| `http.response_transfer_size` | number | The transfer size of the response (in bytes).           | `789`                             |
| `server.address`          | string | URL domain name.                                         | `example.com`                     |
| `server.port`             | int    | URL server port number                                   | `8080`                            |

| Attribute           | Type         | Description                                                                                | Examples                  |
|---------------------|--------------|--------------------------------------------------------------------------------------------|---------------------------|
| `blocked_main_thread` | boolean    | Whether the main thread was blocked by the span.                                          | `true`                    |
| `call_stack`        | StackFrame[] | The most relevant stack frames, that lead to the File I/O span. The stack frame should adhere to the [StackFrame](https://develop.sentry.dev/sdk/data-model/event-payloads/stacktrace/#frame-attributes) interface. |                           |
| `url`               | string       | The URL of the resource that was fetched.                                                 | `https://example.com`     |
| `type`              | string       | More granular type of the operation happening.                                            | `fetch`                   |
| `frames.total`      | int          | The number of total frames rendered during the lifetime of the span.                      | `60`                      |
| `frames.slow`       | int          | The number of slow frames rendered during the lifetime of the span.                       | `2`                       |
| `frames.frozen`     | int          | The number of frozen frames rendered during the lifetime of the span.                     | `1`                       |
| `frames.delay`      | number       | The sum of all delayed frame durations in seconds during the lifetime of the span. For more information see [frames delay](https://develop.sentry.dev/sdk/performance/frames-delay/). | `1.3246`                  |

| Attribute                           | Type   | Description                                                 | Examples                |
|-------------------------------------|--------|-------------------------------------------------------------|-------------------------|
| `url`                               | string | The URL of the resource that was fetched.                  | `https://example.com`   |
| `type`                              | string | The type of the resource that was fetched.                 | `xhr`                   |
| `resource.render_blocking_status`   | string | The render blocking status of the resource.                | `non-blocking`          |

| Attribute                 | Type    | Description                                                                                    | Examples |
|---------------------------|---------|------------------------------------------------------------------------------------------------|----------|
| `ui.contributes_to_ttid` | boolean | Whether the span execution contributed to the TTID (time to initial display) metric.           | `true`   |
| `ui.contributes_to_ttfd` | boolean | Whether the span execution contributed to the TTFD (time to fully drawn) metric.               | `true`   |

| Attribute               | Type   | Description                                                                                                                                                                                                          | Examples      |
|-------------------------|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| `db.system`            | string | An identifier for the database management system (DBMS) product being used. See [OpenTelemetry docs for a list of well-known identifiers](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/database/database-spans.md#notes-and-well-known-identifiers-for-dbsystem). | `postgresql`  |
| `db.operation`         | string | The name of the operation being executed, e.g. the MongoDB command name such as findAndModify, or the SQL keyword. Based on [OpenTelemetry's common db attributes](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/database/database-spans.md#common-attributes)              | `SELECT`      |
| `db.collection.name`   | string | The name of the collection (or table, etc) being queried.                                                                                                                                                            | `users`       |
| `db.name`              | string | This attribute is used to report the name of the database being accessed. For commands that switch the database, this should be set to the target database (even if the command fails).                                | `customers`   |
| `server.address`       | string | Name of the database host.                                                                                                                                                                                           | `example.com` |
| `server.port`          | int    | Logical server port number host.                                                                                                                                                                                    | `8080`        |
| `server.socket.address`| string | Physical server IP address or Unix socket address. host.                                                                                                                                                             | `10.5.3.2`    |
| `server.socket.port`   | int    | Physical server port. host.                                                                                                                                                                                         | `16456`       |

| Attribute        | Type   | Description                                        | Examples |
|------------------|--------|----------------------------------------------------|----------|
| `cache.hit`      | boolean| If the cache was hit during this span.            | `true`   |
| `cache.item_size`| int    | The size of the requested item in the cache. In bytes. | 58       |

| Attribute                    | Type   | Description                                                                     | Examples                               |
|-----------------------------|--------|---------------------------------------------------------------------------------|----------------------------------------|
| `ai.input_messages`         | string | The input messages sent to the model                                            | `[{"role": "user", "message": "hello"}]` |
| `ai.completion_tоkens.used` | int    | The number of tokens used to respond to the message                             | `10`                                   |
| `ai.prompt_tоkens.used`     | int    | The number of tokens used to process just the prompt                            | `20`                                   |
| `ai.total_tоkens.used`      | int    | The total number of tokens used to process the prompt                           | `30`                                   |
| `ai.model_id`               | list   | The vendor-specific ID of the model used                                        | `"gpt-4"`                              |
| `ai.streaming`              | boolean| Whether the request was streamed back                                           | `true`                                 |
| `ai.responses`              | list   | The response messages sent back by the AI model                                 | `["hello", "world"]`                  |

| Attribute     | Type   | Description                                              | Examples |
|---------------|--------|----------------------------------------------------------|----------|
| `thread.id`   | string | Identifier of a thread from where the span originated.  | `123456` |
| `thread.name` | string | Label identifying a thread from where the span originated. | `main`   |

Names that SDKs are still sending so we cannot remove them yet, but should not be used in new code:

| Attribute              | New name                        |
|------------------------|---------------------------------|
| `method`              | `http.request.method`            |
| `http.method`         | `http.request.method`            |
| `Encoded Body Size`   | `http.response_content_length`   |
| `Decoded Body Size`   | `http.decoded_response_body_length` |
| `Transfer Size`       | `http.response_transfer_size`    |

---

# Sentry Python Tracing Guide

## Learn how to manually instrument your code to use Sentry's Requests module.

As a prerequisite to setting up [Requests](https://docs.sentry.io/product/insights/requests/), you’ll need to first [set up tracing](https://docs.sentry.io/platforms/python/tracing/). Once this is done, the Python SDK will automatically instrument outgoing HTTP requests made via `HTTPConnection` and show the data in the [requests-monitoring dashboard](https://sentry.io/orgredirect/organizations/:orgslug/insights/backend/http/). If that doesn't fit your use case, you can set up using custom instrumentation described below.

For detailed information about which data can be set, see the [Requests Module developer specifications](https://develop.sentry.dev/sdk/performance/modules/requests/).

NOTE: Refer to [HTTP Span Data Conventions](https://develop.sentry.dev/sdk/performance/span-data-conventions/#http) for a full list of the span data attributes.

Here is an example of an instrumented function that makes HTTP requests (code is preserved exactly):

```python
from urllib.parse import urlparse
import requests

def make_request(method, url):
    span = sentry_sdk.start_span(
        op="http.client",
        name="%s %s" % (method, url),
    )

    span.set_data("http.request.method", method)

    parsed_url = urlparse(url)
    span.set_data("url", url)
    span.set_data("server.address", parsed_url.hostname)
    span.set_data("server.port", parsed_url.port)

    response = requests.request(method=method, url=url)

    span.set_data("http.response.status_code", response.status_code)
    span.set_data("http.response_content_length", response.headers["content-length"])

    span.finish()

    return response

```

---

# Sentry SDK Development

The SDK should auto-instrument all outgoing HTTP requests, regardless of the library that issues the requests. Each outgoing request should result in a span. The Requests module is technology agnostic, it only cares about span data properties.

| Attribute     | Description                                                                                                          | Notes                                                                                                   |
|---------------|----------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `op`          | Always `"http.client"`                                                                                                | Required                                                                                               |
| `description` | A string including the HTTP request method, and the partial URL. e.g., `"GET https://example.com/data.json"`         | Required [1](#user-content-fn-1)                                                                       |
| `data`        | A key-value mapping of span attributes. (e.g., `{"http.query": "filter=all", "server.address": "prod-2.example.com"}`)| Required for full experience. See [Span Data](#span-data) for details                                  |

None of the span data fields are hard requirements, but attaching as many of them as possible is a more future-proof approach. We recommend that the SDK adds every attribute listed in the [HTTP Span Data Conventions](https://develop.sentry.dev/sdk/performance/span-data-conventions/#http). The minimal requirements are:

- `server.address` must be set to allow correct domain grouping _for descriptions containing relative URLs_. e.g., the description `"GET /data.json"` is missing a domain. In this case, `server.address` must be set. If the span description contains the partial URL, `span.server` can be omitted.
- `http.response.status_code` must be set to enable response code breakdowns.

Consider a website called "App Ex", running on `app.example.com`. This JavaScript code that issues an HTTP request from the browser:

Should result in the following span, assuming the request was successful:

```json
{
  "description": "GET /data.json?user=1",
  "op": "http.client",
  "data": {
    "http.query": "user=1",
    "http.request_method": "GET",
    "http.response.status_code": 200,
    "http.fragment": "",
    "server.address": "app.example.com",
    "server.port": 8080,
    ... other span properties
  }
}
```

1. The HTTP method must be one of the [known HTTP request methods](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods) [↩](#user-content-fnref-1)
