const crypto = require('crypto');

jest.mock('fs');
const fs = require('fs');

const {
  recordScan,
  readAuditLog,
  queryAuditLog,
  getStatistics,
  verifyIntegrity,
  clearAuditLog,
} = require('../audit');

// Helper: build a valid audit entry with correct hash chain
function buildAuditEntry(overrides = {}, previousHash = null) {
  const entry = {
    timestamp: overrides.timestamp || new Date().toISOString(),
    commitHash: overrides.commitHash || 'abc123',
    filesScanned: overrides.filesScanned || ['file1.js'],
    findings: overrides.findings || [],
    findingCount: overrides.findings ? overrides.findings.length : 0,
    severityCounts: overrides.severityCounts || {},
    userDecision: overrides.userDecision || null,
    previousHash,
  };

  const content = JSON.stringify({
    timestamp: entry.timestamp,
    commitHash: entry.commitHash,
    filesScanned: entry.filesScanned,
    findings: entry.findings,
    findingCount: entry.findingCount,
    severityCounts: entry.severityCounts,
    userDecision: entry.userDecision,
    previousHash: entry.previousHash,
  });

  entry.hash = crypto.createHash('sha256').update(content).digest('hex');
  return entry;
}

describe('recordScan', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('');
    fs.appendFileSync.mockImplementation(() => {});
    fs.mkdirSync.mockImplementation(() => {});
  });

  test('writes a JSONL entry to the audit log', () => {
    // No existing entries
    fs.readFileSync.mockReturnValue('');

    const result = recordScan({
      commitHash: 'deadbeef',
      filesScanned: ['src/app.js'],
      findings: [{ id: 1 }],
      severityCounts: { high: 1 },
      userDecision: 'fix',
    });

    expect(result).toBe(true);
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);

    // Verify written JSONL
    const written = fs.appendFileSync.mock.calls[0][1];
    expect(written.endsWith('\n')).toBe(true);

    const parsed = JSON.parse(written.trim());
    expect(parsed.commitHash).toBe('deadbeef');
    expect(parsed.filesScanned).toEqual(['src/app.js']);
    expect(parsed.findingCount).toBe(1);
    expect(parsed.severityCounts).toEqual({ high: 1 });
    expect(parsed.userDecision).toBe('fix');
    expect(parsed.hash).toBeDefined();
    expect(parsed.timestamp).toBeDefined();
  });

  test('includes previousHash from the last log entry', () => {
    const prev = buildAuditEntry({ timestamp: '2025-01-01T00:00:00.000Z' }, null);

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(prev) + '\n');

    recordScan({ commitHash: 'second' });

    const written = JSON.parse(fs.appendFileSync.mock.calls[0][1].trim());
    expect(written.previousHash).toBe(prev.hash);
  });

  test('returns false when appendFileSync throws', () => {
    fs.appendFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = recordScan({ commitHash: 'fail' });
    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('queryAuditLog', () => {
  const entries = [
    buildAuditEntry({
      timestamp: '2025-01-10T00:00:00.000Z',
      userDecision: 'fix',
      findings: [{ id: 1 }],
      severityCounts: { high: 1 },
    }, null),
  ];
  // Build second entry chained to first
  entries.push(
    buildAuditEntry(
      {
        timestamp: '2025-02-15T00:00:00.000Z',
        userDecision: 'bypass',
        findings: [{ id: 2 }, { id: 3 }],
        severityCounts: { critical: 1, medium: 1 },
      },
      entries[0].hash
    )
  );
  entries.push(
    buildAuditEntry(
      {
        timestamp: '2025-03-20T00:00:00.000Z',
        userDecision: 'fix',
        findings: [],
        severityCounts: {},
      },
      entries[1].hash
    )
  );

  const logContent = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';

  beforeEach(() => {
    jest.resetAllMocks();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(logContent);
  });

  test('returns all entries when no filters applied', () => {
    const result = queryAuditLog();
    expect(result).toHaveLength(3);
  });

  test('filters by since date', () => {
    const result = queryAuditLog({ since: '2025-02-01' });
    expect(result).toHaveLength(2);
    expect(new Date(result[0].timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date('2025-02-01').getTime()
    );
  });

  test('filters by until date', () => {
    const result = queryAuditLog({ until: '2025-02-28' });
    expect(result).toHaveLength(2);
  });

  test('filters by since and until together', () => {
    const result = queryAuditLog({ since: '2025-02-01', until: '2025-02-28' });
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe('2025-02-15T00:00:00.000Z');
  });

  test('filters by decision', () => {
    const result = queryAuditLog({ decision: 'bypass' });
    expect(result).toHaveLength(1);
    expect(result[0].userDecision).toBe('bypass');
  });

  test('filters by minFindings', () => {
    const result = queryAuditLog({ minFindings: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].findingCount).toBeGreaterThanOrEqual(2);
  });

  test('filters by severity', () => {
    const result = queryAuditLog({ severity: 'critical' });
    expect(result).toHaveLength(1);
    expect(result[0].severityCounts.critical).toBeGreaterThan(0);
  });

  test('returns empty array when no entries match', () => {
    const result = queryAuditLog({ since: '2099-01-01' });
    expect(result).toHaveLength(0);
  });
});

describe('getStatistics', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns zeroed stats for empty log', () => {
    fs.existsSync.mockReturnValue(false);

    const stats = getStatistics();
    expect(stats.totalScans).toBe(0);
    expect(stats.totalFindingsLogged).toBe(0);
    expect(stats.averageBypassRate).toBe(0);
    expect(stats.severityTotals.critical).toBe(0);
  });

  test('returns correct counts for populated log', () => {
    const entry1 = buildAuditEntry({
      findings: [{ id: 1 }, { id: 2 }],
      severityCounts: { critical: 1, high: 1 },
      userDecision: 'bypass',
    }, null);
    const entry2 = buildAuditEntry({
      findings: [{ id: 3 }],
      severityCounts: { medium: 1 },
      userDecision: 'fix',
    }, entry1.hash);

    const logContent = [JSON.stringify(entry1), JSON.stringify(entry2)].join('\n') + '\n';

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(logContent);

    const stats = getStatistics();
    expect(stats.totalScans).toBe(2);
    expect(stats.totalFindingsLogged).toBe(3);
    expect(stats.severityTotals.critical).toBe(1);
    expect(stats.severityTotals.high).toBe(1);
    expect(stats.severityTotals.medium).toBe(1);
    expect(stats.severityTotals.low).toBe(0);
    expect(stats.decisionCounts.bypass).toBe(1);
    expect(stats.decisionCounts.fix).toBe(1);
    expect(stats.averageBypassRate).toBe('50.00%');
  });
});

describe('verifyIntegrity', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns valid for empty log', () => {
    fs.existsSync.mockReturnValue(false);

    const result = verifyIntegrity();
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(0);
    expect(result.integrityErrors).toHaveLength(0);
  });

  test('returns valid for a correctly chained log', () => {
    const entry1 = buildAuditEntry({ timestamp: '2025-01-01T00:00:00.000Z' }, null);
    const entry2 = buildAuditEntry({ timestamp: '2025-01-02T00:00:00.000Z' }, entry1.hash);
    const entry3 = buildAuditEntry({ timestamp: '2025-01-03T00:00:00.000Z' }, entry2.hash);

    const logContent = [entry1, entry2, entry3].map((e) => JSON.stringify(e)).join('\n') + '\n';

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(logContent);

    const result = verifyIntegrity();
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(3);
    expect(result.integrityErrors).toHaveLength(0);
  });

  test('detects tampered entry (modified finding count)', () => {
    const entry1 = buildAuditEntry({ timestamp: '2025-01-01T00:00:00.000Z' }, null);
    // Tamper with the entry after hashing
    const tampered = { ...entry1, findingCount: 999 };

    const logContent = JSON.stringify(tampered) + '\n';

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(logContent);

    const result = verifyIntegrity();
    expect(result.valid).toBe(false);
    expect(result.integrityErrors.length).toBeGreaterThan(0);
    expect(result.integrityErrors[0].message).toBe('Hash mismatch');
  });

  test('detects broken chain linkage', () => {
    const entry1 = buildAuditEntry({ timestamp: '2025-01-01T00:00:00.000Z' }, null);
    // Entry2 with wrong previousHash
    const entry2 = buildAuditEntry({ timestamp: '2025-01-02T00:00:00.000Z' }, 'wrong-hash');

    const logContent = [entry1, entry2].map((e) => JSON.stringify(e)).join('\n') + '\n';

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(logContent);

    const result = verifyIntegrity();
    expect(result.valid).toBe(false);
    const chainError = result.integrityErrors.find(
      (e) => e.message === 'Chain linkage broken'
    );
    expect(chainError).toBeDefined();
  });

  test('detects first entry with non-null previousHash', () => {
    const entry = buildAuditEntry({ timestamp: '2025-01-01T00:00:00.000Z' }, 'should-be-null');

    const logContent = JSON.stringify(entry) + '\n';

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(logContent);

    const result = verifyIntegrity();
    expect(result.valid).toBe(false);
    const err = result.integrityErrors.find(
      (e) => e.message === 'First entry should have no previous hash'
    );
    expect(err).toBeDefined();
  });
});
