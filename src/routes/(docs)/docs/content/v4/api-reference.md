---
title: API Reference
description: Complete REST API documentation for monitors, incidents, and status endpoints
---

Kener provides a comprehensive REST API for managing monitors, incidents, and retrieving status information.

## Base URL

```
https://your-kener-instance.com/api
```

## Authentication

All API requests require authentication using a Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-kener.com/api/monitors
```

### Generating API Keys

1. Log in to the admin panel
2. Navigate to Settings > API Keys
3. Click "Generate New Key"
4. Set permissions and save
5. Copy the key (shown only once)

## Response Format

All responses are JSON:

```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
```

### Error Responses

```json
{
    "success": false,
    "error": {
        "code": "INVALID_REQUEST",
        "message": "Description of the error"
    }
}
```

## Rate Limiting

- **Default limit**: 100 requests per minute
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`

## Endpoints Overview

| Method | Endpoint        | Description         |
| ------ | --------------- | ------------------- |
| GET    | `/monitors`     | List all monitors   |
| POST   | `/monitors`     | Create a monitor    |
| GET    | `/monitors/:id` | Get monitor details |
| PUT    | `/monitors/:id` | Update a monitor    |
| DELETE | `/monitors/:id` | Delete a monitor    |
| GET    | `/incidents`    | List incidents      |
| POST   | `/incidents`    | Create incident     |
| GET    | `/status`       | Get current status  |
| POST   | `/v4/images`    | Upload an image     |

## Quick Examples

### Preserve a superseded Unknown monitor {#standing-retirement}

The Wolfsblvt fork adds `POST /api/v4/standing-retirements` for an operator admitting a real observation for the **same subject** as an existing Unknown placeholder. Use the ordinary v4 Bearer key and JSON body:

```json
{
    "replacements": [{ "tag": "unknown-example", "replacement": "example-observation" }]
}
```

The source must be an exact `unknown-*` tag, type `NONE`, default `NO_DATA`, with empty type data. The destination must already be a real observation, not another `NONE` or `GROUP`. Keep its fixed producer tag. When that fixed tag is not required and no distinct observation exists, ordinary monitor PATCH can instead admit the observation in place, retaining the original monitor identity.

This operation moves the placeholder's monitoring samples, incident/maintenance links, page membership and settings/order, group member options, and alert relationships directly in one database transaction. It preserves stored sample types, raw status, timestamps, event impacts and the destination monitor's identity/configuration. It neither copies data through the MANUAL-writing API nor invokes destructive monitor DELETE. Run it with the estate's normal single configuration writer and no concurrent writers to the superseded subject.

An overlapping sample timestamp, existing destination membership in the same event/page/alert configuration, or both tags in one group returns HTTP `409`, with `error.code: STANDING_RETIREMENT_CONFLICT` and a finite `reason`. Every change in that batch rolls back. Resolve the actual subject/collision with the responsible operator; the API never chooses which valued record to discard. Inventory is read directly from the database, without the incident-list cap.

HTTP `200` returns `results`, one `{tag, replacement, outcome, moved}` per pair. `retired` and its per-table counts describe the committed reassociation; `already-absent` only observes that the source is absent and the destination exists. It is not a claim about who previously retired it. A retry preserves the database and clears affected status caches again. HTTP `500` (`RETIREMENT_UNOBSERVED`) or a lost response may follow a commit: read the exact two identities/history/references, then repeat the same operation to reconcile. Do not fall back to DELETE. Upstream releases without this endpoint cannot supply this preservation operation.

### Get All Monitors

```bash
curl -X GET https://your-kener.com/api/monitors \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Create an Incident

```bash
curl -X POST https://your-kener.com/api/incidents \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Service Disruption",
    "status": "investigating",
    "impact": "major",
    "message": "We are investigating reports of service issues."
  }'
```

### Get Current Status

```bash
curl -X GET https://your-kener.com/api/status
```

## SDKs and Libraries

Community-maintained SDKs:

- **JavaScript/Node.js**: `npm install kener-sdk`
- **Python**: `pip install kener-python`
- **Go**: `go get github.com/kener/go-sdk`

## Webhooks

Receive real-time notifications for events:

```json
{
    "event": "monitor.down",
    "timestamp": "2024-01-15T10:30:00Z",
    "data": {
        "monitor_id": "abc123",
        "name": "API Server",
        "status": "down"
    }
}
```

See the [OpenAPI reference](/docs/spec/v4/) for authentication and monitor endpoints.
