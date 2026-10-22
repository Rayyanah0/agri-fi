# Document malware scanning

Every trade-document upload (`POST /v1/documents`, `POST /v1/documents/upload-complete`)
is scanned by ClamAV before anything is written to storage or anchored on Stellar.

## Fail-closed semantics

`DocumentsService.scanBeforeUpload` runs before the file signature check, compression,
IPFS/S3 upload, Stellar anchoring and database write. If the scan cannot be completed,
the request is rejected and **no file is persisted**:

| Condition | Response |
|---|---|
| Virus found | `422` `File rejected: virus detected (<name>)` |
| ClamAV unreachable (connection refused, DNS failure, timeout) | `503` `code: SCAN_UNAVAILABLE` |
| Unexpected/garbled ClamAV response | `503` `code: SCAN_UNAVAILABLE` |

```
HTTP/1.1 503 Service Unavailable
{
  "statusCode": 503,
  "error": "Service Unavailable",
  "code": "SCAN_UNAVAILABLE",
  "message": "Document security scanning is unavailable; upload rejected. This service fails closed rather than accepting unscanned files."
}
```

There is no "skip the scan and continue" path. A scanner outage disables document
uploads, which is intentional: letting unscanned documents through would silently
weaken the document integrity pipeline that Stellar anchoring depends on.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `CLAM_SCAN_ENABLED` | `true` | Forced to `true` by `env.validation.ts` when `NODE_ENV=production`; can only be disabled outside production. |
| `CLAMAV_HOST` | `clamav` | ClamAV daemon host. |
| `CLAMAV_PORT` | `3310` | ClamAV TCP port (`clamd` INSTREAM protocol). |

## Health and monitoring

`GET /v1/health/detail` (admin IP allowlist, same guard as `/metrics`) includes a
`documents` block:

```json
{
  "documents": {
    "status": "down",
    "scan_available": false,
    "scan_enabled": true,
    "mode": "fail-closed",
    "endpoint": { "host": "clamav", "port": 3310 }
  }
}
```

- `scan_available` is the `documents.scan_available` flag from the issue: `true` only
  when a ClamAV `PING` succeeds.
- `mode` is one of `scanning`, `fail-closed` (enabled but unreachable) or `disabled`
  (`CLAM_SCAN_ENABLED=false`).
- Liveness/readiness (`GET /v1/health`) intentionally **excludes** this check so the
  backend stays up during a scanner outage; only uploads are degraded.

When `documents.scan_available=false` in production, alert on upload `503`s and check
that the `clamav` service is running and reachable from the backend pods
(`nc -z $CLAMAV_HOST $CLAMAV_PORT`).

## Tests

- `src/documents/documents.service.spec.ts` covers clean files, infected files, the
  scan-unavailable path (structured `SCAN_UNAVAILABLE`, no storage call) and the
  explicit `CLAM_SCAN_ENABLED=false` branch.
- `src/health/document-scan.health-indicator.spec.ts` covers the health reporting
  branches (`scanning`, `fail-closed`, `disabled`).
