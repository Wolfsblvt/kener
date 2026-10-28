# Explicit API observation qualification

## Meaning

This record describes the opt-in native distinction between a known HTTP response and an unavailable observation, qualified locally on 27 October 2026 against the maintained 4.1.9 fork. It preserves compatibility, synthetic production-path evidence and the unobserved deployment boundary. It is source qualification, not a published image or an installed-service claim.

## Behavior and compatibility

Only API monitors with `type_data.observation_mode: "explicit"` select the changed status behavior. Every evaluator receives additive finite `modules.request` metadata; the original three positional inputs remain unchanged. Real HTTP 500 is an HTTP response. Transport loss, timeout or failed evaluation becomes NO_DATA for opted-in monitors, regardless of evaluator/default UP. Callback errors and invalid latency values do not enter persisted diagnostics verbatim. Maintenance must come from an actual finite native event.

No schema or data migration is needed. Existing history, IDs, confirmation thresholds, defaults and non-opted monitor behavior are retained. NO_DATA uses the existing native status and presentation. Manual/default/future evidence cannot certify current observation. Current presentation expires after a fully missed cron opportunity, permitting the current run in flight. A finite native maintenance event has an inclusive start and exclusive end; underlying polling continues and its observation reappears at expiry.

The authenticated monitor-list response adds `observation_contract: "wolf-explicit-api-observation-v1"`. Selected opted-in monitor history adds allowlisted `raw_status`, preserving the underlying observation across overlays without returning raw diagnostics. Old servers omit the marker and must be treated as unsupported by consumers requiring this contract.

STATUS/NO_DATA is a separate operator notice. Failure threshold counts native missing observations or fully missed cron opportunities; recovery requires the configured number of observed responses, including known HTTP failures. It cannot create application-outage incidents. Finite native maintenance freezes trigger and resolution. The existing application scheduler checks silent execution once per minute without inserting synthetic history. The whole scheduler/process/Redis failure domain still needs an independent health observer.

## Local evidence

- Supported Node 24.19.0; dependency lockfile unchanged. `npm run check` completed with zero errors and warnings. Production `npm run build` completed; no image was built or published.
- The complete Vitest server/Chromium suite passed with file concurrency disabled. The first cold client run failed during dependency optimization; a focused warm client run and the subsequent complete run passed. Existing CodeMirror virtual-CSS and build circular-dependency warnings remain upstream observations.
- `apiCall.observation.test.ts` uses real Axios and an owned loopback HTTP server: HTTP 200/302/401/500, no redirect following, socket loss, timeout, forced healthy callbacks, failed callbacks and invalid latency. Legacy callback diagnostics are a positive control. Temporarily disabling the production explicit-mode guard made the diagnostic-containment test fail on its synthetic marker; exact bytes were restored.
- `explicitObservation.test.ts` and existing current-status tests passed on SQLite, PostgreSQL 16 and MariaDB 11 (19 tests on each additional engine). They exercise real migrations/repositories, contract metadata, native bars, missing/stale/manual/default/future evidence, threshold recovery, finite maintenance expiry and partial alert-update validation.
- An owned local consumer fixture used the production HTTP handler, real bearer middleware, SQLite, Redis execution/response/alert queues, real Axios and a loopback webhook. It proved authenticated CRUD/readback, transport NO_DATA surviving a configured default UP, HTTP 500 DOWN, thresholded recovery, distinct observation/app notifications and stale presentation. Temporarily removing the production queue exemption made the stored-history assertion fail with false UP; exact bytes were restored. No live target, scheduler startup or external notification was used. The logical clock advances synthetic minute opportunities; it does not prove wall-clock scheduling.

All disposable database/Redis resources were removed and their exact names read back absent. UI syntax/type checks and existing component tests cover the changed help/choice surface. Svelte autofixer ran on both edited components; it reported existing unkeyed blocks, navigation-resolution/deprecated-store suggestions and an unavailable lint-rule definition outside the new behavior. Those are not claimed clean or repaired by this patch. A full authenticated alert-editor journey remains unobserved.

## Incident and cache repair — 28 October 2026

Active application incidents retain their native presentation impact. Their underlying `raw_status` still counts toward separate observation-loss and recovery thresholds, including recovery on a known failing HTTP response. Only finite native maintenance freezes those notices. Ended incidents unwrap to the current underlying observation. Redis last-status values retain `raw_status`, so cache-backed overall status and badges agree with database-backed bars at the exclusive maintenance end before another poll.

On Node 24.19.0, full type checking passed without errors or warnings, and the complete server/Chromium suite passed 704 tests in 63 files. The existing CodeMirror virtual-CSS diagnostic remains visible despite a passing suite. The focused persistence/current-status pair passed 27 tests each on disposable PostgreSQL 16 and MariaDB 11 instances, in addition to SQLite in the complete suite. Both database resources were stopped and their exact names read back absent.

The new regressions exercise active/ended incidents over UP, DOWN and NO_DATA; observation loss/recovery during open DOWN, DEGRADED and MAINTENANCE-impact incidents; and the production response processor, JSON cache hit, single/overall badges and database bars across finite maintenance expiry with underlying UP and DOWN. Restoring both original production modules while retaining the tests produced seven named failures; repaired bytes were restored. Queue and Redis transport are substituted in that regression, while the actual response processor, repositories and cache serialization run.

The production application and server builds passed, with the existing circular-dependency warnings. The docs-excluding SvelteKit build and server build were invoked directly with hidden child processes; the existing build wrapper's shell launch lacks window-suppression controls. Docs were restored afterward. No image was built. An owned production-HTTP/SQLite/Redis/loopback fixture additionally delivered real local NO_DATA trigger/recovery notices while an application incident remained open, retained DOWN/INCIDENT presentation over raw DOWN and NO_DATA, and proved actual Redis-cache-backed overall/single badges and database-backed bars agreed at finite maintenance's exact end with raw UP and no intervening poll. The logical clock and runtime lineage remain synthetic; no application scheduler, live target or external notification was used. Its exact owned Redis resource was removed and read back absent.

## Joining and remaining boundary

This patch starts at the qualified fork and does not incorporate any separate presentation proposal. Shared controller/import/patch-table paths require ordinary integration reconciliation when another proposal lands. Consumers must check the finite marker and their accepted runtime coordinate; a version string or source branch alone proves neither installed bytes nor live behavior.

Image build/publication, deployment, real monitor/page/alert admission, native wall-clock scheduling, finite-maintenance operation, external notification delivery and human use remain unobserved. A whole-process failure cannot report its own loss; existing independent health coverage remains necessary.
