import { describe, expect, it } from 'vitest';
import {
  colorForUser,
  initialsFor,
  statusLabel,
} from '@/lib/collaboration';

describe('collaboration helpers (#1234)', () => {
  it('derives stable initials', () => {
    expect(initialsFor('Amina Okafor')).toBe('AO');
    expect(initialsFor('Cher')).toBe('CH');
    expect(initialsFor('   ')).toBe('?');
  });

  it('keeps a stable colour per user', () => {
    expect(colorForUser('user-1')).toBe(colorForUser('user-1'));
    expect(colorForUser('user-1')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('labels activity status', () => {
    expect(statusLabel('typing')).toBe('typing…');
    expect(statusLabel('idle')).toBe('idle');
    expect(statusLabel('active')).toBe('active');
  });
});
