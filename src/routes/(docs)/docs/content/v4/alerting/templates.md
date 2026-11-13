---
title: "Alert Templates"
description: "Use Mustache variables to customize webhook, chat, and email alert messages"
---

Templates define the body and subject sent by triggers. Kener uses Mustache rendering.

## Operated composition {#operated-composition}

An operator may explicitly opt a trigger into the fork's `KENER_ATTENTION_CONFIG` binding. For that selected STATUS DOWN/NO_DATA Telegram webhook, the pinned composer supplies the complete message and notification decision; the stored template keeps its recipient/routing envelope but its text, HTML parse mode and entities are replaced by plain composed text. Normal triggers keep the templates below and creation/resolution behavior. Native alert evaluations also check selected due waits/follow-up; diagnostic HTTP acceptance is distinct from a qualified Message receipt.

The bearer-authenticated `/api/v4/attention/<alert_id>/<trigger_id>` route reads current sender state. PATCH with current `revision` and an attributable `reference` carries `action: facts` or exact-attempt `action: reconcile`; pickup alone never sends. POST `action: evaluate` with current revision explicitly re-evaluates after reconciliation, including a held recovery. Read before retrying an interrupted effect. Neither provider submission nor operator reconciliation proves device/human receipt. The fork's `wolf/qualification/attention-composer.md` defines the complete input and recovery contract; the operated composer/declaration remain outside this public source.

## Canonical alert variables {#canonical-alert-variables}

| Variable                         |
| :------------------------------- |
| `{{alert_id}}`                   |
| `{{alert_name}}`                 |
| `{{monitor_name}}`               |
| `{{monitor_tag}}`                |
| `{{alert_started_at}}`           |
| `{{alert_started_at_available}}` |
| `{{alert_confirmed_at}}`         |
| `{{alert_transition_at}}`        |
| `{{alert_transition}}`           |
| `{{alert_for}}`                  |
| `{{alert_value}}`                |
| `{{alert_status}}`               |
| `{{alert_severity}}`             |
| `{{alert_message}}`              |
| `{{alert_source}}`               |
| `{{alert_timestamp}}`            |
| `{{alert_cta_url}}`              |
| `{{alert_cta_text}}`             |
| `{{alert_incident_id}}`          |
| `{{alert_incident_url}}`         |
| `{{alert_failure_threshold}}`    |
| `{{alert_success_threshold}}`    |
| `{{is_resolved}}`                |
| `{{is_triggered}}`               |

`{{alert_name}}` is the tag of the monitor the alert fired for. The shipped templates build their headline as `Alert {{alert_name}} for {{alert_for}} {{alert_value}} {{alert_status}} at {{alert_timestamp}}`. Any trigger created before this change whose stored template still uses a bare `{{alert_name}}` as a headline now shows only the tag there. The old defaults did this in four places: the email subject, the email heading, the Discord embed title, and the Slack section text. Paste the headline string wherever you want the full headline back.

The Wolfsblvt fork supplies `monitor_name` (display name with tag fallback), `monitor_tag` (correlation tag), and `alert_transition` (`failing` or `recovered`). `alert_confirmed_at` is when the alert was created after its configured threshold. `alert_transition_at` is confirmation time for a trigger and resolution time for recovery. Both are ISO 8601 UTC. The legacy `alert_timestamp` remains creation time even on recovery.

The alert record does not retain the first failed observation: `alert_started_at` is empty and `alert_started_at_available` is false. Do not label confirmation as incident start. Actual first-failure timing remains unavailable in this source; neither timestamp proves message receipt.

For a readable custom message:

```text
{{monitor_name}} — {{alert_transition}}
{{#alert_started_at_available}}First failed observation: {{alert_started_at}}{{/alert_started_at_available}}
{{^alert_started_at_available}}First failed observation: unavailable{{/alert_started_at_available}}
Alert confirmed: {{alert_confirmed_at}}
Transition: {{alert_transition_at}}
{{#is_triggered}}Impact: {{alert_message}}{{/is_triggered}}
{{#is_resolved}}The configured recovery condition is satisfied.{{/is_resolved}}
Severity: {{alert_severity}}
Reference: {{monitor_tag}} / alert {{alert_id}}
Ops action and owner attention: not tracked by Kener.
```

Set the alert configuration's description to the actual user consequence. Recovery means the configured condition has recovered; it does not make the configured severity a new incident. Kener does not know whether someone is investigating or whether owner action is needed. Supply such claims only from an actual operating workflow. Existing stored templates and defaults are unchanged; adopting these variables is deliberate.

The fork retains reduced per-trigger send outcomes for operators. HTTP acknowledgement, mail acceptance and human delivery are distinct; a completed queue job does not prove a send succeeded. See `docs/LOGGING.md` in the fork for retained reads, access, expiry and unknown outcomes.

## Canonical site variables {#canonical-site-variables}

| Variable                 |
| :----------------------- |
| `{{site_url}}`           |
| `{{site_name}}`          |
| `{{site_logo_url}}`      |
| `{{colors_up}}`          |
| `{{colors_down}}`        |
| `{{colors_degraded}}`    |
| `{{colors_maintenance}}` |

## Mustache patterns {#mustache-patterns}

Basic interpolation:

```text
{{alert_name}}
```

Conditional sections:

```text
{{#is_triggered}}TRIGGERED{{/is_triggered}}{{#is_resolved}}RESOLVED{{/is_resolved}}
```

## Runtime default templates {#runtime-default-templates}

Default templates are defined in:

- webhook: `src/lib/server/templates/webhook_alert_template.ts`
- discord: `src/lib/server/templates/discord_alert_template.ts`
- slack: `src/lib/server/templates/slack_alert_template.ts`
- email: `src/lib/server/templates/email_alert_template.ts`

## Secret interpolation {#secret-interpolation}

Use `$VAR_NAME` (not `{{env.VAR_NAME}}`) for secrets.

```text
Authorization: Bearer $API_TOKEN
```

## Troubleshooting {#troubleshooting}

- **Variables show empty**: variable not present for that event
- **Conditional block not rendering**: verify section syntax and boolean variable name
- **Secrets not replaced**: confirm env var exists in runtime environment

## Related pages {#related-pages}

- [Triggers](/docs/v4/alerting/triggers)
- [Webhook Examples](/docs/v4/alerting/webhook-examples)
