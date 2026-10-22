export type AuditLogType =
  | 'financial_transaction'
  | 'kyc_document'
  | 'operational'
  | 'debug';

export function classifyAuditLog(routeOrEntity: string): AuditLogType {
  const value = routeOrEntity.toLowerCase();
  if (/(^|[/_.-])(kyc|kycs|documents?)([/_.-]|$)/.test(value)) {
    return 'kyc_document';
  }
  if (
    /(investment|payout|payment|settlement|transaction|trade.?deal)/.test(value)
  ) {
    return 'financial_transaction';
  }
  return 'operational';
}

export function auditRetentionPeriod(logType: AuditLogType): string {
  switch (logType) {
    case 'financial_transaction':
      return '7 years';
    case 'kyc_document':
      return '5 years';
    case 'operational':
      return '1 year';
    case 'debug':
      return '90 days';
  }
}

export function auditRetentionUntil(
  logType: AuditLogType,
  createdAt: Date = new Date(),
): Date {
  const retainedUntil = new Date(createdAt);
  if (logType === 'debug') {
    retainedUntil.setUTCDate(retainedUntil.getUTCDate() + 90);
  } else {
    const years =
      logType === 'financial_transaction'
        ? 7
        : logType === 'kyc_document'
          ? 5
          : 1;
    const targetYear = retainedUntil.getUTCFullYear() + years;
    const dayOfMonth = retainedUntil.getUTCDate();
    retainedUntil.setUTCDate(1);
    retainedUntil.setUTCFullYear(targetYear);
    const lastDayOfMonth = new Date(
      Date.UTC(targetYear, retainedUntil.getUTCMonth() + 1, 0),
    ).getUTCDate();
    retainedUntil.setUTCDate(Math.min(dayOfMonth, lastDayOfMonth));
  }
  return retainedUntil;
}
