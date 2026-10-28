---
title: API Monitor
description: Monitor HTTP/HTTPS endpoints with custom methods, payloads, and eval logic
---

API monitors send HTTP requests and evaluate the response with JavaScript.

## Minimum setup {#minimum-setup}

1. Set `url`
2. Choose `method` (default `GET`)
3. Set `timeout` (default `10000` ms)
4. Save (optional: custom `eval` function)

## Configuration fields {#configuration-fields}

| Field                 | Type                                           | Default          | Notes                                                                                                                                                          |
| :-------------------- | :--------------------------------------------- | :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                 | `string`                                       | —                | Required                                                                                                                                                       |
| `method`              | `GET\|POST\|PUT\|PATCH\|DELETE\|HEAD\|OPTIONS` | `GET`            |                                                                                                                                                                |
| `headers`             | `{ key, value }[]`                             | `[]`             | Optional custom headers                                                                                                                                        |
| `body`                | `string`                                       | `""`             | Sent for non-GET/HEAD methods                                                                                                                                  |
| `timeout`             | `number`                                       | `10000`          | Request timeout in ms                                                                                                                                          |
| `allowSelfSignedCert` | `boolean`                                      | `false`          | Disables TLS verify when true                                                                                                                                  |
| `proxy`               | `string`                                       | —                | Optional forward proxy, e.g. `http://user:$PROXY_PASS@proxy.internal:3128`; overrides the [environment proxy](/docs/v4/setup/environment-variables#http-proxy) |
| `eval`                | `string` (JS function)                         | built-in default | Receives response details                                                                                                                                      |
| `observation_mode`    | `"explicit"`                                   | omitted          | Opt in to native no-observation semantics; existing monitors are unchanged when omitted.                                                                       |

> [!WARNING]
> Header, body, URL and proxy values support `$SECRET` env substitution. If the URL (or an `http://` proxy) is unencrypted, the substituted secrets are sent in cleartext — use `https://` unless the endpoint is on a trusted network.

## Default eval behavior {#default-eval}

Built-in eval marks the monitor **UP** when:

- status code is `429`, or
- status code is in `2xx` or `3xx`

Otherwise it returns **DOWN**.

## Custom eval contract {#custom-eval-contract}

Your function receives:

- `statusCode`
- `responseTime`
- `responseRaw`
- `modules`: `cheerio` and finite `request` metadata. `request` is `{ outcome: "http", statusCode }` or `{ outcome: "transport", reason: "timeout" | "transport" }`; it contains no raw errors, headers, URLs or configuration.

It must return:

```javascript
{ status: "UP" | "DEGRADED" | "DOWN" | "MAINTENANCE" | "NO_DATA", latency: number }
```

## Explicit observations {#explicit-observations}

Set `type_data.observation_mode` to `"explicit"` through the v4 monitor API when an unavailable observation must stay distinct from an application failure. Transport loss, timeout and evaluation failure then produce native `NO_DATA`; a callback or configured default cannot paint that loss UP. Actual HTTP 500 remains an observed response, so the evaluator can classify it DOWN. Existing three-argument evaluators and monitors without the opt-in retain their behavior.

```javascript
async function (statusCode, latency, body, modules) {
    if (modules.request.outcome === "transport") return { status: "NO_DATA", latency };
    return { status: statusCode >= 200 && statusCode < 400 ? "UP" : "DOWN", latency };
}
```

Explicit observations retain NO_DATA through confirmation, queue, history and current presentation. Default/manual/future values cannot certify current health. Current evidence expires after a fully missed scheduled poll opportunity, allowing the current run to be in flight; cadence comes from the monitor's cron. Finite native maintenance remains visible only during its actual event and does not stop polling. Expiry exposes the underlying observation again.

An active application incident keeps its presentation impact while the underlying observation still drives separate observation-loss and recovery notices. Resolving the incident exposes the current underlying observation. Cached overall status and badges retain that same evidence across finite maintenance expiry, before another poll runs.

In explicit mode, an evaluator returns UP, DOWN, DEGRADED or NO_DATA. A callback cannot assert planned maintenance: that state requires an actual finite native event. Invalid callback diagnostics and latency values are replaced by fixed messages and measured latency, keeping arbitrary callback values out of persisted error text.

Use a separate [STATUS/NO_DATA alert](/docs/v4/alerting/alert-configurations#no-observation) for observation loss. An observed HTTP response can resolve that notice while the application's DOWN alert remains active. The scheduler cannot notify after its whole process or Redis is unavailable; retain an independent service-health observer for that failure domain.

## Example {#example}

```json
{
    "monitor_type": "API",
    "type_data": {
        "url": "https://api.example.com/health",
        "method": "GET",
        "timeout": 10000
    }
}
```

## Troubleshooting {#troubleshooting}

- **Always DOWN**: verify URL/method/headers/body
- **TLS errors**: enable `allowSelfSignedCert` only for trusted self-signed endpoints
- **Eval errors**: simplify eval and validate return shape
- **`Failed to establish tunnel`**: the proxy refused the connection; see [proxy settings](/docs/v4/setup/environment-variables#http-proxy)
