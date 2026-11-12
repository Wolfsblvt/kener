# Native alert notification evidence

## Meaning

The Wolfsblvt fork retains reduced operational evidence for native monitor-alert sends, so operators can join an alert event, its triggered or resolved transition and a configured trigger to the observed send outcome. This document owns the retained-file format, operator read, access and retention limits. It does not certify a deployed version, provider/device/human receipt, or the site's other logging surfaces. It is operational history, not an audit ledger or a resend queue.

## What is retained

The production alert worker dispatches through `src/lib/server/notification/alertNotifications.ts`. Before invoking a channel sender it appends an `attempt` row; after the sender returns or throws it appends a `result` row. Both have one random attempt ID and the native numeric alert, configuration and trigger IDs, transition, transition time, channel and UTC recording time. Results carry a finite reason, duration and HTTP status when known. Multiple attempts remain separate; trigger and recovery share the native alert ID.

| Outcome                      | Evidence and limit                                                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepted` / `http_accepted` | A webhook, Slack or Discord endpoint returned HTTP 2xx. This is HTTP acknowledgement only. A generic webhook can return 2xx with an application-level error; Kener does not interpret arbitrary response bodies. |
| `accepted` / `mail_accepted` | SMTP accepted all recipients and rejected none, or Resend returned a success ID. This does not prove mailbox, device or human delivery.                                                                          |
| `failed`                     | An HTTP endpoint returned non-2xx, or an SMTP result rejected all recipients.                                                                                                                                    |
| `unknown`                    | Transport/send exception without a deciding response, unclassified return, partial mail acceptance, or an attempt with no retained terminal row. A timeout may have crossed the provider boundary.               |
| `not_attempted`              | Explicit empty-recipient skip, malformed configuration, unsupported channel, or a remaining trigger skipped after an earlier thrown dispatch aborted the loop.                                                   |

An attempt row means the channel dispatcher was invoked, not that bytes reached a provider. Known HTTP acknowledgement survives a subsequent response-body read failure. Exceptions retain no raw text. The existing channel return values remain available to the authenticated trigger-test flow, but channel senders no longer emit raw errors or provider bodies to console logs. No endpoints, headers, templates, message bodies, email addresses, provider IDs or raw exception data enter these retained records. Names and descriptions stay in the native monitor/configuration sources and are not copied to this log.

Event creation/resolution, confirmation and recovery thresholds, channel ordering, empty-recipient skip, and one send per new event plus one recovery remain unchanged. An HTTP-error return still lets subsequent triggers run. A thrown dispatch still aborts them, now with explicit skipped records. Notification evidence does not authorize replay or automatic resend.

## Storage, access and retention

`KENER_NOTIFICATION_LOG_DIR` selects a private writable directory; the default is `./database/notification-outcomes`, beneath Kener's usual persistent database directory. It applies even when the application database is remote: persist this directory separately if `./database` is not mounted. Never place it under a static/public directory. Scope a separate directory to each Kener instance/scheduler writer; do not share one directory across independent instances.

New Unix directories use mode `0700` and files `0600`; the writer refuses existing group/world-accessible directories or daily files and symbolic-link targets. On Windows the directory inherits its parent's ACL: the operator must grant only the service account and authorized operators access before adoption. The CLI is a local filesystem read under that account/ACL, with no public API or dashboard endpoint. Host/container administrators retain their normal access. These are product source safeguards, not proof of installed host permissions.

Files rotate by UTC date as `notification-YYYY-MM-DD.jsonl`. Each is capped at **4 MiB**; rows older than **90 days**, by UTC file date, are removed on the next write. The current day plus the retained 90 day boundaries consume at most **364 MiB per single writer**. Closed files remain plain JSON Lines: this small bounded store favors direct recovery/readability over an additional compression lifecycle. There is no sampling, external export or analytics. During idle periods expiry waits until the next write.

A full day, permission problem, disk failure or unsafe path emits only `notification.evidence_unavailable` with numeric alert/trigger IDs and transition to stderr. Sending continues under existing policy. This protects delivery from a logging outage, but means the retained record can be incomplete. Observe this diagnostic through the deployment's existing service/container logs; operator custody includes correcting storage/access or explicitly preserving an incident's records before expiry. Do not silently treat a shorter container-log window as retention for these files. Persist the files themselves. This candidate does not install a log shipper or new monitor.

## Read the exact retained transition

From the fork source with Node 24.14 or later, using the private retained directory or an authorized copy/mount:

```sh
node wolf/notification/read.mjs --directory /private/notification-outcomes --alert 7 --transition TRIGGERED --trigger 3
node wolf/notification/read.mjs --directory /private/notification-outcomes --alert 7 --transition RESOLVED --trigger 3
```

The source-owned CLI is independent of application dependencies. It need not be installed in the running image: use a host read of the mounted directory or an authorized private copy. Get the alert/configuration/trigger IDs from the existing operator/database read; do not use queue completion as a result. Each returned attempt includes its own terminal result if retained. An interrupted attempt stays `unknown`. An empty array also means **unknown**, never `not_attempted`: the event may predate adoption, have no configured trigger, fail before dispatch, expire, or lose logging. A missing/unreadable directory or corrupt/truncated/oversized file yields an unavailable/incomplete read and CLI exit 2, not a clean negative. Normal reads exit 0, including an empty result with that explicit unknown standing.

The CLI examines only the named directory's daily files, at most 4 MiB per file, without following file symlinks. It does not send messages or mutate retained files. The writer's next normal append owns expiry. The read is a supporting observation of retained local evidence; no missing terminal record justifies blind replay.

## Adoption and recovery boundary

The maintainer must accept source, build/select a compatible image and preserve its exact source/image tuple separately from changing stored templates. Persist and restrict the log directory, qualify the CLI against an ordinary new event/transition, and watch the existing evidence-unavailable diagnostic. Old events have no reconstructed receipts. The operator owns actual template wording, accurate configured impact and any real attention/action standing. Default templates retain legacy behavior.

These files are diagnostic state, not transactional application state: a process/host/storage failure can lose the last append. A retained start without a result remains unknown. No disaster-recovery or off-host durability claim is made. Preserve incident evidence through the operator's authorized recovery route when its loss matters. Source tests with replaced network calls establish neither real provider acceptance nor useful received warnings.
