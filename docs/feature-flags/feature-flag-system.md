# Feature Flag System

Feature flags are stored in `feature_flags` and evaluated by `GET /v1/platform/feature-flags/evaluate?key=<key>`. Evaluation is deterministic: explicit user IDs and segments win, then a stable SHA-256 bucket is compared with `rolloutPercentage`. `startsAt` and `endsAt` support scheduled changes.

`POST /v1/platform/feature-flags` creates or updates a flag and writes `feature_flag_audit`. The caller must be restricted to operators or administrators by the deployment's authorization policy. Disabling a flag is the rollback path and takes effect on the next evaluation without deployment.

Applications should default to the safe behavior when the flag service is unavailable. Cache evaluations briefly, invalidate on flag updates, and export evaluation count, enabled count, and error count through the existing metrics system. Never put secrets or authorization decisions solely behind a client-side flag.