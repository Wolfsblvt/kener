---
title: "Alert Configurations"
description: "Create alert rules with thresholds, severity, and trigger routing"
---

Alert configurations define when notifications should be sent for a monitor.

## Required settings {#required-settings}

Each configuration needs:

- monitor
- alert type (`STATUS`, `LATENCY`, or `UPTIME`)
- alert value
- failure threshold
- success threshold
- at least one trigger

## Alert value by type {#alert-value-by-type}

| Alert type | Value format                                                   |
| :--------- | :------------------------------------------------------------- |
| `STATUS`   | `DOWN`, `DEGRADED`, or `NO_DATA` for explicit API observations |
| `LATENCY`  | latency threshold in milliseconds                              |
| `UPTIME`   | minimum uptime percentage                                      |

## Threshold behavior {#threshold-behavior}

- **Failure threshold**: consecutive failing evaluations before `TRIGGERED`
- **Success threshold**: consecutive passing evaluations before `RESOLVED`

Higher thresholds reduce noise; lower thresholds detect faster.

## No-observation notices {#no-observation}

For an API monitor with `type_data.observation_mode: "explicit"`, choose STATUS/NO_DATA to report missing evidence separately from a known application response failure. The failure threshold counts consecutive native NO_DATA samples or fully missed poll opportunities. The success threshold requires that many observed HTTP responses, including known DOWN/DEGRADED responses: restored observation is not application recovery.

The existing application scheduler checks this condition once per minute even when the monitor execution queue produces no new result. It writes no synthetic healthy/history sample and creates no new scheduler. Finite native maintenance freezes the notice; the condition is evaluated again when the event ends. Missing, default, manual and future records are not observation success. A stopped scheduler/Redis needs an observer outside that failure domain.

An open application incident does not freeze these notices: observation loss can trigger and recover while the incident and its presentation impact remain active. Only finite native maintenance freezes observation notices.

These operator notices use triggers without creating application-outage incidents. Keep `create_incident: "NO"`; the API rejects YES for this condition, including partial updates. Other alert configurations retain their behavior.

## Severity and incidents {#severity-and-incidents}

- Severity is `CRITICAL` or `WARNING`.
- Optional incident creation links alert events to incidents.

## Common patterns {#common-patterns}

### Critical outage alert {#critical-outage-alert}

- Type: `STATUS`
- Value: `DOWN`
- Failure threshold: `1`
- Success threshold: `2`
- Severity: `CRITICAL`

### Performance alert {#performance-alert}

- Type: `LATENCY`
- Value: `1000`
- Failure threshold: `3`
- Success threshold: `5`
- Severity: `WARNING`

## Troubleshooting {#troubleshooting}

- **Not triggering**: verify configuration is active and conditions actually fail consecutively
- **Not resolving**: verify success threshold and check for intermittent failures
- **No notifications**: verify attached trigger is active and correctly configured

## Related pages {#related-pages}

- [Triggers](/docs/v4/alerting/triggers)
- [Templates](/docs/v4/alerting/templates)
- [Webhook Examples](/docs/v4/alerting/webhook-examples)
