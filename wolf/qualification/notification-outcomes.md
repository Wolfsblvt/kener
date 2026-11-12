# Notification outcome qualification

## Meaning

This records the 12 November 2026 source qualification of readable native alert transitions and retained per-trigger outcomes on the Kener 4.1.9 fork. It covers producer/reader validation, configuration refusal, diagnostic separation and honest timestamp wording. It establishes neither source acceptance nor an installed image, stored-template adoption, provider delivery or a useful received warning.

## Behavior and compatibility

The notification patch belongs to the ordered replay series in `wolf/README.md`. It preserves the human capability name, stable correlation tag, failing/recovered transition, legacy default/stored templates, configured severity and existing new-event/recovery repeat policy. HTTP acknowledgement and mail acceptance remain distinct from application, device and human delivery.

The alert record is created after threshold confirmation and does not retain the first failing observation. `alert_confirmed_at` names creation honestly; `alert_transition_at` names confirmation or recovery. `alert_started_at` is empty with `alert_started_at_available: false`. The readable example explicitly says first-failure timing is unavailable. This repairs a false claim; actual first-failure timing remains a product outcome to carry through a supported observation-history route.

The dependency-free finite contract is shared by the producer and operator reader. Invalid values, impossible channel/phase/outcome relationships, missing attempt counterparts and conflicting rows cannot count as complete acceptance or echo arbitrary retained content. File order does not choose the winning result. This is validation of local evidence, not authentication against an authorized malicious file writer. Malformed webhook header configuration refuses before HTTP submission, including after secret interpolation. A dedicated reduced notification error contains provider/configuration failures while unrelated alert/database/incident errors retain useful diagnostics.

## Discriminating source evidence

The original reader returned hostile nested values as accepted evidence with `read_incomplete: false`. The corrected reader tests exercise invalid values and relationships, conflicting identities/results/times, orphan acknowledgements, duplicate/reversed rows and explicit pending/no-send evidence. The production-path regression run failed nine new expectations before repair, then passed after repair. Queue/database transports and provider calls are replaced; production variables, dispatch, webhook sender, file writer and reader run together.

The final focused run passed **41 tests across three server files**, plus **five dependency-free reader tests**. The production server-bundle test also passed, and final Svelte sync/check found **zero errors and zero warnings**. The optional Svelte autofixer was unavailable offline (`ENOTCACHED`); no tool was downloaded. These include malformed/partial headers, post-substitution refusal, valid quote/backslash/empty header values, invalid producer values, useful non-notification diagnostics and reduced configuration errors. The two-process CLI test uses a local 15-second test allowance after an observed 8.5-second Windows startup exceeded Vitest’s default five seconds; no application/send timeout changed.

With Node 24.22.1 and UTC, use the repository's `test:server` script for the three focused suites:

```sh
npm run test:server -- src/lib/server/notification/alertNotifications.test.ts src/lib/server/notification/notification_utils.test.ts src/lib/server/queues/alertingQueue.test.ts --maxWorkers=2
node --test wolf/notification/read.test.mjs
```

If local npm command shims cannot resolve installed executables, the existing direct entry points supply the same check with `TZ=UTC`: `node node_modules/vitest/vitest.mjs run --project=server ...`, `node node_modules/@sveltejs/kit/svelte-kit.js sync`, and `node node_modules/svelte-check/bin/svelte-check --tsconfig ./tsconfig.json`. This workaround does not install dependencies or change the root commands.

The earlier full notification-candidate run remains dated evidence: 742 passed / 26 failed in four unchanged browser files. Exact-base comparisons reproduced Docker, heartbeat and HTTP-secret failures; CopyButton passed normally on both trees and failed identically under a controlled delay exceeding its one-second copied state. The original run's precise CopyButton delay is unobserved. These comparisons do not turn that suite green.

The independent runtime-pin candidate at `abe023ecb57862bb748dc6a108951cbea467e7ec` excludes this notification patch. Its current source check passed with zero errors/warnings; one full UTC run passed all 679 executed server tests across 53 files, but failed to connect the Chromium session before browser assertions ran. This is incomplete whole-suite evidence. Its separate Debian Node 24.22.3 image smoke is not notification-image or provider-delivery evidence. No broad suite rerun or unrelated browser repair is claimed here.

## Operating remainder

Accept and integrate source under the fork contract, select/build a compatible joined image, preserve recovery and the source/image relationship, persist/restrict the retained directory, deliberately adopt truthful stored templates, and qualify an ordinary new event/transition through the retained read. Observe actual provider, device and human receipt separately. The operator must still establish real condition start, investigation/action and attention standing from supported evidence; this source does not invent them. Retention policy and native notification/repeat behavior are unchanged. See `docs/LOGGING.md` for access, incomplete reads, storage failure and retention.
