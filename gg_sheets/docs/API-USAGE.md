# API usage

Base URL local: `http://localhost:3000`. Admin and management routes are intended
for a trusted local network or an HTTPS reverse proxy. The Admin HTML shell is at
`GET /admin`; its data and write APIs require the management key.

## Management authentication

Send `x-api-key: <MANAGEMENT_API_KEY>` on each `/api/v1/sync` request. Do not put
the key in a URL or browser query string. The API rejects the sample placeholder
key and rate-limits repeated authentication failures.

PowerShell example (enter your key in the current terminal; do not commit it):

```powershell
$apiKey = Read-Host 'Management API key'
$headers = @{ 'x-api-key' = $apiKey }
Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/v1/sync/run' -Headers $headers
```

## Routes

| Method and path                             | Purpose                                                                  | Successful response                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `POST /api/v1/sync/run`                     | Run Sheet → CRM now                                                      | Sync result with created, updated, skipped, errors and timestamps       |
| `POST /api/v1/sync/reverse-run`             | Run CRM → linked Sheet rows now                                          | Reverse result with checked rows, updates, conflicts and errors         |
| `GET /api/v1/sync/admin/config`             | Read the active mapping                                                  | Canonical mapping JSON                                                  |
| `PUT /api/v1/sync/admin/config`             | Validate and atomically save mapping                                     | Saved mapping JSON                                                      |
| `GET /api/v1/sync/admin/history`            | View the latest 100 runs                                                 | `{ "runs": [], "persistenceError": false }`                             |
| `POST /api/v1/sync/admin/connections/check` | Probe Google/Bitrix read APIs and the configured public webhook receiver | Per-service status, latency, receiver result and latest webhook history |
| `GET /api/v1/sync/admin`                    | Check management authentication                                          | `{ "authenticated": true }`                                             |

All routes above require `x-api-key`. A concurrent sync may return HTTP 409 with
`SYNC_LOCKED`; wait for the current run instead of starting another writer.
Validation errors return a 4xx response. API results report per-row errors; inspect
the `errorDetails` array and Admin history for the affected row.

## Bitrix24 outbound webhook

Register `POST /webhooks/bitrix24/leads` in the Bitrix24 outbound webhook settings
for `ONCRMLEADADD` and `ONCRMLEADUPDATE`. Configure the shared application token as
`BITRIX24_WEBHOOK_SECRET` in the app. Bitrix sends its `auth[application_token]`;
the custom `x-bitrix-webhook-secret` header is supported for diagnostics.

The receiver authenticates, validates the event and Lead ID, queues the work, then
returns HTTP 202. `202` confirms the event was accepted into the process-local queue;
it does not mean the Sheet write has finished. Check Admin history for completion.
The in-memory queue coalesces bursts and retries transient failures. A restart can
discard queued events; scheduled reverse sync is the reconciliation path.

The Admin **Check connection** action sends a signed challenge to the configured
HTTPS receiver and verifies the response. This confirms URL reachability, app route,
and the app-to-app secret. It does not verify Bitrix portal registration or prove
that Bitrix itself sent an event; perform the live test in [TEST-PLAN.md](TEST-PLAN.md).

## Example response fields

Sync endpoints return counts and ISO timestamps, for example:

```json
{
  "totalRows": 2,
  "created": 1,
  "updated": 0,
  "skipped": 1,
  "errors": 0,
  "errorDetails": [],
  "startedAt": "2026-10-02T00:00:00.000Z",
  "finishedAt": "2026-10-02T00:00:01.000Z"
}
```

Counts are rows processed, except reverse `totalChecked`, which counts unique Lead
IDs returned by CRM. Never log or attach management/API keys, webhook tokens, OAuth
refresh tokens, service-account JSON, or customer records when reporting a failure.
