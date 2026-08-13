/**
 * Tests for the finding.secret shape: assignment-context rules must expose
 * only the secret value (capture group 1) so the fixer, verifier, and
 * reporters never operate on the surrounding `NAME = "..."` context.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { RULES } = require('../rules');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-secret-test-'));
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

let scanner;
let fixer;

beforeEach(() => {
  jest.resetModules();
  scanner = require('../scanner');
  fixer = require('../fixer');
});

// Example line + the exact secret value expected in finding.secret,
// for every rule that declares secretGroup.
const SECRET_GROUP_FIXTURES = {
  'aws-secret-access-key': {
    line: 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  },
  'aws-account-id': {
    line: 'aws_account_id = 123456789012',
    secret: '123456789012',
  },
  'password-assignment': {
    line: 'const password = "hunter2secretvalue";',
    secret: 'hunter2secretvalue',
  },
  'api-key-assignment': {
    line: 'api_key = "abcdef1234567890"',
    secret: 'abcdef1234567890',
  },
  'secret-assignment': {
    line: 'secret: "supersecretvalue99"',
    secret: 'supersecretvalue99',
  },
  'token-assignment': {
    line: "token = 'tok_abcdef123456'",
    secret: 'tok_abcdef123456',
  },
  'auth-header': {
    line: 'Authorization: Bearer abc123.def456.ghi789xyz',
    secret: 'abc123.def456.ghi789xyz',
  },
  'azure-storage-key': {
    line: 'AccountKey=' + 'A'.repeat(86) + '==',
    secret: 'A'.repeat(86) + '==',
  },
  'env-var-secret': {
    line: 'MY_APP_PASSWORD=supersecretvalue',
    secret: 'supersecretvalue',
  },
  'oauth-bearer': {
    line: 'bearer abcdefghijklmnopqrstuvwxyz',
    secret: 'abcdefghijklmnopqrstuvwxyz',
  },
  'heroku-token': {
    line: 'HEROKU_API_KEY=01234567-89ab-cdef-0123-456789abcdef',
    secret: '01234567-89ab-cdef-0123-456789abcdef',
  },
  'datadog-api-key': {
    line: 'dd_api_key = 0123456789abcdef0123456789abcdef',
    secret: '0123456789abcdef0123456789abcdef',
  },
  'slack-signing-secret': {
    line: 'signing_secret = abcdef0123456789ABCDEF0123456789',
    secret: 'abcdef0123456789ABCDEF0123456789',
  },
  'vercel-token': {
    line: 'VERCEL_TOKEN=aBcDeFgHiJkLmNoPqRsTuVwX',
    secret: 'aBcDeFgHiJkLmNoPqRsTuVwX',
  },
  'cloudflare-api-key': {
    line: 'CF_API_KEY=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    secret: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  },
  'cloudflare-api-token': {
    line: 'CLOUDFLARE_TOKEN=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789-_AB',
    secret: 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789-_AB',
  },
  'railway-token': {
    line: 'RAILWAY_TOKEN=railway_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
    secret: 'railway_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
  },
  'upstash-token': {
    line: 'UPSTASH_REDIS_REST_TOKEN=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr',
    secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr',
  },
  'neon-api-key': {
    line: 'NEON_API_KEY=neon_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstu',
    secret: 'neon_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstu',
  },
  'turso-token': {
    line: 'TURSO_AUTH_TOKEN=eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3MDAwMDAwMDB9.ABCDEFGHIJKLMNOPQRSTUVWXYZab',
    secret: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3MDAwMDAwMDB9.ABCDEFGHIJKLMNOPQRSTUVWXYZab',
  },
  'mistral-api-key': {
    line: 'MISTRAL_API_KEY=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01',
    secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01',
  },
  'cohere-api-key': {
    line: 'COHERE_API_KEY=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01',
    secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01',
  },
};

describe('secretGroup rules expose only the secret value', () => {
  test('every rule with secretGroup has a fixture in this test', () => {
    const withGroup = RULES.filter(r => r.secretGroup).map(r => r.id);
    expect(withGroup.length).toBeGreaterThanOrEqual(20);
    for (const id of withGroup) {
      expect(SECRET_GROUP_FIXTURES).toHaveProperty(id);
    }
  });

  for (const [ruleId, fixture] of Object.entries(SECRET_GROUP_FIXTURES)) {
    test(`${ruleId}: finding.secret is the bare value`, () => {
      const findings = scanner.scanForPatterns(fixture.line, 1, {});
      const finding = findings.find(f => f.ruleId === ruleId);
      expect(finding).toBeDefined();
      expect(finding.secret).toBe(fixture.secret);
      // No assignment context leaks into the secret
      expect(finding.secret).not.toMatch(/["'\s]/);
      // Display context is untouched: match still covers the full regex match
      expect(finding.match).toContain(fixture.secret);
      expect(finding.matchLength).toBe(finding.match.length);
    });
  }
});

describe('fixer uses finding.secret for rewriting', () => {
  test('password assignment fix rewrites only the value', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'const password = "hunter2secretvalue";\n');

      const scanResults = scanner.scanFiles([filePath], { configDir: dir });
      const fileResult = scanResults.filesScanned.find(f => f.file === filePath);
      expect(fileResult.findings.length).toBeGreaterThanOrEqual(1);

      // Dry-run first: the previewed rewrite must be the clean assignment
      const preview = fixer.dryRun(scanResults, { repoDir: dir });
      expect(preview.changes[0].after).toBe('const password = process.env.PASSWORD;');

      const result = fixer.fixAll(scanResults, { repoDir: dir });
      expect(result.fixed).toBeGreaterThanOrEqual(1);

      const content = fs.readFileSync(filePath, 'utf8');
      const rewrittenLine = content.split('\n').find(l => l.includes('password'));
      expect(rewrittenLine).toBe('const password = process.env.PASSWORD;');
      expect(content).not.toContain('hunter2secretvalue');

      // .env entry holds the bare value — no variable name, no quotes
      const envContent = fs.readFileSync(path.join(dir, '.env'), 'utf8');
      expect(envContent).toContain('PASSWORD=hunter2secretvalue\n');
      expect(envContent).not.toContain('password =');
    } finally {
      cleanDir(dir);
    }
  });

  test('entropy finding stores the full untruncated secret and fix succeeds', () => {
    const dir = createTempDir();
    try {
      // Deterministic high-entropy 120-char string (base64 alphabet)
      const longSecret = (
        crypto.createHash('sha512').update('gate-entropy-a').digest('base64') +
        crypto.createHash('sha512').update('gate-entropy-b').digest('base64')
      ).replace(/=/g, 'Q').slice(0, 120);
      expect(longSecret.length).toBe(120);

      const filePath = path.join(dir, 'entropy.js');
      fs.writeFileSync(filePath, `const key = "${longSecret}";\n`);

      const scanResults = scanner.scanFiles([filePath], { configDir: dir });
      const fileResult = scanResults.filesScanned.find(f => f.file === filePath);
      const finding = fileResult.findings.find(f => f.type === 'entropy');
      expect(finding).toBeDefined();
      expect(finding.secret.length).toBe(120);
      expect(finding.secret).toBe(longSecret);
      expect(finding.match).toBe(longSecret);

      const result = fixer.fixAll(scanResults, { repoDir: dir });
      expect(result.fixed).toBeGreaterThanOrEqual(1);

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toContain(longSecret);
      expect(content).toContain('process.env.KEY');

      const envContent = fs.readFileSync(path.join(dir, '.env'), 'utf8');
      expect(envContent).toContain(longSecret);
    } finally {
      cleanDir(dir);
    }
  });
});
