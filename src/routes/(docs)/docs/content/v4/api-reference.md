---
title: API Reference
description: Complete REST API documentation for monitors, incidents, and status endpoints
---

Kener provides a comprehensive REST API for managing monitors, incidents, and retrieving status information.

## Explicit API observation capability {#explicit-api-observation-capability}

The authenticated `GET /api/v4/monitors` response includes additive `observation_contract: "wolf-explicit-api-observation-v1"` when the native request-outcome, NO_DATA, freshness and observation-alert path is implemented. Older servers omit it; consumers must not assume the capability from the upstream version string. Existing response fields remain unchanged.

Set `type_data.observation_mode: "explicit"` on an API monitor to opt in. Its selected history responses may additionally include a finite `raw_status`, preserving underlying observation during a finite overlay without exposing request/configuration/error contents. See [API monitor semantics](/docs/v4/monitors/api#explicit-observations) and [no-observation notices](/docs/v4/alerting/alert-configurations#no-observation).

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
