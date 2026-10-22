# Biometric Authentication

This document details the biometric authentication layer in Agri-Fi (#1203).

## Architecture

Biometric authentication provides hardware-backed FIDO2 / WebAuthn validation as an optional high-security tier for platform logins and critical transaction approvals.

## Capabilities

- **Registration / Enrollment**: Generates credential IDs and stores public keys linked to user profiles.
- **Assertion Verification**: Validates WebAuthn signature assertions against registered cryptographic public keys.
- **Anti-Spoofing and Clone Detection**: Enforces monotonic signature counter validation (`signCount`). Cloned or replayed signatures are rejected.
- **Revocation**: Users can manage and disable compromised or obsolete authenticators.
- **Fallback**: Gracefully falls back to standard multi-factor password/JWT authentication.

## API Endpoints

- `POST /auth/biometric/challenge`: Generates a single-use authentication challenge.
- `POST /auth/biometric/enroll`: Enrolls a newly paired biometric authenticator.
- `POST /auth/biometric/verify`: Verifies authentication response from biometric hardware.
- `GET /auth/biometric/credentials`: Lists active registered credentials for the user.
- `DELETE /auth/biometric/credentials/:credentialId`: Revokes a registered credential.
- `GET /auth/biometric/analytics`: Aggregated verification success and usage metrics.
