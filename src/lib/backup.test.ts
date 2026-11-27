import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/data/seed';
import type { AppState } from '@/data/types';
import { backupJson, createBackup, readBackup, restoreBlocker, summariseBackup } from './backup';

function workspace(): AppState {
  const base = createInitialState();
  const customer = {
    id: 'c1',
    name: 'Test Customer',
    contactName: 'Sam Test',
    email: 'sam@example.com',
    phone: '0400 000 000',
    address: '1 Test Street, Bendigo VIC 3550',
    notes: '',
    sourceType: 'TEST' as const,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
  const job = {
    id: 'j1',
    customerId: 'c1',
    jobNumber: 'J-0001',
    title: 'Test roof',
    siteAddress: '1 Test Street, Bendigo VIC 3550',
    status: 'measured' as const,
    notes: '',
    sourceType: 'TEST' as const,
    profileId: null,
    crsEpsg: 7855,
    operatorApproved: false,
    colour: 'Monument',
    requiredBy: '2026-12-10',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
  return { ...base, customers: [customer], jobs: [job] };
}

describe('workspace backup', () => {
  it('round-trips a workspace exactly, ids and revisions included', () => {
    const state = workspace();
    const backup = createBackup(state, '2026-11-26T00:00:00.000Z');
    const read = readBackup(backupJson(backup));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.warnings).toEqual([]);
    expect(read.backup.state).toEqual(state);
    expect(read.backup.counts.customers).toBe(1);
    expect(read.backup.exportedAt).toBe('2026-11-26T00:00:00.000Z');
  });

  it('leaves the live workspace untouched when the backup is edited later', () => {
    const state = workspace();
    const backup = createBackup(state);
    backup.state.customers[0].name = 'Edited';
    expect(state.customers[0].name).toBe('Test Customer');
  });

  it('refuses a file that is not a backup, rather than restoring nothing quietly', () => {
    const read = readBackup('{"hello":"world"}');
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems[0]).toContain('not a Sheet Set Pro backup');
  });

  it('refuses a backup from a newer build', () => {
    const backup = createBackup(workspace());
    const read = readBackup(JSON.stringify({ ...backup, version: 99 }));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems[0]).toContain('newer version');
  });

  it('refuses a record that points at something the file does not contain', () => {
    const backup = createBackup(workspace());
    const broken = { ...backup, state: { ...backup.state, customers: [] } };
    const read = readBackup(JSON.stringify(broken));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems.join(' ')).toContain('names customer c1, which is not in the backup');
  });

  it('warns, but still reads, when the contents no longer match the checksum', () => {
    const backup = createBackup(workspace());
    const tampered = {
      ...backup,
      state: { ...backup.state, jobs: [{ ...backup.state.jobs[0], title: 'Changed by hand' }] },
    };
    const read = readBackup(JSON.stringify(tampered));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.warnings.join(' ')).toContain('checksum does not match');
  });

  it('warns when the file claims a count it does not contain', () => {
    const backup = createBackup(workspace());
    const lying = { ...backup, counts: { ...backup.counts, jobs: 7 } };
    const read = readBackup(JSON.stringify(lying));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.warnings.join(' ')).toContain('claims 7 record(s) but contains 1');
  });

  it('restores into an empty workspace but not over live records in a shared database', () => {
    const state = workspace();
    const empty = { ...createInitialState(), catalogue: [], activity: [] };
    expect(restoreBlocker(state, 'local')).toBeNull();
    expect(restoreBlocker(empty, 'remote')).toBeNull();
    expect(restoreBlocker(state, 'remote')).toContain('already holds records');
  });

  it('describes what a backup holds', () => {
    const backup = createBackup(workspace());
    expect(summariseBackup(backup)).toBe('1 customer · 2 catalogue · 1 job · 1 activity event');
  });
});
