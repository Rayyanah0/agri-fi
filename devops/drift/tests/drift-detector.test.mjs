import { describe, it, expect } from 'vitest';
import { IaCDriftDetector } from '../iac-drift-detector.mjs';

describe('IaC Drift Detection and Auto-Remediation (#1201)', () => {
  it('detects no drift when live state matches desired state', () => {
    const detector = new IaCDriftDetector();
    const desired = [
      { id: 'vpc-main', type: 'aws_vpc', properties: { cidr: '10.0.0.0/16', enable_dns: true } },
    ];
    const live = [
      { id: 'vpc-main', type: 'aws_vpc', properties: { cidr: '10.0.0.0/16', enable_dns: true } },
    ];

    const report = detector.detectDrift(desired, live);
    expect(report.driftedCount).toBe(0);
    expect(report.missingCount).toBe(0);
    expect(report.unmanagedCount).toBe(0);

    const doc = detector.generateComplianceReport(report);
    expect(doc).toContain('Status: COMPLIANT');
  });

  it('detects modified attributes and flags critical types for approval', () => {
    const detector = new IaCDriftDetector();
    const desired = [
      { id: 'db-prod', type: 'aws_db_instance', properties: { multi_az: true, storage_encrypted: true } },
    ];
    const live = [
      { id: 'db-prod', type: 'aws_db_instance', properties: { multi_az: false, storage_encrypted: true } },
    ];

    const report = detector.detectDrift(desired, live);
    expect(report.driftedCount).toBe(1);
    expect(report.drifted[0].requiresApproval).toBe(true);
    expect(report.drifted[0].differences[0].attribute).toBe('multi_az');

    // Attempt remediation without approval
    const remNoApproval = detector.remediateDrift(report);
    expect(remNoApproval.pendingApproval.length).toBe(1);
    expect(remNoApproval.remediated.length).toBe(0);

    // Remediation with approval
    const remApproved = detector.remediateDrift(report, ['db-prod']);
    expect(remApproved.remediated.length).toBe(1);
    expect(remApproved.pendingApproval.length).toBe(0);
  });

  it('respects approved temporary drift exceptions', () => {
    const detector = new IaCDriftDetector();
    detector.addException('sec-group-1', { reason: 'Emergency debug port open', approvedBy: 'SecOps' });

    const desired = [
      { id: 'sec-group-1', type: 'aws_security_group', properties: { ingress_port: 443 } },
    ];
    const live = [
      { id: 'sec-group-1', type: 'aws_security_group', properties: { ingress_port: 8080 } },
    ];

    const report = detector.detectDrift(desired, live);
    expect(report.driftedCount).toBe(0); // Ignored due to active exception
  });

  it('identifies missing declared resources and untracked live resources', () => {
    const detector = new IaCDriftDetector();
    const desired = [{ id: 'res-a', type: 'aws_s3_bucket', properties: {} }];
    const live = [{ id: 'res-b', type: 'aws_s3_bucket', properties: {} }];

    const report = detector.detectDrift(desired, live);
    expect(report.missingCount).toBe(1);
    expect(report.missing[0].id).toBe('res-a');
    expect(report.unmanagedCount).toBe(1);
    expect(report.unmanaged[0].id).toBe('res-b');
  });
});
