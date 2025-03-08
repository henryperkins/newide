# [[Sentry Event Attachments]]

**Path**: Sentry Event Attachments.md  

---

```yaml
title: Attachments
description: "Learn more about how Sentry can store additional files in the same request as event attachments."
```

Sentry can enrich your events for further investigation by storing additional files, such as config or log files, as attachments.

## Uploading Attachments

<PlatformContent includePath="enriching-events/add-attachment" />

> [!NOTE]
> **Sentry allows at most 20MB for a compressed request, and at most 100MB of uncompressed attachments per event, including the crash report file (if applicable).**  
> Uploads exceeding this size are rejected with HTTP error `413 Payload Too Large` and the data is dropped immediately.  
> To add larger or more files, consider secondary storage options.

Attachments persist for 30 days; if your total storage included in your quota is exceeded, attachments will not be stored. You can delete attachments or their containing events at any time. Deleting an attachment does not affect your quota — Sentry counts an attachment toward your quota as soon as it is stored.

Learn more about how attachments impact your [quota](/pricing/quotas/).

### Access to Attachments

To limit access to attachments, navigate to your organization's **General Settings**, then select the _Attachments Access_ dropdown to set appropriate access — any member of your organization, the organization billing owner, member, admin, manager, or owner.

<Include name="common-imgs/attachments-access" />

By default, access is granted to all members when storage is enabled. If a member does not have access to the project, the ability to download an attachment is not available; the button will be greyed out in Sentry. The member may only view that an attachment is stored.

## Viewing Attachments

Attachments display on the bottom of the **Issue Details** page for the event that is shown.

<Include name="common-imgs/attachments-access-denied" />

Alternately, attachments also appear in the _Attachments_ tab on the **Issue Details** page, where you can view the _Type_ of attachment, as well as associated events. Click the Event ID to open the **Issue Details** of that specific event.

<Include name="common-imgs/attachments-list-example" />

---

```yaml
title: Breadcrumbs
description: "Learn more about what Sentry uses to create a trail of events (breadcrumbs) that happened prior to an issue."
```

Sentry uses _breadcrumbs_ to create a trail of events that happened prior to an issue. These events are very similar to traditional logs, but can record richer structured data.

This page provides an overview of manual breadcrumb recording and customization. Learn more about the information that displays on the **Issue Details** page and how you can filter breadcrumbs to quickly resolve issues in [Using Breadcrumbs](/product/error-monitoring/breadcrumbs).

> [!TIP]  
> **Learn about SDK usage**  
> Developers who want to modify the breadcrumbs interface can learn more in our [developer documentation about the Breadcrumbs Interface](https://develop.sentry.dev/sdk/data-model/event-payloads/breadcrumbs/).

## Manual Breadcrumbs

You can manually add breadcrumbs whenever something interesting happens. For example, you might manually record a breadcrumb if the user authenticates or another state change occurs.

Manually record a breadcrumb:

<PlatformContent includePath="enriching-events/breadcrumbs/breadcrumbs-example" />

The available breadcrumb keys are `type`, `category`, `message`, `level`, `timestamp` (which many SDKs will set automatically for you), and `data`, which is the place to put any additional information you'd like the breadcrumb to include. Using keys other than these six won't cause an error, but will result in the data being dropped when the event is processed by Sentry.

## Automatic Breadcrumbs

<PlatformContent includePath="enriching-events/breadcrumbs/automatic-breadcrumbs" />

## Customize Breadcrumbs

SDKs allow you to customize breadcrumbs through the <PlatformIdentifier name="before-breadcrumb" /> hook.

This hook is passed an already assembled breadcrumb and, in some SDKs, an optional hint. The function can modify the breadcrumb or decide to discard it entirely by returning `null`:

<PlatformContent includePath="enriching-events/breadcrumbs/before-breadcrumb" />

For information about what can be done with the hint, see <PlatformLink to="/configuration/filtering/#using-hints">Filtering Events</PlatformLink>.

---

```yaml
title: Context
description: "Custom contexts allow you to attach arbitrary data (strings, lists, dictionaries) to an event."
```

Custom contexts allow you to attach arbitrary data to an event. Often, this context is shared among any issue captured in its lifecycle. You cannot search these, but they are viewable on the issue page:

<Include name="common-imgs/additional_data" />

> [!WARNING]
> If you need to be able to search on custom data, [use tags](../tags) instead.

## Structured Context

The best way to attach custom data is with a structured context. A context must always be an object and its values can be arbitrary.

Then, use <PlatformIdentifier name="set-context" /> and give the context a unique name:

<PlatformContent includePath="enriching-events/set-context" />

There are no restrictions on context name. In the context object, all keys are allowed except for `type`, which is used internally.

Learn more about conventions for common contexts in the [contexts interface developer documentation](https://develop.sentry.dev/sdk/data-model/event-payloads/contexts/).

## Size Limitations

When sending context, _consider payload size limits_. Sentry does not recommend sending the entire application state and large data blobs in contexts. If you exceed the maximum payload size, Sentry will respond with HTTP error `413 Payload Too Large` and reject the event.

The Sentry SDK will try its best to accommodate the data you send and trim large context payloads. Some SDKs can truncate parts of the event; for more details, see the [developer documentation on SDK data handling](https://develop.sentry.dev/sdk/expected-features/data-handling/).

## Additional Data

**Additional Data is deprecated** in favor of structured contexts.

Sentry used to support adding unstructured "Additional Data" via <PlatformIdentifier name="set-extra" />.

---

```yaml
title: Scopes
description: "SDKs will typically automatically manage the scopes for you in the framework integrations. Learn what a scope is and how you can use it to your advantage."
```

Scopes store extra data that the SDK adds to your event when sending the event to Sentry. While the SDKs typically manage the scope automatically, understanding how scopes work and how you can manage them manually can be helpful.

## What is a Scope?

A scope manages an event's data. For instance, the SDK stores [contexts](../context/) and [breadcrumbs](../breadcrumbs/) on the scope.

There are three types of scopes. Exactly one scope of each type will be active at a specific point in time.

- **Global scope**: A single globally-shared scope storing data relevant for the whole app (such as the release).  
- **Isolation scope**: Thread-local scope created for each request-response lifecycle to store data relevant to the request.  
- **Current scope**: Thread-local scope created for each span to store data relevant to the span.

The SDK and the SDK's built-in integrations automatically manage the scopes. For example, web framework integrations create an isolation scope for each request handled. When you call a top-level API function, such as <PlatformIdentifier name="set-tag" />, the SDK determines the correct scope on which to operate.

When sending an event to Sentry, the final data applied to the event is the result of merging the three scopes, applying data from each in turn. The global scope is applied first, followed by the isolation scope, and then the current scope.

## Changing the Scope

We generally recommend using the top-level API to manage your scopes, since the SDK's automatic scope management handles most use cases.

However, if your use case requires direct access to the scope object, you can use the <PlatformIdentifier name="new-scope" /> context manager. <PlatformIdentifier name="new-scope" /> forks the current scope, allows you to modify the new scope while the context manager is active, and restores the original scope afterwards. Using <PlatformIdentifier name="new-scope" /> allows you to send data for only one specific event, such as [modifying the context](../context/). It is roughly equivalent to the <PlatformIdentifier name="push-scope" /> context manager in earlier (1.x) versions of the SDK.

> [!CAUTION]
> Avoid calling top-level APIs inside the <PlatformIdentifier name="new-scope" /> context manager. The top-level API might interact with a different scope from what <PlatformIdentifier name="new-scope" /> yields, causing unintended results. While within the <PlatformIdentifier name="new-scope" /> context manager, please call methods directly on the scope that <PlatformIdentifier name="new-scope" /> yields!

Using <PlatformIdentifier name="new-scope" /> allows you to attach additional information, such as adding custom tags or informing Sentry about the currently authenticated user.

<PlatformContent includePath="enriching-events/scopes/configure-scope" />

You can also apply this configuration when unsetting a user at logout:

<PlatformContent includePath="enriching-events/unset-user" />

To learn what useful information can be associated with scopes, see [the context documentation](../context/).

---

```yaml
title: Tags
description: "Tags power UI features such as filters and tag-distribution maps. Tags also help you quickly access related events and view the tag distribution for a set of events."
```

**Tags** are key/value string pairs that are both indexed and searchable. Tags power features in sentry.io such as filters and tag-distribution maps. Tags also help you quickly access related events and view the tag distribution for a set of events. Common uses for tags include hostname, platform version, and user language.

We’ll automatically index all tags for an event, as well as the frequency and the last time that Sentry has seen a tag. We also keep track of the number of distinct tags and can assist you in determining hotspots for various issues.

- _Tag keys_ have a maximum length of 32 characters and can contain only letters (`a-zA-Z`), numbers (`0-9`), underscores (`_`), periods (`.`), colons (`:`), and dashes (`-`).  
- _Tag values_ have a maximum length of 200 characters and they cannot contain the newline (`\n`) character.

Defining tags is easy, and will bind them to the [isolation scope](../scopes/) ensuring all future events within scope contain the same tags.

Tags can be set with the `set_tag` function:

<PlatformContent includePath="enriching-events/set-tag" />

Alternatively, multiple tags can be set at once with the `set_tags` function:

```python
from sentry_sdk import set_tags

set_tags({"page.locale": "de-at", "page.type": "article"})
```

> [!IMPORTANT]
> Some tags are automatically set by Sentry. We strongly recommend against overwriting these [tags](/concepts/search/searchable-properties/#search-properties). Instead, name your tags with your organization's nomenclature. If you overwrite an automatically set tag, you must use [explicit tag syntax](/concepts/search/#explicit-tag-syntax) to search for it.

Once you've started sending tagged data, you'll see it when logged in to sentry.io. There, you can view the filters within the sidebar on the Project page, summarized within an event, and on the Tags page for an aggregated event.

<Include name="common-imgs/tags" />

---

```yaml
title: Transaction Name
description: "Learn how to set or override the transaction name to capture the user and gain critical pieces of information that construct a unique identity in Sentry."
```

The current transaction name is used to group transactions in our [Insights](/product/insights/) product, as well as annotate error events with their point of failure.

The transaction name can reference the current web app route, or the current task being executed. For example:  
- `GET /api/{version}/users/`  
- `UserListView`  
- `myapp.tasks.renew_all_subscriptions`

Ideally, the transaction name does not contain variable values such as user IDs but has rather low cardinality while still uniquely identifying a piece of code you care about.

A lot of our framework integrations already set a transaction name, though you can set one yourself.

To override the name of the currently running transaction:

<PlatformContent includePath="enriching-events/set-transaction-name" />

Please refer to [the tracing documentation](../../tracing/) for how to start and stop transactions.