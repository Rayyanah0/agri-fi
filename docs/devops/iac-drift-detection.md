# Infrastructure as Code (IaC) Drift Detection and Auto-Remediation

This document details the IaC drift detection and auto-remediation architecture in Agri-Fi (#1201).

## Objectives

- Enforce alignment between declared IaC configurations (Terraform, CloudFormation, Kubernetes) and deployed cloud state.
- Prevent manual out-of-band changes from introducing security and operational divergence.
- Provide automated rollback for non-critical drift and approval gates for critical infrastructure.

## Architecture

1. **State Tracker**: Ingests desired configuration state manifests.
2. **Drift Detector**: Scans live infrastructure and highlights modified attributes, missing assets, and unmanaged resources.
3. **Approval Gates**: Critical resource classes (databases, IAM roles, security groups, KMS keys) enforce explicit operator sign-off before remediation.
4. **Auto-Remediator**: Re-applies declared parameters to reconcile live state back to the approved baseline.
5. **Exception Registry**: Allows temporary whitelisted modifications with audit tracking and expiration dates.

## Usage

```javascript
import { IaCDriftDetector } from '@/devops/drift/iac-drift-detector.mjs';

const detector = new IaCDriftDetector();

// Run detection
const report = detector.detectDrift(desiredResources, liveResources);

// Remediate with approval for critical items
const result = detector.remediateDrift(report, ['db-prod']);
console.log(result.remediationRate);
```
