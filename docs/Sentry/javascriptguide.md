
### Overview

The Loader Script is the easiest way to initialize the Sentry SDK. The Loader Script also automatically keeps your Sentry SDK up to date and offers configuration for different Sentry features.

To use the loader, go in the Sentry UI to **Settings > Projects > (select project) > Client Keys (DSN)**, and then press the "Configure" button. Copy the script tag from the "JavaScript Loader" section and include it as the first script on your page. By including it first, you allow it to catch and buffer events from any subsequent scripts, while still ensuring the full SDK doesn't load until after everything else has run.

```
<script
  src="https://js.sentry-cdn.com/d815bc9d689a9255598e0007ae5a2f67.min.js"
  crossorigin="anonymous"
></script>
```

By default, Tracing and Session Replay are enabled.

To have correct stack traces for minified asset files when using the Loader Script, you will have to either [host your Source Maps publicly](https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/hosting-publicly/) or [upload them to Sentry](https://docs.sentry.io/platforms/javascript/sourcemaps/).

---

### Configuration Options

The loader has a few configuration options:

- What version of the SDK to load
- Using Tracing
- Using Session Replay
- Showing debug logs

To configure the version, use the dropdown in the "JavaScript Loader" settings, directly beneath the script tag you copied earlier.

![JavaScript Loader Settings](https://docs.sentry.io/_next/image/?url=%2Fmdx-images%2Fjs-loader-settings-ZNXIUMHF.png%232346x828&w=3840&q=75)

Note that because of caching, it can take a few minutes for version changes made here to take effect.

---

### Loading the Full SDK

If you only use the Loader for errors, the loader won't load the full SDK until triggered by one of the following:

- an unhandled error  
- an unhandled promise rejection  
- a call to `Sentry.captureException`  
- a call to `Sentry.captureMessage`  
- a call to `Sentry.captureEvent`  

Once one of those occurs, the loader will buffer that event and immediately request the full SDK from our CDN. Any events that occur between that request being made and the completion of SDK initialization will also be buffered, and all buffered events will be sent to Sentry once the SDK is fully initialized.

Alternatively, you can set the loader to request the full SDK earlier: still as part of page load, but _after_ all of the other JavaScript on the page has run. (In other words, in a subsequent event loop.) To do this, include `data-lazy="no"` in your script tag.

```
<script
  src="https://js.sentry-cdn.com/d815bc9d689a9255598e0007ae5a2f67.min.js"
  crossorigin="anonymous"
  data-lazy="no"
></script>
```

Finally, if you want to control the timing yourself, you can call `Sentry.forceLoad()`. You can do this as early as immediately after the loader runs (which has the same effect as setting `data-lazy="no"`) and as late as the first unhandled error, unhandled promise rejection, or call to `Sentry.captureMessage` or `Sentry.captureEvent` (which has the same effect as not calling it at all). Note that you can't delay loading past one of the aforementioned triggering events.

If Tracing and/or Session Replay is enabled, the SDK will immediately fetch and initialize the bundle to make sure it can capture transactions and/or replays once the page loads.

---

### Configuring the SDK

While the Loader Script will work out of the box without any configuration in your application, you can still configure the SDK according to your needs.

• For Tracing, the SDK will be initialized with `tracesSampleRate: 1` by default.  
• For Session Replay, the defaults are `replaysSessionSampleRate: 0.1` and `replaysOnErrorSampleRate: 1`.  

You can configure the release by adding the following to your page:

```
<script>
  window.SENTRY_RELEASE = {
    id: "...",
  };
</script>
```

---

### Custom Init Call

The loader script always includes a call to `Sentry.init` with a default configuration, including your DSN. If you want to [configure your SDK](https://docs.sentry.io/platforms/javascript/configuration/options/) beyond that, you can configure a custom init call by defining a `window.sentryOnLoad` function. Whatever is defined inside of this function will _always_ be called first, before any other SDK method is called.

**Be sure to define this function _before_ you add the loader script, to ensure it can be called at the right time:**

```
<script>
  // Configure sentryOnLoad before adding the Loader Script
  window.sentryOnLoad = function () {
    Sentry.init({
      // add custom config here
    });
  };
</script>

<script
  src="https://js.sentry-cdn.com/d815bc9d689a9255598e0007ae5a2f67.min.js"
  crossorigin="anonymous"
></script>
```

Inside of the `window.sentryOnLoad` function, you can configure a custom `Sentry.init()` call. You can configure your SDK exactly the way you would if you were using the CDN, with one difference: your `Sentry.init()` call doesn't need to include your DSN, since it's already been set. Inside of this function, the full Sentry SDK is guaranteed to be loaded & available.

```
<script>
  // Configure sentryOnLoad before adding the Loader Script
  window.sentryOnLoad = function () {
    Sentry.init({
      release: " ... ",
      environment: " ... "
    });
    Sentry.setTag(...);
    // etc.
  };
</script>
```

---

### Calling Sentry Methods

By default, the loader will make sure you can call these functions directly on `Sentry` at any time, even if the SDK is not yet loaded:

- `Sentry.captureException()`  
- `Sentry.captureMessage()`  
- `Sentry.captureEvent()`  
- `Sentry.addBreadcrumb()`  
- `Sentry.withScope()`  
- `Sentry.showReportDialog()`  

If you want to call any other method when using the Loader, you have to guard it with `Sentry.onLoad()`. Any callback given to `onLoad()` will be called either immediately (if the SDK is already loaded), or later once the SDK has been loaded:

```
 // Guard against window.Sentry not being available, e.g. due to Ad-blockers
 window.Sentry &&
   Sentry.onLoad(function () {
     // Inside of this callback,
     // we guarantee that `Sentry` is fully loaded and all APIs are available
     const client = Sentry.getClient();
     // do something custom here
   });
```

When using the Loader Script with just errors, the script injects the SDK asynchronously. This means that only *unhandled errors* and *unhandled promise rejections* will be caught and buffered before the SDK is fully loaded. Specifically, capturing [breadcrumb data](https://docs.sentry.io/platforms/javascript/enriching-events/breadcrumbs/) will not be available until the SDK is fully loaded and initialized. To reduce the amount of time these features are unavailable, set `data-lazy="no"` or call `forceLoad()` as described above.

If you want to understand the inner workings of the loader itself, you can read the documented source code in all its glory over at the [Sentry repository](https://github.com/getsentry/sentry/blob/master/src/sentry/templates/sentry/js-sdk-loader.ts).

---

### Using a CDN Instead of the Loader Script

Sentry supports loading the JavaScript SDK from a CDN. Generally we suggest using our Loader instead. If you _must_ use a CDN, see [Available Bundles](#available-bundles) below.

To use Sentry for error and tracing, you can use the following bundle:

```
<script
  src="https://browser.sentry-cdn.com/9.5.0/bundle.tracing.min.js"
  integrity="sha384-nsiByevQ25GvAyX+c3T3VctX7x10qZpYsLt3dfkBt04A71M451kWQEu+K4r1Uuk3"
  crossorigin="anonymous"
></script>
```

To use Sentry for error and tracing, as well as for [Session Replay](https://docs.sentry.io/platforms/javascript/session-replay), you can use the following bundle:

```
<script
  src="https://browser.sentry-cdn.com/9.5.0/bundle.tracing.replay.min.js"
  integrity="sha384-o/GEuWSkrvEGEtjN67ud+ssWsPJyX6RPCWqDvd8EE0N5nm6Id38XSS62lM4ETM0O"
  crossorigin="anonymous"
></script>
```

To use Sentry for error monitoring, as well as for [Session Replay](https://docs.sentry.io/platforms/javascript/session-replay), but **not** for tracing, you can use the following bundle:

```
<script
  src="https://browser.sentry-cdn.com/9.5.0/bundle.replay.min.js"
  integrity="sha384-sJyrIOyOVMSgXus33HKLNkRL49UaLxzIlyNGPo/Frj1n5lE9RPIYt5VVvOiVCs0p"
  crossorigin="anonymous"
></script>
```

If you only use Sentry for error monitoring, and don't need performance tracing or replay functionality, you can use the following bundle:

```
<script
  src="https://browser.sentry-cdn.com/9.5.0/bundle.min.js"
  integrity="sha384-5uFF6g91sxV2Go9yGCIngIx1AD3yg6buf0YFt7PSNheVk6CneEMSH6Eap5+e+8gt"
  crossorigin="anonymous"
></script>
```

Once you've included the Sentry SDK bundle in your page, you can use Sentry in your own bundle:

```
Sentry.init({
  dsn: "https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
  // this assumes your build process replaces `process.env.npm_package_version` with a value
  release: "my-project-name@" + process.env.npm_package_version,
  integrations: [
    // If you use a bundle with tracing enabled, add the BrowserTracing integration
    Sentry.browserTracingIntegration(),
    // If you use a bundle with session replay enabled, add the Replay integration
    Sentry.replayIntegration(),
  ],

  // We recommend adjusting this value in production, or using tracesSampler
  // for finer control
  tracesSampleRate: 1.0,

  // Set `tracePropagationTargets` to control for which URLs distributed tracing should be enabled
  tracePropagationTargets: ["localhost", /^https:\/\/yourserver\.io\/api/],
});
```

---

### Available Bundles

Our CDN hosts a variety of bundles:

- `@sentry/browser` with error monitoring only (named `bundle.<modifiers>.js`)
- `@sentry/browser` with error and tracing (named `bundle.tracing.<modifiers>.js`)
- `@sentry/browser` with error and session replay (named `bundle.replay.<modifiers>.js`)
- `@sentry/browser` with error, tracing and session replay (named `bundle.tracing.replay.<modifiers>.js`)
- each of the integrations in `@sentry/integrations` (named `<integration-name>.<modifiers>.js`)

Each bundle is offered in both ES6 and ES5 versions. Since v7 of the SDK, the bundles are ES6 by default. To use the ES5 bundle, add the `.es5` modifier.

Each version has three bundle varieties:  

- minified (`.min`)  
- unminified (no `.min`), includes debug logging  
- minified with debug logging (`.debug.min`)  

Bundles that include debug logging output more detailed log messages, which can be helpful for debugging problems. Make sure to [enable debug](https://docs.sentry.io/platforms/javascript/configuration/options/#debug) to see debug messages in the console. Unminified and debug logging bundles have a greater bundle size than minified ones.

**Examples**  
- `bundle.js` is `@sentry/browser`, compiled to ES6 but not minified, with debug logging included (as it is for all unminified bundles)  
- `rewriteframes.es5.min.js` is the `RewriteFrames` integration, compiled to ES5 and minified, with no debug logging  
- `bundle.tracing.es5.debug.min.js` is `@sentry/browser` with tracing enabled, compiled to ES5 and minified, with debug logging included  

Below is the list of files along with their integrity checksums:

| File | Integrity Checksum |
| --- | --- |
| browserprofiling.debug.min.js | sha384-0yjIBAnoaK5b99+CYwdpkB7zPf7oVKoqpjAazXbaVz8MxdO4WnpE9qPk5en6ePpd |
| browserprofiling.js | sha384-dwuVMhDGTCBRsKGPKkc4F2RBLDTfWFglZMNd1CGGF7xm94+H1B0msSSw16ifS8Fp |
| browserprofiling.min.js | sha384-8OpgNXro0agY0OOlo+KhXB6u37MhAOPw4YfKnWnORSH8xRS7VTkf34+cSB5IIkjP |
| bundle.debug.min.js | sha384-cnEOJ/u984q5Nkn6RtAUHTW04p+/nDKBIpF1f1g1G/sLTjA9BLjwKNMNgAITzKyV |
| bundle.feedback.debug.min.js | sha384-b0Y1gMtHgPX5iISwumbmmDAeCdGCOoXK8l6zl7Ymr7kdyC2xzRC5YIfBPXWibrdP |
| bundle.feedback.js | sha384-msl09+Yll+mCZrkKUxKn1UcKw3tDXcqwsDD78eDEUFYNNyv5CX670lTK4bz657QVN |
| bundle.feedback.min.js | sha384-u+TGqcIcBlN8rAovDEtfrX27JtfU8Zzu3Onkp8e53BeTuEb8uz4Kb6cqCktnSXk9 |
| bundle.js | sha384-tp3yw+HTlc7fvXIBgN94nBbA/jjPL89lde+1B+LkmLlVr4IvwDlQHqeIaJXIYtul |
| bundle.min.js | sha384-5uFF6g91sxV2Go9yGCIngIx1AD3yg6buf0YFt7PSNheVk6CneEMSH6Eap5+e+8gt |
| bundle.replay.debug.min.js | sha384-QEyytSngzyALQWVOGVfmCqwKfdUcyy+L3sp6+IE2o4jGhawrCBAqpwQncQihq7sa |
| bundle.replay.js | sha384-B2WFy75oyf2aNUhvY+g5gVjIteE8B8wlG4BCC+cUQZborDzI4EZJjr+HAwNwDWWX |
| bundle.replay.min.js | sha384-sJyrIOyOVMSgXus33HKLNkRL49UaLxzIlyNGPo/Frj1n5lE9RPIYt5VVvOiVCs0p |
| bundle.tracing.debug.min.js | sha384-zZAYrGlJVdsXneAIXqcsMaCUYS65drIPt1JzbynhnNKwBvNluL+Ou+LyNNUP8H/v |
| bundle.tracing.js | sha384-Iw737zuRcOiGNbRmsWBSA17nCEbheKhfoqbG/3/9JScn1+WV/V6KdisyboGHqovH |
| bundle.tracing.min.js | sha384-nsiByevQ25GvAyX+c3T3VctX7x10qZpYsLt3dfkBt04A71M451kWQEu+K4r1Uuk3 |
| bundle.tracing.replay.debug.min.js | sha384-cHIVvVa6o6jvPPqW0mGjU9OhhMNYJg28OJFtPA/6998Ock6bPS03Z+jh3D9GNmtj |
| bundle.tracing.replay.feedback.debug.min.js | sha384-SUxvZchslXkR1yulqiDu/V3a+xCxmHBI4s/1IVw+oMG/ucL1rbcJEoauKLULZtIl |
| bundle.tracing.replay.feedback.js | sha384-HuuwtDXT8F/bHorLeDkSoJr7EAFabAFYgwe6MWrKu/pVoeehqVeho9TLCtJJ6e4D |
| bundle.tracing.replay.feedback.min.js | sha384-f0kPHT5Sxxx7PJldJAQZTVoxO18SxmQw0dUWJQ7/ItH4tVhjiuw9BHvmCyWpY0NK |
| bundle.tracing.replay.js | sha384-UbZ7EYQ9bQjZn7KUAq9kXkuO+3t7ONxAqW2pdSRTDacOAPXNjC5DOVmEJBNa/IV9 |
| bundle.tracing.replay.min.js | sha384-o/GEuWSkrvEGEtjN67ud+ssWsPJyX6RPCWqDvd8EE0N5nm6Id38XSS62lM4ETM0O |
| captureconsole.debug.min.js | sha384-on/e4HfdOsfVayAsErLXPB/aHyliorXJWcGcr2CqaABbX0xCSU/6preBbla2amsW |
| captureconsole.js | sha384-8ZEhKPNk4cTPtrzlme6XrW/+YYUt8F8/BZg4gRoD0rL9XJ7Oiah7yxvvVTklOi5p |
| captureconsole.min.js | sha384-5dE8ewUfcCKAtzvZW4PnXTTON9WmJu3NSvvZG2x6De8gZGxKvPt2KbrpLpdi5d7l |
| contextlines.debug.min.js | sha384-kBYcMRH7pzV1N5fS5ge1Y2Ry4e52uChUU+K6tPfDLWWNTLEn8jO6ekGfgP3p5Fqc |
| contextlines.js | sha384-U7gnW4u3a0RK1vzD7NO4iw/J8YdgiCqu/JZLBrWGftDJWuz5uELE48zbRpOmZIwh |
| contextlines.min.js | sha384-ZIcl9TMPG/CFZWJaXdZH99EHKs1FVzn5yo5YXmNQsu4GFvKHvd5w893eXLVnMXcw |
| dedupe.debug.min.js | sha384-appidVJd4lQHMDH9yyAUcN/0gXXKBfqyR82KiEs2eaM24NRA8etcwxSGmcWmSqN4 |
| dedupe.js | sha384-Xrk2HjxMhy02fKTH4twH90ngRqHFiPWLqGr9h3EfOhs9WSFdCFzgmpBCUip+JIKS |
| dedupe.min.js | sha384-lR0FS+fB5waZrwdZKHmh8RS455FrQBh2DMM3tXENej/u7MPzKnP50Ara4pAd2nSU |
| extraerrordata.debug.min.js | sha384-AdrBYl3KrgesxeCrCYHHWZ7UpODWGYeq0J46KGQgE6klOJjb6KFFvCNIXl0rChcN |
| extraerrordata.js | sha384-yUeXH8o+zRSoIpoErOXf9z4lI67pI23byJ1/xFKI6skdD6yXqHEGeJQUdEBTmOSO |
| extraerrordata.min.js | sha384-k+FX/pL6OLkJ596fxaGNRiLbrQMp+pjx5SJkX8By6aOjf4d38QGo+AdVzEGnC3uV |
| feedback-modal.debug.min.js | sha384-A8iOkQCMsMSDZPOnWjH2a4KYoKhyopOJmvY4sBDaTctUYI0l24aM79c9N4xMZz5M |
| feedback-modal.js | sha384-AIUYNLvdHDIjC4a8k+qZBeMR7kX4jhIOwGq6b7/tIv3obUA53BVvsCYs0lD/rM8n |
| feedback-modal.min.js | sha384-TlZikhp/WfnlmcCxNgHwydix/2UzFRHRfFiBL6UUR7XX87N/1hcYYQ3iQeBGbIJR |
| feedback-screenshot.debug.min.js | sha384-vDNtDagpybCh0rAZSlpZVuxw0Z6vYhVgsPQss66BqaWA8A18f5m1tLb4Okdrfisw |
| feedback-screenshot.js | sha384-F0QfltmtRaYLwRUDN0wB2WAHoxox/tUlrNzODPw7o7q8WD30utboeVcHmoJ6kVpP |
| feedback-screenshot.min.js | sha384-n9v3V7+6jdO8zFc9iM8xD2pjl5TOh7nE2o/lXq96zM/vzi4srFGth3ccne0tLs4Y |
| feedback.debug.min.js | sha384-nh05EV7w7Bt36BN3GtkgdA9xj9nwPRY3Zs5G8jO/wylPrZ6JxbxAuC9k5sNpGws7 |
| feedback.js | sha384-mZ6DzagXRkmCY8J3PYaVlYcBqSNZ6qgxhclYv4AJSTSDj3D85ORNfVceaLxNuAbu |
| feedback.min.js | sha384-HJqp2k0mFm0GyZ65eQXycZtNzf6yyrMZ216HMJVTZ6uaF3uhUp8+esXrpLkcMxMV |
| graphqlclient.debug.min.js | sha384-nS8aLmlktdD6n7QAAH0EjmODBmTyEE5OFAJXwYQxQv+xwZkC/7niYiVipAQP8L3K |
| graphqlclient.js | sha384-aPArkwwbGNYMbcsFBmKegDdER5n6bJieaubj7jXk8c5PAlAApRWVkD47nKXEWPBG |
| graphqlclient.min.js | sha384-nODkumrMdxvUw0oDHLs0sTulUgkMCvZqb3cP7mOYvVOtjSkQCPh4jqVB7GZg4kSP |
| httpclient.debug.min.js | sha384-uQo4FrcROLSTGev8S9H7S73drPdOAcPLV5lcoDy1x877FLFsRVuk57zV2Wn2VL+r |
| httpclient.js | sha384-v0bu7yVLV09oH3QAdcEOLQy27zL+XoMXkEJDDKLFg0Y9O7QJyXtJ9aolqF2wuS5T |
| httpclient.min.js | sha384-mE16WCqZPg+xqmwcHafslE8FQP+/NzXn+4Omko5WGZ+Kj//8fBPZfTkXkofFGFcy |
| modulemetadata.debug.min.js | sha384-bhvZMyxA1X5LuUJ8/q3wfGqU8VgEAOEWOEjKqYDoe4+KCPVJu3zFWMNPGt9e0Tgb |
| modulemetadata.js | sha384-flsLQyrZtdJRMxNBtyOGCcz9qLcaEK37I//LQW1mqeSarlaMNZ0feMOwnLE7rSlL |
| modulemetadata.min.js | sha384-OTpZwkLuAwfQd+Oxv5zz86eYm8DPTkCpLsLNEWDWMwDbVSZU0RXumSwWY/YVQDtF |
| multiplexedtransport.debug.min.js | sha384-GoWQrOEaPNxj/WWExlgP6WTinI356cdfvXVwUKU/i+YrbKSzbVMEWReIt4eb1V7l |
| multiplexedtransport.js | sha384-Y6cGmRYuk59AkINeZpD7x4DJrFPi2coU1t318M68UZtoKZPq1NHZXQ4R2+/FFDYD |
| multiplexedtransport.min.js | sha384-ltiaNvlynTrcCjGurrCbGN9q0bmmlyCmwUasxgBOkzzbkGYT1lZ4CqcKMZJIK7zo |
| replay-canvas.debug.min.js | sha384-6HsMoO1AttDRUAUA1B5tHMAe+HYTpguqDH4BxmDoD6oRqJLaEY5QO5zgpLTf5vYY |
| replay-canvas.js | sha384-JRe/WzlIx21g6hRIoncdVhlnuasvNlui20dlPAi/ChqnBC/RXrXXsC4+6m4qGkQI |
| replay-canvas.min.js | sha384-hdg2mQb6hKnEiCJ8+TwD1uJMc9TwoOMSyDwlG7xpVncdkQI1473gdliMKtgcU8V6 |
| replay.debug.min.js | sha384-VnvpJDhRds0TIO9uUSypTLoCyBFla2qpr/XA47uLRai4t7wByp6k8brxKTomDG2R |
| replay.js | sha384-WMCLALLVe3clSYI90R83wkfGdDsaSAg58h7BO4mDvEgyxtrTligROwGMA/Uy1pyI |
| replay.min.js | sha384-YEtl3gyE+SdRKMG/2/393dUpd6b3ljkgAfl57C6D1LHI7tHf2gvYNfW2PA18Ee/9 |
| reportingobserver.debug.min.js | sha384-3JUiut4IkciN4XHLx5C8ZqahIry+a2j4ogs0e6mRXxEpqYHU3ttMAi+kvJH1/kYt |
| reportingobserver.js | sha384-8n9rPUs+SZNDS+6JQP6y77wp4lOQ3zhFlXtJTNTyKACeBssf7Av3ogsiX/A+5ssD |
| reportingobserver.min.js | sha384-k4hVrqKBeOD3JdSOk+ZdV2I67tp/tPzYWb8Ox3hnoYjS+AKJGmRFngjZPOzn7VAp |
| rewriteframes.debug.min.js | sha384-9qUmDifnEB8HljcpZpvxjzjGi3U6Y+4FQpPtXfAEikkN0OnaWZocgq8AFV5YjE6v |
| rewriteframes.js | sha384-vWW+uZh48pViY4Z8LJ2DTziQy2yxO7fRdev5fCyi503nj6WeYNifblX5knVRfa1J |
| rewriteframes.min.js | sha384-8RjRQN1fldKuGk1ZsQBu35buT5/2Wlh9NHEx1Gnr/eaR9Kv5f0F7mopVGvqlOhY2 |
| spotlight.debug.min.js | sha384-yGOUVqPh+D4MQrndT9MrBNxI8moqtAAzWfJ1qswH06INuyjjob5IixdMMZGiPRWo |
| spotlight.js | sha384-L3wwoajq9rS1BzIjX+S2E0aw9AiLIXvg9xANW7o/qIa3/FMdIEK4r0aTVtuoX+Sr |
| spotlight.min.js | sha384-ufjQ0lnauqMqGRAMcVrNcysa/acVGOrhBI8VJMu9Pn4U5zOi4BhLuQNTjSDMQkgA |

To find the integrity hashes for older SDK versions, you can view our SDK release registry for the Browser SDK [here](https://github.com/getsentry/sentry-release-registry/tree/master/packages/npm/@sentry/browser).

---

### Script Ordering and CSP

If you use the [`defer` script attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script#attr-defer), we strongly recommend that you place the script tag for the browser SDK first and mark all of your other scripts with `defer` (but not `async`). This will guarantee that the Sentry SDK is executed before any of the others.

Without doing this you will find that it's possible for errors to occur before Sentry is loaded, which means you'll be flying blind to those issues.

If you have a Content Security Policy (CSP) set up on your site, you will need to add the `script-src` of wherever you're loading the SDK from, and the origin of your DSN. For example:

- `script-src: https://browser.sentry-cdn.com https://js.sentry-cdn.com`  
- `connect-src: *.sentry.io`  

---

**Help improve this content**  
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update (“yeah, this would be better”).

---

## [[Sentry JavaScript Options]]
**Path**: Clippings/Sentry JavaScript Options.md

---

- [Home](https://docs.sentry.io/)
- [Platforms](https://docs.sentry.io/platforms/)
- [JavaScript](https://docs.sentry.io/platforms/javascript/)
- [Configuration](https://docs.sentry.io/platforms/javascript/configuration/)
- [Options](https://docs.sentry.io/platforms/javascript/configuration/options/)

### Learn more about how the SDK can be configured via options. These are being passed to the init function and therefore set when the SDK is first initialized.

---

### Core Options

#### dsn
Type: `string`

The DSN tells the SDK where to send the events. If this is not set, the SDK will not send any events. Learn more about [DSN utilization](https://docs.sentry.io/product/sentry-basics/dsn-explainer/#dsn-utilization).

```
Sentry.init({
  dsn: "https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
});
```

---

#### debug
Type: `boolean`  
Default: `false`

Turns debug mode on or off. If debug is enabled SDK will attempt to print out useful debugging information about what the SDK is doing.

---

#### release
Type: `string`

Sets the release. Release names are strings, but some formats are detected by Sentry and might be rendered differently. Learn more about how to send release data so Sentry can tell you about regressions between releases and identify the potential source in [the releases documentation](https://docs.sentry.io/product/releases/) or the [sandbox](https://try.sentry-demo.com/demo/start/?scenario=releases&projectSlug=react&source=docs).

In the browser, the SDK will try to read this value from `window.SENTRY_RELEASE.id` if available.

---

#### environment
Type: `string`  
Default: `production`

Sets the environment. Defaults to `development` or `production` depending on whether the application is packaged.

Environments tell you where an error occurred, whether that's in your production system, your staging server, or elsewhere.

Sentry automatically creates an environment when it receives an event with the environment parameter set.

Environments are case-sensitive. The environment name can't contain newlines, spaces or forward slashes, can't be the string "None", or exceed 64 characters. You can't delete environments, but you can hide them.

---

#### tunnel
Type: `string`

Sets the URL that will be used to transport captured events. This can be used to work around ad-blockers or to have more granular control over events sent to Sentry. Adding your DSN is still required when using this option so necessary attributes can be set on the generated Sentry data. This option **requires the implementation** of a custom server endpoint. Learn more and find examples in [Dealing with Ad-Blockers](https://docs.sentry.io/platforms/javascript/troubleshooting/#dealing-with-ad-blockers).

---

#### maxBreadcrumbs
Type: `number`  
Default: `100`

This variable controls the total amount of breadcrumbs that should be captured. You should be aware that Sentry has a [maximum payload size](https://develop.sentry.dev/sdk/data-model/envelopes/#size-limits) and any events exceeding that payload size will be dropped.

---

#### attachStacktrace
Type: `boolean`  
Default: `false`

When enabled, stack traces are automatically attached to all messages logged. Stack traces are always attached to exceptions; however, when this option is set, stack traces are also sent with messages. This option, for instance, means that stack traces appear next to all messages captured with `Sentry.captureMessage()`.

Grouping in Sentry is different for events with stack traces and without. As a result, you will get new groups as you enable or disable this flag for certain events.

---

#### initialScope
Type: `CaptureContext`

Data to be set to the initial scope. Initial scope can be defined either as an object or a callback function, as shown below.

```
// Using an object
Sentry.init({
  dsn: "https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
  initialScope: {
    tags: { "my-tag": "my value" },
    user: { id: 42, email: "john.doe@example.com" },
  },
});

// Using a callback function
Sentry.init({
  dsn: "https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
  initialScope: (scope) => {
    scope.setTags({ a: "b" });
    return scope;
  },
});
```

---

#### maxValueLength
Type: `number`  
Default: `250`

Maximum number of characters every string property on events sent to Sentry can have before it will be truncated.

---

#### normalizeDepth
Type: `number`  
Default: `3`

Sentry SDKs normalize any contextual data to a given depth. Any data beyond this depth will be trimmed and marked using its type instead (`[Object]` or `[Array]`), without walking the tree any further. By default, walking is performed three levels deep.

---

#### normalizeMaxBreadth
Type: `number`  
Default: `1000`

This is the maximum number of properties or entries that will be included in any given object or array when the SDK is normalizing contextual data. Any data beyond this depth will be dropped.

---

#### enabled
Type: `boolean`  
Default: `true`

Specifies whether this SDK should send events to Sentry. Setting this to `enabled: false` doesn't prevent all overhead from Sentry instrumentation. To disable Sentry completely, depending on environment, call `Sentry.init` conditionally.

---

#### sendClientReports
Type: `boolean`  
Default: `true`

Set this option to `false` to disable sending of client reports. Client reports are a protocol feature that let clients send status reports about themselves to Sentry. They are currently mainly used to emit outcomes for events that were never sent.

---

#### integrations
Type: `Array<Integration> | (integrations: Array<Integration>) => Array<Integration>`  
Default: `[]`

Pass additional integrations that should be initialized with the SDK. Integrations are pieces of code that can be used to extend the SDK's functionality. They can be used to add custom event processors, context providers, or to hook into the SDK's lifecycle.

See [integration docs](https://docs.sentry.io/platforms/javascript/configuration/integrations/) for more information.

---

#### defaultIntegrations
Type: `undefined | false`

This can be used to disable integrations that are added by default. When set to `false`, no default integrations are added.

See [integration docs](https://docs.sentry.io/platforms/javascript/configuration/integrations/#modifying-default-integrations) to see how you can modify the default integrations.

---

#### beforeBreadcrumb
Type: `(breadcrumb: Breadcrumb, hint?: BreadcrumbHint) => Breadcrumb | null`

This function is called with a breadcrumb object before the breadcrumb is added to the scope. When nothing is returned from the function, the breadcrumb is dropped. To pass the breadcrumb through, return the first argument, which contains the breadcrumb object. The callback gets a second argument (called a "hint") which contains the original object from which the breadcrumb was created to further customize what the breadcrumb should look like.

---

#### transport
Type: `(transportOptions: TransportOptions) => Transport`

The JavaScript SDK uses a transport to send events to Sentry. On modern browsers, most transports use the browsers' fetch API to send events. Transports will drop an event if it fails to send due to a lack of connection.

In the browser, a `fetch`-based transport is used by default.

---

#### transportOptions
Type: `TransportOptions`

Options used to configure the transport. This is an object with the following possible optional keys:  

- `headers`: An object containing headers to be sent with every request.  
- `fetchOptions`: An object containing options to be passed to the `fetch` call. Used by the SDK's fetch transport.  

---

### Error Monitoring Options

#### sampleRate
Type: `number`  
Default: `1.0`

Configures the sample rate for error events, in the range of `0.0` to `1.0`. The default is `1.0`, which means that 100% of error events will be sent. If set to `0.1`, only 10% of error events will be sent. Events are picked randomly.

---

#### beforeSend
Type: `(event: Event, hint: EventHint) => Event | null`

This function is called with an SDK-specific message or error event object, and can return a modified event object, or `null` to skip reporting the event. This can be used, for instance, for manual PII stripping before sending.

By the time `beforeSend` is executed, all scope data has already been applied to the event. Further modification of the scope won't have any effect.

---

#### ignoreErrors
Type: `Array<string | RegExp>`  
Default: `[]`

A list of strings or regex patterns that match error messages that shouldn't be sent to Sentry. Messages that match these strings or regular expressions will be filtered out before they're sent to Sentry. When using strings, partial matches will be filtered out, so if you need to filter by exact match, use regex patterns instead. By default, all errors are sent.

---

#### denyUrls
Type: `Array<string | RegExp>`  
Default: `[]`

An array of strings or regex patterns that match the URLs of scripts where errors have been created. Errors that have been created on these URLs won't be sent to Sentry. If you use this option, errors will not be sent when the top stack frame file URL contains or matches at least one entry in the `denyUrls` array. All string entries in the array will be matched with `stackFrameUrl.contains(entry)`, while all RegEx entries will be matched with `stackFrameUrl.match(entry)`.

This matching logic applies to captured exceptions not raw message events. By default, all errors are sent.

---

#### allowUrls
Type: `Array<string | RegExp>`  
Default: `[]`

An array of strings or regex patterns that match the URLs of scripts where errors have been created. Only errors that have been created on these URLs will be sent to Sentry. If you use this option, errors will only be sent when the top stack frame file URL contains or matches at least one entry in the allowUrls array. All string entries in the array will be matched with `stackFrameUrl.contains(entry)`, while all RegEx entries will be matched with `stackFrameUrl.match(entry)`.

For example, if you add `'foo.com'` to the array, errors created on `https://bar.com/myfile/foo.com` will be captured because URL will be matched with "contains" logic and the last segment of the URL contains `foo.com`.

This matching logic applies for captured exceptions, not raw message events. By default, all errors are sent.

If your scripts are loaded from `cdn.example.com` and your site is `example.com`, you can set `allowUrls` to the following to exclusively capture errors being created in scripts in these locations:

```
Sentry.init({
  allowUrls: [/https?:\/\/((cdn|www)\.)?example\.com/],
});
```

---

### Tracing Options

#### tracesSampleRate
Type: `number`

A number between `0` and `1`, controlling the percentage chance a given transaction will be sent to Sentry. (`0` represents 0% while `1` represents 100%.) Applies equally to all transactions created in the app. Either this or `tracesSampler` must be defined to enable tracing.

---

#### tracesSampler
Type: `(samplingContext: SamplingContext) => number | boolean`

A function responsible for determining the percentage chance a given transaction will be sent to Sentry. It will automatically be passed information about the transaction and the context in which it's being created, and must return a number between `0` (0% chance of being sent) and `1` (100% chance of being sent). Can also be used for filtering transactions, by returning 0 for those that are unwanted. Either this or `tracesSampleRate` must be defined to enable tracing.

The `samplingContext` object passed to the function has the following properties:

- `parentSampled`: The sampling decision of the parent transaction. This is `true` if the parent transaction was sampled, and `false` if it was not.  
- `name`: The name of the span as it was started.  
- `attributes`: The initial attributes of the span.  

---

#### tracePropagationTargets
Type: `Array<string | RegExp>`

An optional property that controls which downstream services receive tracing data, in the form of a `sentry-trace` and a `baggage` header attached to any outgoing HTTP requests.

The option may contain a list of strings or regex against which the URLs of outgoing requests are matched. If one of the entries in the list matches the URL of an outgoing request, trace data will be attached to that request. String entries do not have to be full matches, meaning the URL of a request is matched when it _contains_ a string provided through the option.

On the browser, all outgoing requests to the same origin will be propagated by default.

If you want to disable trace propagation, you can set this option to `[]`.

---

#### beforeSendTransaction
Type: `(event: TransactionEvent, hint: EventHint) => TransactionEvent | null`

This function is called with a transaction event object, and can return a modified transaction event object, or `null` to skip reporting the event. This can be used, for instance, for manual PII stripping before sending.

---

#### beforeSendSpan
Type: `(span: SpanJSON) => SpanJSON | null`

This function is called with a serialized span object, and can return a modified span object. This might be useful for manually stripping PII from spans. This function is only called for root spans and all children. If you want to drop the root span, including all of its child spans, use [`beforeSendTransaction`](#beforeSendTransaction) instead.

---

#### ignoreTransactions
Type: `Array<string | RegExp>`  
Default: `[]`

A list of strings or regex patterns that match transaction names that shouldn't be sent to Sentry. Transactions that match these strings or regular expressions will be filtered out before they're sent to Sentry. When using strings, partial matches will be filtered out, so if you need to filter by exact match, use regex patterns instead. By default, transactions spanning typical API health check requests are filtered out.

---

### Session Replay Options

#### replaysSessionSampleRate
Type: `number`

The sample rate for replays that begin recording immediately and last the entirety of the user's session. `1.0` collects all replays, and `0` collects none.

---

#### replaysOnErrorSampleRate
Type: `number`

The sample rate for replays that are recorded when an error happens. This type of replay will record up to a minute of events prior to the error and continue recording until the session ends. `1.0` collects all sessions with an error, and `0` collects none.

---

### Profiling Options

#### profilesSampleRate
Type: `number`

A number between `0` and `1`, controlling the percentage chance a given sampled transaction will be profiled. (`0` represents 0% while `1` represents 100%.) Applies equally to all transactions created in the app. This is relative to the tracing sample rate — e.g. `0.5` means 50% of sampled transactions will be profiled.

---

**Help improve this content**  
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update (“yeah, this would be better”).

---

## [[Sentry SDK Integrations]]
**Path**: Clippings/Sentry SDK Integrations.md

---

### Overview

The Sentry SDK uses integrations to hook into the functionality of popular libraries to automatically instrument your application and give you the best data out of the box.

Integrations automatically add error instrumentation, performance instrumentation, and/or extra context information to your application. Some are enabled by default, but you can disable them or modify their settings.

|                                                 | **Auto Enabled** | **Errors** | **Tracing** | **Replay** | **Additional Context** |
|-------------------------------------------------|------------------|------------|------------|-----------|------------------------|
| [`breadcrumbsIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/breadcrumbs)             | ✓                |            |            |           | ✓                      |
| [`browserApiErrorsIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/browserapierrors)   | ✓                | ✓          |            |           |                        |
| [`browserSessionIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/browsersession)       | ✓                |            |            |           | ✓                      |
| [`dedupeIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/dedupe)                       | ✓                | ✓          |            |           |                        |
| [`functionToStringIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/functiontostring)   | ✓                |            |            |           |                        |
| [`globalHandlersIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/globalhandlers)       | ✓                | ✓          |            |           |                        |
| [`httpContextIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/httpcontext)             | ✓                |            |            |           | ✓                      |
| [`inboundFiltersIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/inboundfilters)       | ✓                | ✓          |            |           |                        |
| [`linkedErrorsIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/linkederrors)           | ✓                | ✓          |            |           |                        |
| [`browserProfilingIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/browserprofiling)   |                  |            | ✓          |           |                        |
| [`browserTracingIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/browsertracing)       |                  |            | ✓          |           | ✓                      |
| [`captureConsoleIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/captureconsole)       |                  | ✓          |            |           | ✓                      |
| [`contextLinesIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/contextlines)           |                  | ✓          |            |           |                        |
| [`extraErrorDataIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/extraerrordata)       |                  |            |            |           | ✓                      |
| [`featureFlagsIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/featureflags)           |                  |            |            |           | ✓                      |
| [`httpClientIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/httpclient)               |                  | ✓          |            |           |                        |
| [`launchDarklyIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/launchdarkly)           |                  |            |            |           | ✓                      |
| [`moduleMetadataIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/modulemetadata)       |                  |            |            |           | ✓                      |
| [`openFeatureIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/openfeature)             |                  |            |            |           | ✓                      |
| [`rewriteFramesIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/rewriteframes)         |                  | ✓          |            |           |                        |
| [`replayIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/replay)                       |                  |            |            | ✓         | ✓                      |
| [`replayCanvasIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/replaycanvas)           |                  |            |            | ✓         |                        |
| [`reportingObserverIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/reportingobserver) |                  | ✓          |            |           |                        |
| [`statsigIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/statsig)                     |                  |            |            |           | ✓                      |
| [`unleashIntegration`](https://docs.sentry.io/platforms/javascript/configuration/integrations/unleash)                     |                  |            |            |           | ✓                      |

To disable system integrations, set `defaultIntegrations: false` when calling `init()`.

To override their settings, provide a new instance with your config to the `integrations` option. For example, to turn off browser capturing console calls:

```
Sentry.init({
  dsn: "https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",

  integrations: [
    Sentry.linkedErrorsIntegration({
      limit: 7,
    }),
  ],
});
```

You can add additional integrations in your `init` call:

```
import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
  integrations: [Sentry.reportingObserverIntegration()],
});
```

Alternatively, you can add integrations via `Sentry.addIntegration()`. This is useful if you only want to enable an integration in a specific environment or if you want to load an integration later. For all other cases, we recommend you use the `integrations` option.

```
import * as Sentry from "@sentry/browser";

Sentry.init({
  integrations: [],
});

Sentry.addIntegration(Sentry.reportingObserverIntegration());
```

---

### Lazy-Loading Integrations

Lazy-loading lets you add pluggable integrations without increasing the initial bundle size. You can do this in two ways:

1. Add the integration with a dynamic import using `import()`.
   
   This method loads the integration from the npm package. To avoid running into issues with `import()`, you should use a bundler that supports dynamic imports. If you're using a tool like Vite for your project, the bundling process is probably already set up.

   ```
   Sentry.init({
     // Note, Replay is NOT instantiated below:
     integrations: [],
   });

   // Sometime later
   import("@sentry/browser").then((lazyLoadedSentry) => {
     Sentry.addIntegration(lazyLoadedSentry.replayIntegration());
   });
   ```

2. Use `Sentry.lazyLoadIntegration()`.

   This will attempt to load the integration from the Sentry CDN. Note that this function will reject if it fails to load the integration from the Sentry CDN, which can happen if a user has an ad-blocker or if there's a network problem. You should always make sure that rejections are handled for this function in your application.

   ```
   async function loadHttpClient() {
     const httpClientIntegration = await Sentry.lazyLoadIntegration(
       "httpClientIntegration",
     );
     Sentry.addIntegration(httpClientIntegration());
   }
   ```

Lazy loading is available for the following integrations:

- `replayIntegration`
- `replayCanvasIntegration`
- `feedbackIntegration`
- `feedbackModalIntegration`
- `feedbackScreenshotIntegration`
- `captureConsoleIntegration`
- `contextLinesIntegration`
- `linkedErrorsIntegration`
- `dedupeIntegration`
- `extraErrorDataIntegration`
- `httpClientIntegration`
- `reportingObserverIntegration`
- `rewriteFramesIntegration`
- `browserProfilingIntegration`

---

### Removing a Single Default Integration

If you only want to remove a single or some of the default integrations, instead of disabling all of them with `defaultIntegrations: false`, you can use the following syntax to filter out the ones you don't want.

This example removes the integration for adding breadcrumbs to the event, which is enabled by default:

```
Sentry.init({
  // ...
  integrations: function (integrations) {
    // integrations will be all default integrations
    return integrations.filter(function (integration) {
      return integration.name !== "Breadcrumbs";
    });
  },
});
```

---

### Custom Integrations

You can also create [custom integrations](https://docs.sentry.io/platforms/javascript/configuration/integrations/custom).

---

### Integration Reference

- #### [Breadcrumbs](https://docs.sentry.io/platforms/javascript/configuration/integrations/breadcrumbs/)  
  Wraps native browser APIs to capture breadcrumbs. (default)

- #### [BrowserApiErrors](https://docs.sentry.io/platforms/javascript/configuration/integrations/browserapierrors/)  
  Wraps native time and events APIs (`setTimeout`, `setInterval`, `requestAnimationFrame`, `addEventListener/removeEventListener`) in `try/catch` blocks to handle async exceptions. (default)

- #### [BrowserProfiling](https://docs.sentry.io/platforms/javascript/configuration/integrations/browserprofiling/)  
  Capture profiling data for the Browser.

- #### [BrowserSession](https://docs.sentry.io/platforms/javascript/configuration/integrations/browsersession/)  
  Track healthy Sessions in the Browser.

- #### [BrowserTracing](https://docs.sentry.io/platforms/javascript/configuration/integrations/browsertracing/)  
  Capture performance data for the Browser.

- #### [CaptureConsole](https://docs.sentry.io/platforms/javascript/configuration/integrations/captureconsole/)  
  Captures all Console API calls via `captureException` or `captureMessage`.

- #### [ContextLines](https://docs.sentry.io/platforms/javascript/configuration/integrations/contextlines/)  
  Adds source code from inline JavaScript of the current page's HTML.

- #### [Dedupe](https://docs.sentry.io/platforms/javascript/configuration/integrations/dedupe/)  
  Deduplicate certain events to avoid receiving duplicate errors. (default)

- #### [ExtraErrorData](https://docs.sentry.io/platforms/javascript/configuration/integrations/extraerrordata/)  
  Extracts all non-native attributes from the error object and attaches them to the event as extra data.

- #### [FunctionToString](https://docs.sentry.io/platforms/javascript/configuration/integrations/functiontostring/)  
  Allows the SDK to provide original functions and method names, even when those functions or methods are wrapped by our error or breadcrumb handlers. (default)

- #### [Generic Feature Flags Integration](https://docs.sentry.io/platforms/javascript/configuration/integrations/featureflags/)  
  Learn how to attach custom feature flag data to Sentry error events.

- #### [GlobalHandlers](https://docs.sentry.io/platforms/javascript/configuration/integrations/globalhandlers/)  
  Attaches global handlers to capture uncaught exceptions and unhandled rejections. (default)

- #### [HttpClient](https://docs.sentry.io/platforms/javascript/configuration/integrations/httpclient/)  
  Captures errors on failed requests from Fetch and XHR and attaches request and response information.

- #### [HttpContext](https://docs.sentry.io/platforms/javascript/configuration/integrations/httpcontext/)  
  Attaches HTTP request information, such as URL, user-agent, referrer, and other headers to the event. (default)

- #### [InboundFilters](https://docs.sentry.io/platforms/javascript/configuration/integrations/inboundfilters/)  
  Allows you to ignore specific errors based on the type, message, or URLs in a given exception. (default)

- #### [LaunchDarkly](https://docs.sentry.io/platforms/javascript/configuration/integrations/launchdarkly/)  
  Learn how to use Sentry with LaunchDarkly.

- #### [LinkedErrors](https://docs.sentry.io/platforms/javascript/configuration/integrations/linkederrors/)  
  Allows you to configure linked errors. (default)

- #### [ModuleMetadata](https://docs.sentry.io/platforms/javascript/configuration/integrations/modulemetadata/)  
  Adds module metadata to stack frames.

- #### [OpenFeature](https://docs.sentry.io/platforms/javascript/configuration/integrations/openfeature/)  
  Learn how to use Sentry with OpenFeature.

- #### [Replay](https://docs.sentry.io/platforms/javascript/configuration/integrations/replay/)  
  Capture a video-like reproduction of what was happening in the user's browser.

- #### [ReplayCanvas](https://docs.sentry.io/platforms/javascript/configuration/integrations/replaycanvas/)  
  Capture session replays from HTML canvas elements.

- #### [ReportingObserver](https://docs.sentry.io/platforms/javascript/configuration/integrations/reportingobserver/)  
  Captures the reports collected via the `ReportingObserver` interface and sends them to Sentry.

- #### [RewriteFrames](https://docs.sentry.io/platforms/javascript/configuration/integrations/rewriteframes/)  
  Allows you to apply a transformation to each frame of the stack trace.

- #### [Statsig](https://docs.sentry.io/platforms/javascript/configuration/integrations/statsig/)  
  Learn how to use Sentry with Statsig.

- #### [Unleash](https://docs.sentry.io/platforms/javascript/configuration/integrations/unleash/)  
  Learn how to use Sentry with Unleash.

---

