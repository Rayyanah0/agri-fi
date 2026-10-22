# Decentralized Identity (DID) & Self-Sovereign Credentials (SSC) for KYC

## 1. Overview
Agri-Fi implements a W3C-compliant Decentralized Identity (DID) and Self-Sovereign Credential (SSC) framework to eliminate repetitive document uploads for farmers, traders, and investors. Verified once by a trusted issuer, identity credentials can be reused across platforms with zero data leakage.

---

## 2. DID Architecture

### Identifier Scheme
Agri-Fi uses the `did:stellar` method bound directly to the user's Stellar Ed25519 public address:
```
did:stellar:GA2MOCKTESTERWALLET1234567890ABCDEF1234567890ABCDEF1234
```

### DID Document Example
```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1"
  ],
  "id": "did:stellar:GA2MOCK...",
  "verificationMethod": [
    {
      "id": "did:stellar:GA2MOCK...#keys-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:stellar:GA2MOCK...",
      "publicKeyMultibase": "zGA2MOCK..."
    }
  ],
  "authentication": ["did:stellar:GA2MOCK...#keys-1"],
  "assertionMethod": ["did:stellar:GA2MOCK...#keys-1"],
  "created": "2026-10-21T14:00:00Z",
  "updated": "2026-10-21T14:00:00Z"
}
```

---

## 3. Credential Lifecycle

```
[Trusted Issuer (Bank/Gov/Coop)]
            │  1. Issue KYC Credential (Anchored On-Chain)
            ▼
     [User Digital Wallet]
            │  2. Selective Disclosure Presentation (Masks PII)
            ▼
    [Agri-Fi Verifier] ──> [Stellar Ledger Verification] (Validates Hash Anchor)
```

### 1. Issuance by Trusted Issuers
- Trusted issuers (accredited commercial banks, agricultural credit cooperatives, regulatory bodies) sign verifiable credentials with Ed25519 private keys.
- A cryptographic SHA-256 digest of the credential payload is anchored onto the Stellar ledger for immutable proof of existence.

### 2. Selective Disclosure
When an exchange or investor requires KYC verification:
- The user creates a **Verifiable Presentation** revealing **only** the required fields (e.g. `kycLevel: "TIER_2"`, `country: "NG"`).
- Unrequested attributes (e.g. `nationalIdHash`, `dateOfBirth`) are masked, preventing identity harvesting.

### 3. Revocation & Expiration
- **Issuer-Initiated Revocation**: Issuers can revoke credentials immediately via the status registry (`/did/credentials/revoke`).
- **Time-Based Expiry**: Credentials expire automatically (default: 365 days).
- **Renewal Alerts**: When within 30 days of expiration, automated notifications notify the wallet holder to re-attest.

---

## 4. Wallet Integration

Digital credentials format conforms to W3C Verifiable Credentials Data Model v1.1 and can be stored in browser extension wallets (Freighter) or mobile DID wallets.

### Performance Impact
- **KYC Verification Time**: Reduced by ~60% for returning farmers and cross-border traders.
- **Data Breach Exposure**: Zero centralized storage of raw passport/national ID scans.
