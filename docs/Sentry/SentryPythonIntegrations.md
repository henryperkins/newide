# Sentry Python Integrations

**Navigation:**
- [Home](https://docs.sentry.io/)
- [Platforms](https://docs.sentry.io/platforms/)
- [Python](https://docs.sentry.io/platforms/python/)
- [Integrations](https://docs.sentry.io/platforms/python/integrations/)

## Overview

Sentry offers additional integrations to modify configurations or add instrumentation to your application. These integrations facilitate the automatic hooking into popular libraries, providing comprehensive data collection out of the box.

---

### Framework Integrations

These integrations automatically instrument popular Python frameworks.

| Integration                      | Auto-enabled |
|-----------------------------------|--------------|
| [Django](https://docs.sentry.io/platforms/python/integrations/django/) | ✓ |
| [Flask](https://docs.sentry.io/platforms/python/integrations/flask/)   | ✓ |
| [FastAPI](https://docs.sentry.io/platforms/python/integrations/fastapi/) | ✓ |
| [AIOHTTP](https://docs.sentry.io/platforms/python/integrations/aiohttp/) | ✓ |
| [Bottle](https://docs.sentry.io/platforms/python/integrations/bottle/)  | ✓ |
| [Falcon](https://docs.sentry.io/platforms/python/integrations/falcon/) | ✓ |
| [Pyramid](https://docs.sentry.io/platforms/python/integrations/pyramid/) | ✓ |
| [Quart](https://docs.sentry.io/platforms/python/integrations/quart/)   | ✓ |
| [Sanic](https://docs.sentry.io/platforms/python/integrations/sanic/)   | ✓ |
| [Starlette](https://docs.sentry.io/platforms/python/integrations/starlette/) | ✓ |
| [Starlite](https://docs.sentry.io/platforms/python/integrations/starlite/) | ✓ |
| [Litestar](https://docs.sentry.io/platforms/python/integrations/litestar/) | |
| [Tornado](https://docs.sentry.io/platforms/python/integrations/tornado/) | ✓ |

---

### Database Integrations

These integrations support popular Python database libraries.

| Integration                                                 | Auto-enabled |
|--------------------------------------------------------------|--------------|
| [asyncpg](https://docs.sentry.io/platforms/python/integrations/asyncpg/) | ✓ |
| [ClickHouse](https://docs.sentry.io/platforms/python/integrations/clickhouse-driver/) | ✓ |
| [MongoDB](https://docs.sentry.io/platforms/python/integrations/pymongo/) | ✓ |
| [Redis](https://docs.sentry.io/platforms/python/integrations/redis/)    | ✓ |
| [SQLAlchemy](https://docs.sentry.io/platforms/python/integrations/sqlalchemy/) | ✓ |

---

### ML and AI Integrations

| Integration                                            | Auto-enabled |
|--------------------------------------------------------|--------------|
| [Anthropic](https://docs.sentry.io/platforms/python/integrations/anthropic/) | ✓ |
| [Huggingface Hub](https://docs.sentry.io/platforms/python/integrations/huggingface_hub/) | ✓ |
| [Langchain](https://docs.sentry.io/platforms/python/integrations/langchain/) | ✓ |
| [OpenAI](https://docs.sentry.io/platforms/python/integrations/openai/)       | ✓ |

---

### Distributed Systems/Task Queues

| Integration                                                 | Auto-enabled |
|--------------------------------------------------------------|--------------|
| [Apache Airflow](https://docs.sentry.io/platforms/python/integrations/airflow/) | |
| [Apache Beam](https://docs.sentry.io/platforms/python/integrations/beam/)     | |
| [Apache Spark](https://docs.sentry.io/platforms/python/integrations/spark/)   | |
| [ARQ](https://docs.sentry.io/platforms/python/integrations/arq/)              | ✓ |
| [Celery](https://docs.sentry.io/platforms/python/integrations/celery/)        | ✓ |
| [Dramatiq](https://docs.sentry.io/platforms/python/integrations/dramatiq/)    | |
| [huey](https://docs.sentry.io/platforms/python/integrations/huey/)             | ✓ |
| [RQ](https://docs.sentry.io/platforms/python/integrations/rq/)                | ✓ |
| [Ray](https://docs.sentry.io/platforms/python/integrations/ray/)              | ✓ |

---

### Feature Flags

| Integration                                               | Auto-enabled |
|-----------------------------------------------------------|--------------|
| [LaunchDarkly](https://docs.sentry.io/platforms/python/integrations/launchdarkly/) | |
| [OpenFeature](https://docs.sentry.io/platforms/python/integrations/openfeature/)   | |
| [Statsig](https://docs.sentry.io/platforms/python/integrations/statsig/)           | |
| [Unleash](https://docs.sentry.io/platforms/python/integrations/unleash/)           | |

---

### Cloud Functions and Hosting

| Integration                                                            | Auto-enabled |
|------------------------------------------------------------------------|--------------|
| [AWS Lambda](https://docs.sentry.io/platforms/python/integrations/aws-lambda/)  | |
| [Boto3](https://docs.sentry.io/platforms/python/integrations/boto3/)            | ✓ |
| [Chalice](https://docs.sentry.io/platforms/python/integrations/chalice/)        | ✓ |
| [Cloud Resource Context](https://docs.sentry.io/platforms/python/integrations/cloudresourcecontext/) | ✓ |
| [Google Cloud Functions](https://docs.sentry.io/platforms/python/integrations/gcp-functions/) | ✓ |
| [Serverless Framework](https://docs.sentry.io/platforms/python/integrations/serverless/) | ✓ |

---

### HTTP Libraries

| Integration                                                        | Auto-enabled |
|--------------------------------------------------------------------|--------------|
| [AIOHTTP Client](https://docs.sentry.io/platforms/python/integrations/aiohttp/aiohttp-client/) | ✓ |
| [HTTPX](https://docs.sentry.io/platforms/python/integrations/httpx/) | ✓ |
| Python standard HTTP client (in the [Default Integrations](https://docs.sentry.io/platforms/python/integrations/default-integrations/#stdlib)) | ✓ |
| Requests HTTP instrumentation is done via the [Default Integrations](https://docs.sentry.io/platforms/python/integrations/default-integrations/#stdlib). | ✓ |

---

### GraphQL Support

| Integration                                             | Auto-enabled |
|---------------------------------------------------------|--------------|
| [Ariadne](https://docs.sentry.io/platforms/python/integrations/ariadne/) | ✓ |
| [GQL](https://docs.sentry.io/platforms/python/integrations/gql/)         | ✓ |
| [Graphene](https://docs.sentry.io/platforms/python/integrations/graphene/) | ✓ |
| [Strawberry](https://docs.sentry.io/platforms/python/integrations/strawberry/) | ✓ |

---

### Logging and Metrics

| Integration                                            | Auto-enabled |
|--------------------------------------------------------|--------------|
| [Logging](https://docs.sentry.io/platforms/python/integrations/logging/) | ✓ |
| [Loguru](https://docs.sentry.io/platforms/python/integrations/loguru/)   | ✓ |

---

## Configuring Integrations

Integrations can be added using the [`integrations`](https://docs.sentry.io/platforms/python/configuration/options/#integrations) configuration option.

1. **Automatic Enabling**:
   - Integrations marked as "auto-enabled" in the above table will be activated automatically unless you set [`auto_enabling_integrations`](https://docs.sentry.io/platforms/python/configuration/options/#auto-enabling-integrations) to `False`.
   - To customize a specific integration's settings (e.g., changing Flask's default `transaction_style`), add it to your `integrations` list as shown below:

```python
import sentry_sdk
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from sentry_sdk.integrations.flask import FlaskIntegration

sentry_sdk.init(
    integrations=[
        # Configuring Flask integration with a custom transaction style
        FlaskIntegration(transaction_style="url"),
        # Manually adding Asyncio integration
        AsyncioIntegration(),
    ],
)
```

2. **Disabling Integrations**:
   - Use the [`disabled_integrations`](https://docs.sentry.io/platforms/python/configuration/options/#disabled-integrations) configuration option to disable an integration:

```python
import sentry_sdk
from sentry_sdk.integrations.flask import FlaskIntegration

sentry_sdk.init(
    disabled_integrations=[
        FlaskIntegration(),
    ],
)
```

3. **Disabling All Auto-Enabling Integrations**:
   - Set [`auto_enabling_integrations`](https://docs.sentry.io/platforms/python/configuration/options/#auto-enabling-integrations) to `False`:

```python
import sentry_sdk
from sentry_sdk.integrations.flask import FlaskIntegration

sentry_sdk.init(
    auto_enabling_integrations=False,
    integrations=[
        FlaskIntegration(),
    ],
)
```

4. **Disabling All Default Integrations**:
   - Set [`default_integrations`](https://docs.sentry.io/platforms/python/configuration/options/#default-integrations) to `False`:

```python
import sentry_sdk
from sentry_sdk.integrations.atexit import AtexitIntegration
from sentry_sdk.integrations.argv import ArgvIntegration
from sentry_sdk.integrations.dedupe import DedupeIntegration
from sentry_sdk.integrations.excepthook import ExcepthookIntegration
from sentry_sdk.integrations.stdlib import StdlibIntegration
from sentry_sdk.integrations.modules import ModulesIntegration
from sentry_sdk.integrations.threading import ThreadingIntegration

sentry_sdk.init(
    default_integrations=False,
    integrations=[
        AtexitIntegration(),
        ArgvIntegration(),
        DedupeIntegration(),
        ExcepthookIntegration(),
        StdlibIntegration(),
        ModulesIntegration(),
        ThreadingIntegration(),
    ],
)
```

By following these guidelines and code examples, you can effectively configure and utilize Sentry's various integrations for your Python applications, ensuring robust monitoring and error tracking.