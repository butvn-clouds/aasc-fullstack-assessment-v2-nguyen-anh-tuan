# Test plan and acceptance cases

Run manual API cases against a dedicated test Sheet and Bitrix24 portal. Do not use
production customer contacts. Before a destructive test, record the test Lead IDs
and save the initial values so the test data can be restored.

## Automated checks

```powershell
npm ci
npm run verify
```

`verify` runs TypeScript typecheck, ESLint, Jest coverage (minimum 70% for statements,
branches, functions and lines), the 150-row mock performance case, and production
build. Run `npm run test:e2e` for HTTP/module wiring. Mock tests verify application
behavior; they do not prove portal permissions, Google quota, or public webhook reachability.

The named specs group the corresponding checks:

| Area                                       | Specs                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| Lead create/update, dedup and batch errors | `sync.service.spec.ts`, `regressions.spec.ts`, `batch-retry.spec.ts`     |
| Reverse mapping and conflicts              | `two-way-sync.service.spec.ts`, `linked-conflict.spec.ts`                |
| Webhook HTTP/auth/queue                    | `webhook-http.spec.ts`, `realtime-sync.queue.spec.ts`                    |
| Recovery after ambiguous create            | `recovery.spec.ts`                                                       |
| Mapping compatibility and validation       | `mapping-compat.spec.ts`, `configuration.spec.ts`                        |
| Google API behavior                        | `google-sheets.service.spec.ts`                                          |
| Security and throttling                    | `api-key.guard.spec.ts`, `security.spec.ts`, `rate-limiter.util.spec.ts` |

## Live acceptance table

Use the Admin, manual endpoints in [API usage](API-USAGE.md), or the configured
cron. Record the date, result counts and test Lead ID; do not record secrets.

| ID   | Scenario and steps                                                                                                                             | Expected result                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| TC1  | Add a valid Sheet row with a unique email/phone and required name; run forward.                                                                | One CRM Lead is created; its ID, status, timestamp and sync hash are written to that row.                                |
| TC2  | Change a mapped field on the linked Sheet row; run forward.                                                                                    | The same CRM Lead ID is updated; no new Lead is created.                                                                 |
| TC3  | Run again without changing mapped fields.                                                                                                      | Row is skipped; CRM does not receive a create/update for it.                                                             |
| TC4a | Add an unlinked row with an existing email but different phone.                                                                                | Existing Lead is updated; new Lead is not created; existing ID is linked.                                                |
| TC4b | Repeat using a new email and an existing phone.                                                                                                | Existing Lead is updated by phone; new Lead is not created.                                                              |
| TC4c | Set email and phone to contacts belonging to different CRM Leads.                                                                              | Row reports an ambiguity error; neither Lead is silently selected.                                                       |
| TC5  | Put the same Lead ID on multiple Sheet rows with different titles and run forward.                                                             | Writes are serialized by row number; the last writable row wins for overlapping fields; no duplicate Lead is created.    |
| TC6  | Link multiple rows to one Lead, change mapped CRM fields, run reverse.                                                                         | Each linked row receives the configured reverse fields; no unlinked CRM Lead is imported.                                |
| TC7a | With `SYNC_DIRECTION=both` and `bitrix_wins`, change the same mapped field in CRM and Sheet after a common baseline; run reverse then forward. | CRM value is pulled to Sheet; the subsequent forward run does not overwrite it with the stale Sheet value.               |
| TC7b | Repeat with `sheet_wins`.                                                                                                                      | Sheet value is retained and sent to CRM.                                                                                 |
| TC8  | Configure outbound events and secret; edit a linked Lead in Bitrix without manual sync.                                                        | Bitrix request is accepted (202); queued reverse run updates Sheet; Admin history records completion.                    |
| TC9  | Repeat the same webhook event or send two rapid updates.                                                                                       | Duplicate IDs are coalesced; final Sheet value matches CRM; retry/queue behavior is visible in history/logs.             |
| TC10 | Use an invalid status/enum, missing required field, malformed Lead ID, or protected Sheet.                                                     | Row/API reports a clear error; unrelated rows continue where safe; no incorrect Lead ID is written.                      |
| TC11 | Call a protected route without a key and then with the configured key.                                                                         | No key/invalid key is rejected; valid key succeeds; repeated failures are throttled.                                     |
| TC12 | Stop the tunnel, press Admin connection check, restore tunnel, press it again.                                                                 | First check reports receiver failure; second verifies public callback and challenge. Neither check changes CRM or Sheet. |

For TC8, the Admin challenge only confirms the public URL reaches this app with the
configured secret. It is not a substitute for the Bitrix-originated event test.
Inspect the event request in ngrok and the corresponding webhook run in Admin history.

## Evidence record

For each live test, capture the test case ID, UTC/local timestamp, input row number,
Lead ID, result counts, expected/actual outcome and whether the Sheet/CRM was restored.
Mask email/phone in screenshots. Do not include `.env`, OAuth tokens, inbound/outbound
webhook secrets, service-account credentials, or customer data in the submission.
