/**
 * Tests for src/cli/status.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock dependencies before requiring status
jest.mock('../installer');
jest.mock('../rules');
jest.mock('../audit');

const { isInstalled } = require('../installer');
const { getRules } = require('../rules');
const { readAuditLog, getStatistics } = require('../audit');

// We require status after mocks are in place
let getStatus, formatStatus;
beforeAll(() => {
  ({ getStatus, formatStatus } = require('../status'));
});

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-status-test-'));
}

// ---------------------------------------------------------------------------
// getStatus tests
// ---------------------------------------------------------------------------

describe('getStatus', () => {
  let dir;

  beforeEach(() => {
    dir = createTempDir();
    jest.clearAllMocks();

    // Sensible defaults for all mocks
    isInstalled.mockReturnValue(false);
    getRules.mockReturnValue([{ id: 'rule-1' }, { id: 'rule-2' }]);
    readAuditLog.mockReturnValue([]);
    getStatistics.mockReturnValue({
      totalScans: 0,
      totalFindingsLogged: 0,
      averageBypassRate: 0,
      severityTotals: { critical: 0, high: 0, medium: 0, low: 0 },
      decisionCounts: { bypass: 0, fix: 0, skip: 0, cancel: 0, none: 0 },
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true });
  });

  // 1. Hook status — installed vs not installed
  test('reports pre-commit hook as installed when isInstalled returns true', async () => {
    isInstalled.mockReturnValue(true);
    const status = await getStatus(dir);
    expect(status.hookPreCommit).toBe(true);
  });

  test('reports pre-commit hook as not installed when isInstalled returns false', async () => {
    isInstalled.mockReturnValue(false);
    const status = await getStatus(dir);
    expect(status.hookPreCommit).toBe(false);
  });

  test('reports pre-push hook as installed when .git/hooks/pre-push contains gate', async () => {
    const hooksDir = path.join(dir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), '#!/bin/sh\ngate scan --staged\n');
    const status = await getStatus(dir);
    expect(status.hookPrePush).toBe(true);
  });

  test('reports pre-push hook as not installed when file is absent', async () => {
    // No .git/hooks/pre-push created
    const status = await getStatus(dir);
    expect(status.hookPrePush).toBe(false);
  });

  test('reports pre-push hook as not installed when file does not contain gate', async () => {
    const hooksDir = path.join(dir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), '#!/bin/sh\necho "not gate"\n');
    const status = await getStatus(dir);
    expect(status.hookPrePush).toBe(false);
  });

  // 2. Config source
  test('reports configSource as "defaults" when no .gaterc present', async () => {
    const status = await getStatus(dir);
    expect(status.configSource).toBe('defaults');
  });

  test('reports configSource as ".gaterc" when .gaterc is present', async () => {
    fs.writeFileSync(path.join(dir, '.gaterc'), 'entropy_threshold: 3.5\n');
    const status = await getStatus(dir);
    expect(status.configSource).toBe('.gaterc');
  });

  // 3. Ignore pattern count
  test('reports ignoreCount as 0 when no .gateignore present', async () => {
    const status = await getStatus(dir);
    expect(status.ignoreCount).toBe(0);
  });

  test('reports ignoreCount matching number of active patterns in .gateignore', async () => {
    fs.writeFileSync(
      path.join(dir, '.gateignore'),
      '# comment line\n\nnode_modules/**\ndist/**\n*.min.js\n'
    );
    const status = await getStatus(dir);
    expect(status.ignoreCount).toBe(3);
  });

  test('ignoreCount excludes blank lines and comments', async () => {
    fs.writeFileSync(
      path.join(dir, '.gateignore'),
      '# header\n\n   \nfoo/**\n'
    );
    const status = await getStatus(dir);
    expect(status.ignoreCount).toBe(1);
  });

  // 4. Rule count
  test('reports ruleCount from getRules()', async () => {
    getRules.mockReturnValue(new Array(42).fill({ id: 'x' }));
    const status = await getStatus(dir);
    expect(status.ruleCount).toBe(42);
  });

  test('reports ruleCount as 0 when getRules returns empty array', async () => {
    getRules.mockReturnValue([]);
    const status = await getStatus(dir);
    expect(status.ruleCount).toBe(0);
  });

  // 5. Last scan from audit log
  test('reports lastScan as the most recent audit entry', async () => {
    const entries = [
      { timestamp: '2026-01-01T00:00:00.000Z', filesScanned: ['a.js'], findingCount: 1 },
      { timestamp: '2026-03-15T12:00:00.000Z', filesScanned: ['b.js', 'c.js'], findingCount: 0 },
    ];
    readAuditLog.mockReturnValue(entries);
    const status = await getStatus(dir);
    expect(status.lastScan).toEqual(entries[1]);
  });

  // 6. Missing/empty audit log
  test('reports lastScan as null when audit log is empty', async () => {
    readAuditLog.mockReturnValue([]);
    const status = await getStatus(dir);
    expect(status.lastScan).toBeNull();
  });

  test('handles readAuditLog returning null gracefully', async () => {
    readAuditLog.mockReturnValue(null);
    const status = await getStatus(dir);
    expect(status.lastScan).toBeNull();
  });

  // 7. Version from package.json
  test('reports version string from package.json', async () => {
    const status = await getStatus(dir);
    expect(typeof status.version).toBe('string');
    expect(status.version.length).toBeGreaterThan(0);
  });

  test('version matches the package.json version field', async () => {
    const pkg = require('../../../package.json');
    const status = await getStatus(dir);
    expect(status.version).toBe(pkg.version);
  });

  // auditStats
  test('reports auditStats from getStatistics()', async () => {
    const mockStats = {
      totalScans: 47,
      totalFindingsLogged: 12,
      averageBypassRate: '6.38%',
      severityTotals: { critical: 3, high: 5, medium: 4, low: 0 },
      decisionCounts: { bypass: 3, fix: 40, skip: 2, cancel: 1, none: 1 },
    };
    getStatistics.mockReturnValue(mockStats);
    const status = await getStatus(dir);
    expect(status.auditStats).toEqual(mockStats);
  });
});

// ---------------------------------------------------------------------------
// formatStatus tests
// ---------------------------------------------------------------------------

describe('formatStatus', () => {
  const baseStatus = {
    version: '2.0.0-alpha.1',
    hookPreCommit: true,
    hookPrePush: false,
    configSource: 'defaults',
    ignoreCount: 12,
    ruleCount: 256,
    lastScan: {
      timestamp: new Date(Date.now() - 3 * 60 * 1000).toISOString(), // 3 min ago
      filesScanned: ['a.js', 'b.js', 'c.js'],
      findingCount: 0,
    },
    auditStats: {
      totalScans: 47,
      totalFindingsLogged: 3,
      decisionCounts: { bypass: 0, fix: 3, skip: 0, cancel: 0, none: 44 },
    },
  };

  test('output includes version', () => {
    const out = formatStatus(baseStatus, false);
    expect(out).toContain('2.0.0-alpha.1');
  });

  test('output shows pre-commit installed', () => {
    const out = formatStatus(baseStatus, false);
    expect(out).toContain('pre-commit');
  });

  test('output shows pre-push not installed', () => {
    const out = formatStatus(baseStatus, false);
    expect(out).toContain('pre-push');
  });

  test('output includes config source', () => {
    const out = formatStatus(baseStatus, false);
    expect(out).toContain('defaults');
  });

  test('output includes config source .gaterc', () => {
    const out = formatStatus({ ...baseStatus, configSource: '.gaterc' }, false);
    expect(out).toContain('.gaterc');
  });

  test('output includes ignore pattern count', () => {
    const out = formatStatus(baseStatus, false);
    expect(out).toContain('12');
  });

  test('output includes rule count', () => {
    const out = formatStatus(baseStatus, false);
    expect(out).toContain('256');
  });

  test('output includes total scan count', () => {
    const out = formatStatus(baseStatus, false);
    expect(out).toContain('47');
  });

  test('output includes last scan file count', () => {
    const out = formatStatus(baseStatus, false);
    // 3 files scanned
    expect(out).toContain('3');
  });

  test('output includes "no findings" or finding count for last scan', () => {
    const out = formatStatus(baseStatus, false);
    expect(out).toMatch(/0 finding|no finding/i);
  });

  test('handles null lastScan gracefully — shows "never"', () => {
    const out = formatStatus({ ...baseStatus, lastScan: null }, false);
    expect(out).toMatch(/never/i);
  });

  test('returns a non-empty string', () => {
    const out = formatStatus(baseStatus, false);
    expect(typeof out).toBe('string');
    expect(out.trim().length).toBeGreaterThan(0);
  });

  test('useColor=false output contains no ANSI escape codes', () => {
    const out = formatStatus(baseStatus, false);
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\x1b\[/);
  });

  test('useColor=true output contains ANSI escape codes', () => {
    const out = formatStatus(baseStatus, true);
    // eslint-disable-next-line no-control-regex
    expect(out).toMatch(/\x1b\[/);
  });
});
