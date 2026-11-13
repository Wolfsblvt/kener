# Operated attention composer

## Meaning

This patch joins one operator-owned, pure JavaScript composer to native alert dispatch, repeated evaluation and the existing webhook sender. An additive application-database table retains due-event claims, submission outcomes, operating facts and reconciliation. This document owns the opt-in source/runtime contract and its qualification limits. Source tests are not deployment or recipient evidence.

## Opt in deliberately

With no `KENER_ATTENTION_CONFIG`, normal Kener behavior is unchanged. When configured, this absolute JSON path contains `version: 1`, a finite array of actual numeric `triggerIds`, and `composer`/`declaration` objects each containing an absolute `path` and a lower-case SHA-256 `sha256`. The files are operator-owned and mounted read-only. They are not vendored into this public repository or the image. A changed or unavailable operated input refuses selected dispatch; it never falls back to a sentence in a stored template.

The module exports `validateDeclaration(declaration)` and `composeKener(declaration, variables, now, incidentFacts)`. It has no runtime dependency on Kener or filesystem effects. Composition returns `{text, row, notification: {event, standing, next}}`; `event: null` means no send. The existing alert variable contract supplies identity/confirmation/transition and explicitly unavailable onset. The sender supplies current operating facts plus retained messages. A due event remains due until the native sender obtains a useful submission receipt.

The first qualified channel is the already-configured HTTPS Telegram `sendMessage` webhook. The native sender preserves its recipient/routing envelope, replaces `text` with JSON-encoded plain composer output, and removes old parse-mode/entities. Template expansion and environment substitution never interpret composed text. Other channel contracts are not guessed. Status DOWN and NO_DATA are supported, and NO_DATA always composes missing observation rather than service failure/recovery. There is no new sender, scheduler, private-source dependency or dashboard.

## State and operator contract

`alert_notification_state` belongs to the same database and protection boundary as its native alert/trigger. The composite key is `(alert_id, trigger_id)`; optimistic `revision` protects updates. It retains facts, their attributable reference, and distinct attempted `sending`, `sent`, HTTP `accepted`, `unknown` and `failed` outcomes. A committed claim precedes HTTP. A process loss or unclassified response holds retry, including recovery, until reconciled. A successful Telegram response must contain a Message matching the sent recipient and text; it proves submission, not phone or human receipt. HTTP diagnostic JSONL remains separate.

The existing `/api/v4` bearer hook protects `/api/v4/attention/<alert_id>/<trigger_id>`:

- GET reads only this selected native relationship and its state, or null before first use.
- PATCH `action: facts`, `revision`, `reference` and `facts` updates actual pickup/changed custody and observed classification. Pickup requires who, since, Session and current standing; absence of knowledge is distinct from known no-pickup. It does not send.
- PATCH `action: reconcile`, `revision`, `reference`, exact `attempt`, `outcome: sent|failed`, and `at` for a successful submission preserves the attempted event and records explicit evidence. It does not send.
- POST `action: evaluate` plus current `revision` invokes the same native sender, including a held recovery after reconciliation. Read after any interrupted effect before retrying.

This is an operator capability. Authentication does not itself grant effect authority. New API shapes and the additive state migration are source changes; prior databases/images cannot be treated as interchangeable recovery points. Retain valued receipts/configuration pins when rolling source back; dropping the table would erase duplicate/uncertainty knowledge. Its lifecycle follows the native alert/trigger, including cascade retirement. Existing unrelated histories, associations and incident behavior are preserved.

## Qualification

The source cut passed the full 798-case server/Chromium suite with the operated-module qualification enabled, and `svelte-check` reported zero errors/warnings. Final native cases passed 15/15 on each of SQLite, PostgreSQL and MariaDB's MySQL-compatible path. MySQL first exposed a fixture-only ISO-string timestamp incompatibility; the fixture now uses the same UTC SQL datetime representation on all three engines. The complete suite predates that fixture-only normalization; the final three-engine cases qualify it directly. Production SvelteKit/server builds completed on Node 24.17.0; this is a build, not an image/runtime acceptance claim. The separately preserved runtime patch still selects Node 24.22.3 for images.

Removing each source-pin, matching-message, accepted-response uncertainty and database revision guard made its targeted production-path test fail. Restoring the exact bytes returned all 15 native cases to passing. Queue/provider doubles remain explicit: these results establish neither real credentials nor provider/device/human delivery. Telegram's [sendMessage response contract](https://core.telegram.org/bots/api#sendmessage), checked 13 November 2026, supplies the provider boundary; the native sender additionally matches recipient/text before consuming the due event.

`src/lib/server/notification/attentionDispatch.test.ts` exercises the real migration, repository, compare-and-swap, source-pin reader, native cadence, sender, receipt reduction and API actions. Queue transport and external HTTP are harmless doubles. By default it uses a synthetic public contract module. For a private qualification of the actual operated module, set `KENER_TEST_ATTENTION_COMPOSER` to that module's mounted path; the same native path then exercises immediate/30-minute/public/private policy with a wholly synthetic declaration. No private declaration is needed by the public suite.

Run through the repository's server test command, then repeat this test with `TEST_DATABASE_URL` pointing only at disposable PostgreSQL and MySQL databases. It deletes its own fixture tables. `npm run check`, the existing sender/queue suites and ordinary full suite retain their distinct claims. Counterexample qualification must make changed-source pins, uncertain receipts and stale database revisions ineffective in turn and observe the relevant production-path tests fail.

Runtime admission still requires the actual image/source/configuration/database/protection coordinates, read-only artifact delivery, real configured channel validation, native recurrence, monitoring/expectation and consumer readback. This internal seam has no independent Home, public status row or atlas card; its component consequence belongs to the existing service. No live send, installed route, phone receipt or human use is claimed here.
