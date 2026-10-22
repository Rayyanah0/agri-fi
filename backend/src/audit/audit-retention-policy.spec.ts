import {
  auditRetentionPeriod,
  auditRetentionUntil,
  classifyAuditLog,
} from './audit-retention-policy';

describe('audit retention policy', () => {
  it.each([
    ['/api/v1/investments', 'financial_transaction', '7 years'],
    ['/api/v1/kyc/submissions', 'kyc_document', '5 years'],
    ['/api/v1/documents', 'kyc_document', '5 years'],
    ['/api/v1/users', 'operational', '1 year'],
    ['/internal/debug', 'debug', '90 days'],
  ] as const)(
    'classifies %s with the correct policy',
    (route, expectedType, expectedPeriod) => {
      expect(classifyAuditLog(route)).toBe(expectedType);
      expect(auditRetentionPeriod(expectedType)).toBe(expectedPeriod);
    },
  );

  it('uses the calendar retention date from the log creation time', () => {
    const createdAt = new Date('2024-02-29T12:00:00.000Z');

    expect(auditRetentionUntil('financial_transaction', createdAt)).toEqual(
      new Date('2031-02-28T12:00:00.000Z'),
    );
    expect(auditRetentionUntil('debug', createdAt)).toEqual(
      new Date('2024-05-29T12:00:00.000Z'),
    );
  });
});
