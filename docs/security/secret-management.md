# Secret management

Agri-Fi uses AWS Secrets Manager as the production secret store. Do not commit
secret values or place them in container images, Terraform source, application
logs, or audit records. Local development may use untracked environment files;
production workloads should use workload IAM roles rather than long-lived AWS
access keys.

## Storage, encryption, and version history

Create secrets in the appropriate AWS account and region, encrypted with the
AWS-managed Secrets Manager key or a customer-managed KMS key. Restrict KMS
administration and decryption permissions separately. Secrets Manager retains
version IDs and staging labels such as `AWSCURRENT` and `AWSPREVIOUS`; secret
values are never returned by the administrative API.

Terraform already provisions the RDS credentials secret and a 30-day rotation
schedule in `devops/terraform/rds.tf`. Configure
`rds_rotation_lambda_arn` with an AWS-supported PostgreSQL rotation Lambda and
verify the secret has an initial, valid JSON credential version before enabling
rotation. The existing Terraform-managed ECS secrets are also populated from
Secrets Manager. Keep Terraform state encrypted, access-controlled, and
versioned because Terraform-managed secret resources can place secret material
in state.

## Runtime access and application injection

The ECS backend task role is scoped to the secret ARNs it manages. The task
definition sets:

- `SECRET_MANAGEMENT_SECRET_IDS`: comma-separated secret ARNs allowed in the
  admin metadata, rotation, and recovery operations.
- `SECRET_ROTATION_REQUIRED_IDS`: the subset expected to have rotation enabled;
  status is checked daily and missing/overdue rotation is logged.

For application-startup injection directly from AWS, set
`APP_SECRET_SECRET_ID` to a JSON secret ID and `APP_SECRET_ENV_KEYS` to a
comma-separated allow-list of `ENVIRONMENT_KEY=JSON_PROPERTY` mappings. When
the names match, the `=JSON_PROPERTY` portion may be omitted. The backend loads
these values before environment validation and startup. Missing, invalid, or
non-string values fail startup; no secret value is written to logs. The ECS
task definition reads `DATABASE_USER` and `DATABASE_PASSWORD` from the
RDS-credentials secret at each task startup. ECS deployments may instead use
the task definition's native `secrets` mapping for other credentials.

After RDS credentials rotate, deploy/restart backend tasks so new database
connections use the new `AWSCURRENT` password. Until task deployment
automation is configured, perform this as part of the rotation runbook and
verify `/health` before closing the change.

The SDK uses the AWS default credential chain. In ECS, grant permissions to the
task role (not the execution role) for runtime reads and management operations.
Limit `GetSecretValue`, `RotateSecret`, and `UpdateSecretVersionStage` to
specific secret ARNs, and grant `kms:Decrypt` only for the corresponding
customer-managed key when needed. Do not grant wildcard secret access.

## Access control and audit

`GET /v1/admin/secrets`, `POST /v1/admin/secrets/rotate`, and
`POST /v1/admin/secrets/recover` require a valid JWT with the `admin` role.
The server rejects IDs outside `SECRET_MANAGEMENT_SECRET_IDS`. The API returns
metadata and version IDs only; it never returns plaintext secret values.
Application code can use `SecretManagementService.getSecretValue` for
allow-listed runtime reads.

Management actions and application reads are recorded through the existing
immutable `system_audit_logs` service with actor, action, status, secret ID,
and (where relevant) version ID. Values are excluded from audit details.
Enable AWS CloudTrail management events, retain the trail in a protected
central log destination, and alert on unauthorized access, failed rotations,
and changes to secret policies. CloudTrail is the authoritative record for
Secrets Manager API activity, including startup injection before the database
audit service is available.

## Rotation, monitoring, recovery

Use an AWS rotation Lambda that updates and tests the backing system before
promoting the pending version. The backend admin rotate action starts an
immediate rotation only when rotation is configured; it does not implement a
provider-specific credential change itself. The daily rotation monitor logs an
error when a required secret is not configured for rotation or is overdue.
Forward these application logs to the deployment's alerting system and use
CloudWatch alarms for Secrets Manager rotation failures.

To recover, an `admin` may call `POST /v1/admin/secrets/recover` with
`{"secretId":"<configured-secret-arn>"}`. This moves `AWSCURRENT` to the
version labeled `AWSPREVIOUS`; it does not print the prior value. Validate the
application and backing service after recovery, then resolve the underlying
rotation failure before retrying. AWS deletion recovery is controlled by the
secret's configured recovery window; this API only rolls back a version label.

## Compliance and operational checks

These controls support least privilege, encryption at rest, change history,
access auditing, retention, and recovery. They are not a claim of regulatory
certification. Compliance owners must set retention and review periods to the
applicable jurisdiction and contract requirements.

Before production release, verify:

1. All production secret ARNs are in the deployment allow-list and IAM policies
   are restricted to those ARNs.
2. The RDS rotation Lambda can rotate and test credentials end to end, and the
   secret's automatic schedule is enabled.
3. CloudTrail delivery, audit-log persistence, rotation-failure alarms, and
   application log alerts are functioning.
4. A recovery drill can promote `AWSPREVIOUS` and restore application
   connectivity without exposing secret values.
5. Secret versions and Terraform state are access-controlled and retained
   according to the approved policy.
