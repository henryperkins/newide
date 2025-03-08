# Sentry SDK Python Guide

## Overview

The Sentry SDK for Python does a very good job of auto-instrumenting your application. If you use one of the popular frameworks, we've got you covered because well-known operations like HTTP calls and database queries will be instrumented out of the box. The Sentry SDK will also check your installed Python packages and auto-enable the matching SDK integrations. If you want to enable tracing in a piece of code that performs some other operations, add the `@sentry_sdk.trace` decorator.

Adding transactions will allow you to instrument and capture certain regions of your code.

## Creating Transactions

The following example creates a transaction for an expensive operation (in this case, `eat_pizza`), and then sends the result to Sentry:

```python
import sentry_sdk

def eat_slice(slice):
    ...

def eat_pizza(pizza):
    with sentry_sdk.start_transaction(op="task", name="Eat Pizza"):
        while pizza.slices > 0:
            eat_slice(pizza.slices.pop())
```

The [API reference](https://getsentry.github.io/sentry-python/api.html#sentry_sdk.api.start_transaction) documents `start_transaction` and all its parameters.

## Adding Child Spans

If you want to have more fine-grained performance monitoring, you can add child spans to your transaction. This can be done by either:

- Using a context manager
- Using a decorator (this works on sync and async functions)
- Manually starting and finishing a span

Calling `sentry_sdk.start_span()` will find the current active transaction and attach the span to it.

### Using a Context Manager

```python
import sentry_sdk

def eat_slice(slice):
    ...

def eat_pizza(pizza):
    with sentry_sdk.start_transaction(op="task", name="Eat Pizza"):
        while pizza.slices > 0:
            with sentry_sdk.start_span(name="Eat Slice"):
                eat_slice(pizza.slices.pop())
```

### Using a Decorator

```python
import sentry_sdk

@sentry_sdk.trace
def eat_slice(slice):
    ...

def eat_pizza(pizza):
    with sentry_sdk.start_transaction(op="task", name="Eat Pizza"):
        while pizza.slices > 0:
            eat_slice(pizza.slices.pop())
```

### Manually Starting and Finishing a Span

```python
import sentry_sdk

def eat_slice(slice):
    ...

def eat_pizza(pizza):
    with sentry_sdk.start_transaction(op="task", name="Eat Pizza"):
        while pizza.slices > 0:
            span = sentry_sdk.start_span(name="Eat Slice")
            eat_slice(pizza.slices.pop())
            span.finish()
```

When you create your span manually, make sure to call `span.finish()` after the block of code you want to wrap in a span to finish the span. If you do not finish the span it will not be sent to Sentry.

## Nesting Spans

Spans can be nested to form a span tree. If you'd like to learn more, read our [distributed tracing](https://docs.sentry.io/product/sentry-basics/tracing/distributed-tracing/) documentation.

### Using a Context Manager

```python
import sentry_sdk

def chew():
    ...

def eat_slice(slice):
    with sentry_sdk.start_span(name="Eat Slice"):
        with sentry_sdk.start_span(name="Chew"):
            chew()
```

### Using a Decorator

```python
import sentry_sdk

@sentry_sdk.trace
def chew():
    ...

@sentry_sdk.trace
def eat_slice(slice):
    chew()
```

### Manually Starting and Finishing a Span

```python
import sentry_sdk

def chew():
    ...

def eat_slice(slice):
    parent_span = sentry_sdk.start_span(name="Eat Slice")

    child_span = parent_span.start_child(name="Chew")
    chew()
    child_span.finish()

    parent_span.finish()
```

The parameters of `start_span()` and `start_child()` are the same. See the [API reference](https://getsentry.github.io/sentry-python/api.html#sentry_sdk.api.start_span) for more details.

When you create your span manually, make sure to call `span.finish()` after the block of code you want to wrap in a span to finish the span. If you do not finish the span it will not be sent to Sentry.

## Automatic Instrumentation

To avoid having custom performance instrumentation code scattered all over your code base, pass a parameter `functions_to_trace` to your `sentry_sdk.init()` call.

```python
import sentry_sdk

functions_to_trace = [
    {"qualified_name": "myrootmodule.eat_slice"},
    {"qualified_name": "myrootmodule.swallow"},
    {"qualified_name": "myrootmodule.chew"},
    {"qualified_name": "myrootmodule.someothermodule.another.some_function"},
    {"qualified_name": "myrootmodule.SomePizzaClass.some_method"},
]

sentry_sdk.init(
    dsn="https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
    functions_to_trace=functions_to_trace,
)
```

Now, whenever a function specified in `functions_to_trace` is executed, a span will be created and attached as a child to the currently running span.

## Modifying Transactions and Spans

The `sentry_sdk.get_current_scope().transaction` property returns the active transaction or `None` if no transaction is active. You can use this property to modify data on the transaction.

```python
import sentry_sdk

def eat_pizza(pizza):
    transaction = sentry_sdk.get_current_scope().transaction

    if transaction is not None:
        transaction.set_tag("num_of_slices", len(pizza.slices))

    while pizza.slices > 0:
        eat_slice(pizza.slices.pop())
```

To change data in the current span, use `sentry_sdk.get_current_span()`. This function will return a span if there's one running, otherwise it will return `None`.

In this example, we'll set a tag in the span created by the `@sentry_sdk.trace` decorator.

```python
import sentry_sdk

@sentry_sdk.trace
def eat_slice(slice):
    span = sentry_sdk.get_current_span()

    if span is not None:
        span.set_tag("slice_id", slice.id)
```

## Adding Data Attributes

You can add data attributes to your transactions. This data is visible in the trace explorer in Sentry. Data attributes can be of type `string`, `number` or `boolean`, as well as (non-mixed) arrays of these types:

```python
with sentry_sdk.start_transaction(name="my-transaction") as transaction:
    transaction.set_data("my-data-attribute-1", "value1")
    transaction.set_data("my-data-attribute-2", 42)
    transaction.set_data("my-data-attribute-3", True)

    transaction.set_data("my-data-attribute-4", ["value1", "value2", "value3"])
    transaction.set_data("my-data-attribute-5", [42, 43, 44])
    transaction.set_data("my-data-attribute-6", [True, False, True])
```

You can add data attributes to your spans the same way, with the same type restrictions as described above.

```python
with sentry_sdk.start_span(name="my-span") as span:
    span.set_data("my-data-attribute-1", "value1")
    span.set_data("my-data-attribute-2", 42)
    span.set_data("my-data-attribute-3", True)

    span.set_data("my-data-attribute-4", ["value1", "value2", "value3"])
    span.set_data("my-data-attribute-5", [42, 43, 44])
    span.set_data("my-data-attribute-6", [True, False, True])
```

To attach data attributes to the transaction and all its spans, you can use [`before_send_transaction`](https://docs.sentry.io/platforms/python/configuration/filtering/#using-before-send-transaction):

```python
def my_before_send_transaction(event, hint):
    # Set the data attribute "foo" to "bar" on every span belonging to this
    # transaction event
    for span in event["spans"]:
        span["data"]["foo"] = "bar"

    # Set the data on the transaction itself, too
    event["contexts"]["trace"]["data"]["foo"] = "bar"

    return event

sentry_sdk.init(
    traces_sample_rate=1.0,
    before_send_transaction=my_before_send_transaction,
)
```

## Contributing

Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").