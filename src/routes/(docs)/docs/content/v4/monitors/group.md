---
title: Group Monitor
description: Combine multiple monitors into a weighted or role-based aggregate status
---

Group monitors aggregate member monitor status and latency into one monitor. By default the status is a weighted score; give members a `role` to roll it up by what each member means for the group instead ([Member roles](#member-roles)).

## Minimum setup {#minimum-setup}

Requirements from current validation:

- at least **2** member monitors
- members must be active, non-group monitors
- weights must sum to approximately `1` (tolerance `0.01`)
- `executionDelay` must be `>= 1000` ms
- `latencyCalculation` in `AVG | MAX | MIN`

## Status scoring model {#status-scoring-model}

Member statuses are normalized to a 0–1 scale:

- `UP = 1`
- `DEGRADED = 0.5`
- `DOWN = 0`

Members in `MAINTENANCE` are treated as `UP` (score `1`) and do not affect the group status. This scoring applies while no member has a `role`.

Weighted score:

```
Σ(member.weight * statusScore)
```

Mapped group status:

- `= 1` → **UP** (all members healthy)
- `> 0` and `< 1` → **DEGRADED** (partial failure)
- `= 0` → **DOWN** (all members down)

### Example {#scoring-example}

5 monitors with equal weight (`0.2` each), 1 is DOWN:

```
4 × 0.2 × 1 (UP) + 1 × 0.2 × 0 (DOWN) = 0.8 → DEGRADED
```

## Member roles {#member-roles}

Set `role` on a member when its failure means something specific for the group: `required` (people cannot use the group without it) or `supporting` (the group works without it, but worse). Weights are then ignored for the status.

As soon as one member has a `role`, every configured member counts and the group takes the first matching row. A member without a `role` counts as `required`. A member is **unknown** when it has no current result or its result is `NO_DATA`.

| Order | When                                                                 | Group status  |
| :---- | :------------------------------------------------------------------- | :------------ |
| 1     | every member is unknown                                              | `NO_DATA`     |
| 2     | every member is `DOWN`                                               | `DOWN`        |
| 3     | a `required` member is `DOWN`                                        | `DOWN`        |
| 4     | a `required` member is unknown                                       | `NO_DATA`     |
| 5     | every member is in `MAINTENANCE`                                     | `MAINTENANCE` |
| 6     | a `required` member is in `MAINTENANCE`                              | `MAINTENANCE` |
| 7     | any other member is not `UP` (including an unknown `supporting` one) | `DEGRADED`    |
| 8     | every member is `UP`                                                 | `UP`          |

A required member that cannot be seen never makes the group `UP`, and it does not invent an outage either. Latency is calculated as before and does not depend on roles.

A result is **current** when it comes from the member's previous scheduled run or later (the run due this minute may still be in flight). A member that is paused, deleted, or has missed a whole run of its own cron schedule is unknown, even if its last result was `UP`. A member updated only through the API stays current while its runs carry the status forward, for example a None monitor with **Override with last known status**. Groups without roles keep the weighted score, including last-known results.

A group's own **Default Status** does not replace this `NO_DATA`: with roles, `NO_DATA` is the group's finding, not a missing check.

Use exactly `required` or `supporting`: the API does not validate the value, and any other value counts as `supporting`. Weights must still sum to `1`, as in [Minimum setup](#minimum-setup).

Roles are set through the API. The group editor in the dashboard has no role control, but it keeps the roles already set when you save:

```json
{
    "monitor_type": "GROUP",
    "type_data": {
        "monitors": [
            { "tag": "web", "weight": 0.5, "role": "required" },
            { "tag": "search", "weight": 0.5, "role": "supporting" }
        ],
        "executionDelay": 1000,
        "latencyCalculation": "AVG"
    }
}
```

With this setup `search` being `DOWN` makes the group `DEGRADED`, and `web` being `DOWN` makes it `DOWN`.

## Events on group members {#events-on-group-members}

A page lists the incidents and maintenances of every monitor it shows, group members included, while the group stays one row. On that page an event names a member by where it sits: an incident on `API` inside the `Search` group reads **Search › API**, and on a page that shows a `Product` group containing `Search` it reads **Product › Search › API**. A page's own rows, and events shown anywhere without a page (a monitor's own page, embeds), use the monitor's name alone.

## Latency aggregation {#latency-aggregation}

Group latency uses selected mode:

- `AVG`: average member latency
- `MAX`: slowest member latency
- `MIN`: fastest member latency

## Execution delay {#execution-delay}

`executionDelay` (in milliseconds) controls how long the group monitor waits before running its aggregation. This delay gives member monitors time to complete their own checks and update the cache before the group reads their statuses.

- Default: `1000` (1 second). Minimum: `1000`.
- If member monitors take longer to finish (e.g. slow API checks), increase this value so the group always reads fresh results.
- Only affects cron-driven execution. When a member's status is updated via the API, the cache is updated immediately and the group will read the new value on its next run.

## Configuration fields {#configuration-fields}

| Field                | Type                          | Default | Notes                                                 |
| :------------------- | :---------------------------- | :------ | :---------------------------------------------------- |
| `monitors`           | `Array<{tag, weight, role?}>` | `[]`    | Required, min 2; `role` is `required` or `supporting` |
| `executionDelay`     | `number`                      | `1000`  | ms to wait before aggregating; must be >= 1000        |
| `latencyCalculation` | `AVG\|MAX\|MIN`               | `AVG`   |                                                       |

## Example {#example}

```json
{
    "monitor_type": "GROUP",
    "type_data": {
        "monitors": [
            { "tag": "api", "weight": 0.6 },
            { "tag": "db", "weight": 0.3 },
            { "tag": "cache", "weight": 0.1 }
        ],
        "executionDelay": 1500,
        "latencyCalculation": "AVG"
    }
}
```

## Troubleshooting {#troubleshooting}

- **Cannot save**: verify weights sum to `1`, min member count, and delay >= `1000`
- **Unexpected stale status (cron)**: increase `executionDelay` so member checks finish before the group aggregates
- **Unexpected stale status (API updates)**: ensure you are running a version that updates the cache on API writes — older versions only updated the cache from cron, causing the group to miss API-driven status changes
- **Group too sensitive/lenient**: adjust weights — higher weight on critical monitors makes their failure impact the group score more. With roles, weights are ignored: change a member's `role` instead
- **Group is `NO_DATA` with roles**: a required member has no current result. Check that it is active, that its checks complete on its schedule, and that `executionDelay` lets them finish
