const fs = require('fs');
const path = require('path');
const os = require('os');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-fixer-test-'));
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

let fixer;

beforeEach(() => {
  jest.resetModules();
  fixer = require('../fixer');
});

// Helper: create a fake finding object matching scanner output shape
function makeFinding(ruleId, match, lineNumber = 1) {
  return {
    ruleId,
    ruleName: ruleId,
    severity: 'high',
    type: 'pattern',
    lineNumber,
    match,
    matchStart: 0,
    matchLength: match.length,
  };
}

// Helper: build scanResults like scanner.scanFiles returns
function makeScanResults(filesScanned) {
  return {
    timestamp: new Date().toISOString(),
    filesScanned,
    totalFindings: filesScanned.reduce((n, f) => n + f.findings.length, 0),
    severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
  };
}

// ─── 1. JS: const x = "secret" → process.env.X ─────────────────────────────
describe('language-aware code rewriting', () => {
  test('1. JS: const x = "secret" → process.env.X', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'const apiKey = "sk_live_abc123def456";\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      const result = fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('process.env.STRIPE_SECRET_KEY');
      expect(content).not.toContain('sk_live_abc123def456');
      expect(result.fixed).toBe(1);
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 2. JS: { key: "secret" } → { key: process.env.X } ────────────────────
  test('2. JS: object property value', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'module.exports = { apiKey: "sk_live_abc123def456" };\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('{ apiKey: process.env.STRIPE_SECRET_KEY }');
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 3. JS: single quotes ──────────────────────────────────────────────────
  test('3. JS: let x = \'secret\' (single quotes)', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, "let apiKey = 'sk_live_abc123def456';\n");
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('process.env.STRIPE_SECRET_KEY');
      expect(content).not.toContain("'sk_live_abc123def456'");
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 4. Python: x = "secret" → os.environ["X"] + adds import os ───────────
  test('4. Python: x = "secret" → os.environ["X"] + adds import os', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.py');
      fs.writeFileSync(filePath, 'api_key = "sk_live_abc123def456"\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('os.environ["STRIPE_SECRET_KEY"]');
      expect(content).toContain('import os');
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 5. Python: import os already present → no duplicate ───────────────────
  test('5. Python: import os already present → no duplicate', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.py');
      fs.writeFileSync(filePath, 'import os\nimport sys\napi_key = "sk_live_abc123def456"\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456', 3);
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('os.environ["STRIPE_SECRET_KEY"]');
      // Should only have one import os
      const matches = content.match(/import os/g);
      expect(matches).toHaveLength(1);
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 6. Go: x := "secret" → os.Getenv("X") ───────────────────────────────
  test('6. Go: x := "secret" → os.Getenv("X")', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'main.go');
      fs.writeFileSync(filePath, 'package main\n\nimport "fmt"\n\nfunc main() {\n\tapiKey := "sk_live_abc123def456"\n\tfmt.Println(apiKey)\n}\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456', 6);
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('os.Getenv("STRIPE_SECRET_KEY")');
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 7. Ruby: x = "secret" → ENV["X"] ─────────────────────────────────────
  test('7. Ruby: x = "secret" → ENV["X"]', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.rb');
      fs.writeFileSync(filePath, 'api_key = "sk_live_abc123def456"\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('ENV["STRIPE_SECRET_KEY"]');
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 8. Java: String x = "secret" → System.getenv("X") ───────────────────
  test('8. Java: String x = "secret" → System.getenv("X")', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'Config.java');
      fs.writeFileSync(filePath, 'public class Config {\n  String apiKey = "sk_live_abc123def456";\n}\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456', 2);
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('System.getenv("STRIPE_SECRET_KEY")');
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 9. YAML: key: "secret" → key: "${X}" ────────────────────────────────
  test('9. YAML: key: "secret" → key: "${X}"', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.yml');
      fs.writeFileSync(filePath, 'database:\n  password: "sk_live_abc123def456"\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456', 2);
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('"${STRIPE_SECRET_KEY}"');
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 10. Terraform: secret = "value" → secret = var.name ─────────────────
  test('10. Terraform: secret = "value" → secret = var.name', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'main.tf');
      fs.writeFileSync(filePath, 'resource "aws_instance" "web" {\n  secret_key = "sk_live_abc123def456"\n}\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456', 2);
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('var.stripe_secret_key');
      expect(content).not.toContain('sk_live_abc123def456');
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 11. JSON: extract to .env, return manual migration note ──────────────
  test('11. JSON: extracts to .env, returns manual migration note', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.json');
      fs.writeFileSync(filePath, '{\n  "apiKey": "sk_live_abc123def456"\n}\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456', 2);
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      const result = fixer.fixAll(scanResults, { repoDir: dir });

      // Secret should be in .env
      const envContent = fs.readFileSync(path.join(dir, '.env'), 'utf8');
      expect(envContent).toContain('STRIPE_SECRET_KEY=sk_live_abc123def456');
      // JSON file should NOT be modified (can't inline env vars)
      const jsonContent = fs.readFileSync(filePath, 'utf8');
      expect(jsonContent).toContain('sk_live_abc123def456');
      // Should have a manual migration note
      expect(result.notes.some(n => n.includes('JSON') || n.includes('manual'))).toBe(true);
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 12. Dockerfile: ENV X=val → ARG X ───────────────────────────────────
  test('12. Dockerfile: ENV X=val → ARG X', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'Dockerfile');
      fs.writeFileSync(filePath, 'FROM node:18\nENV API_KEY=sk_live_abc123def456\nRUN echo hi\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456', 2);
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('ARG API_KEY');
      expect(content).not.toContain('sk_live_abc123def456');
    } finally {
      cleanDir(dir);
    }
  });
});

// ─── .env file handling ─────────────────────────────────────────────────────
describe('.env file handling', () => {
  // ─── 13. Creates .env when missing ────────────────────────────────────────
  test('13. Creates .env when missing', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'const key = "sk_live_abc123def456";\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      expect(fs.existsSync(path.join(dir, '.env'))).toBe(true);
      const envContent = fs.readFileSync(path.join(dir, '.env'), 'utf8');
      expect(envContent).toContain('STRIPE_SECRET_KEY=sk_live_abc123def456');
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 14. Appends to existing .env ─────────────────────────────────────────
  test('14. Appends to existing .env', () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, '.env'), 'EXISTING_VAR=hello\n');
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'const key = "sk_live_abc123def456";\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const envContent = fs.readFileSync(path.join(dir, '.env'), 'utf8');
      expect(envContent).toContain('EXISTING_VAR=hello');
      expect(envContent).toContain('STRIPE_SECRET_KEY=sk_live_abc123def456');
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 15. .env conflict (same value) → no-op ──────────────────────────────
  test('15. .env conflict (same value) → no-op', () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, '.env'), 'STRIPE_SECRET_KEY=sk_live_abc123def456\n');
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'const key = "sk_live_abc123def456";\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const envContent = fs.readFileSync(path.join(dir, '.env'), 'utf8');
      // Should still have only one entry
      const matches = envContent.match(/STRIPE_SECRET_KEY=/g);
      expect(matches).toHaveLength(1);
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 16. .env conflict (different value) → suffix _NEW ───────────────────
  test('16. .env conflict (different value) → suffix _NEW, warning', () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, '.env'), 'STRIPE_SECRET_KEY=sk_live_old_value\n');
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'const key = "sk_live_abc123def456";\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      const result = fixer.fixAll(scanResults, { repoDir: dir });

      const envContent = fs.readFileSync(path.join(dir, '.env'), 'utf8');
      expect(envContent).toContain('STRIPE_SECRET_KEY_NEW=sk_live_abc123def456');
      // Should have a warning about the conflict
      expect(result.warnings.some(w => w.includes('already exists') || w.includes('conflict'))).toBe(true);
    } finally {
      cleanDir(dir);
    }
  });
});

// ─── .gitignore handling ────────────────────────────────────────────────────
describe('.gitignore handling', () => {
  // ─── 17. Adds .env to .gitignore ──────────────────────────────────────────
  test('17. Adds .env to .gitignore', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'const key = "sk_live_abc123def456";\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(true);
      const gitignoreContent = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
      expect(gitignoreContent).toContain('.env');
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 18. .gitignore already has .env → no duplicate ──────────────────────
  test('18. .gitignore already has .env → no duplicate', () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.env\n');
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'const key = "sk_live_abc123def456";\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const gitignoreContent = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
      const matches = gitignoreContent.match(/^\.env$/gm);
      expect(matches).toHaveLength(1);
    } finally {
      cleanDir(dir);
    }
  });
});

// ─── Dotenv injection ───────────────────────────────────────────────────────
describe('dotenv injection', () => {
  // ─── 19. CJS adds require('dotenv').config() ─────────────────────────────
  test('19. Dotenv injection: CJS adds require(\'dotenv\').config()', () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test', dependencies: { dotenv: '^16.0.0' } }));
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'const key = "sk_live_abc123def456";\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain("require('dotenv').config()");
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 20. ESM adds import 'dotenv/config' ─────────────────────────────────
  test('20. Dotenv injection: ESM adds import \'dotenv/config\'', () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test', type: 'module', dependencies: { dotenv: '^16.0.0' } }));
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'const key = "sk_live_abc123def456";\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain("import 'dotenv/config'");
    } finally {
      cleanDir(dir);
    }
  });

  // ─── 21. Dotenv already present → no duplicate ───────────────────────────
  test('21. Dotenv already present → no duplicate', () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test', dependencies: { dotenv: '^16.0.0' } }));
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, "require('dotenv').config();\nconst key = \"sk_live_abc123def456\";\n");
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456', 2);
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      const content = fs.readFileSync(filePath, 'utf8');
      const matches = content.match(/require\('dotenv'\)/g);
      expect(matches).toHaveLength(1);
    } finally {
      cleanDir(dir);
    }
  });
});

// ─── deriveEnvVarName ───────────────────────────────────────────────────────
describe('deriveEnvVarName', () => {
  // ─── 22. Known rule → mapped name ─────────────────────────────────────────
  test('22. known rule → mapped name', () => {
    expect(fixer.deriveEnvVarName('stripe-live-secret', 'const x = "val"')).toBe('STRIPE_SECRET_KEY');
    expect(fixer.deriveEnvVarName('aws-access-key-id', 'const x = "val"')).toBe('AWS_ACCESS_KEY_ID');
    expect(fixer.deriveEnvVarName('openai-api-key', 'const x = "val"')).toBe('OPENAI_API_KEY');
  });

  // ─── 23. Code context → extracted name ───────────────────────────────────
  test('23. code context → extracted name', () => {
    expect(fixer.deriveEnvVarName('unknown-rule', 'const dbPassword = "secret"')).toBe('DB_PASSWORD');
    expect(fixer.deriveEnvVarName('unknown-rule', 'let apiKey = "secret"')).toBe('API_KEY');
  });

  // ─── 24. Fallback → rule ID to SCREAMING_SNAKE ───────────────────────────
  test('24. fallback → rule ID to SCREAMING_SNAKE', () => {
    expect(fixer.deriveEnvVarName('my-custom-secret', 'x = "val"')).toBe('MY_CUSTOM_SECRET');
  });
});

// ─── dry-run ────────────────────────────────────────────────────────────────
describe('dry-run', () => {
  // ─── 25. No files modified, output matches fix ────────────────────────────
  test('25. dry-run: no files modified, output matches fix', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.js');
      const originalContent = 'const key = "sk_live_abc123def456";\n';
      fs.writeFileSync(filePath, originalContent);
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      const result = fixer.dryRun(scanResults, { repoDir: dir });

      // File should NOT be modified
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toBe(originalContent);
      // .env should NOT exist
      expect(fs.existsSync(path.join(dir, '.env'))).toBe(false);
      // But result should describe what would happen
      expect(result.fixed).toBe(1);
      expect(result.changes.length).toBeGreaterThan(0);
    } finally {
      cleanDir(dir);
    }
  });
});

// ─── undo ───────────────────────────────────────────────────────────────────
describe('undo', () => {
  // ─── 26. Restores modified files ──────────────────────────────────────────
  test('26. undo: restores modified files', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.js');
      const originalContent = 'const key = "sk_live_abc123def456";\n';
      fs.writeFileSync(filePath, originalContent);
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });

      // Verify it was changed
      expect(fs.readFileSync(filePath, 'utf8')).not.toBe(originalContent);

      // Undo
      const undoResult = fixer.undo(dir);
      expect(undoResult.restored).toBeGreaterThan(0);

      // File should be back to original
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toBe(originalContent);
    } finally {
      cleanDir(dir);
      // Clean up snapshots
      const snapshotDir = fixer._getSnapshotDir(dir);
      if (fs.existsSync(snapshotDir)) {
        fs.rmSync(snapshotDir, { recursive: true, force: true });
      }
    }
  });

  // ─── 27. Deletes gate-created files ───────────────────────────────────────
  test('27. undo: deletes gate-created files', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'const key = "sk_live_abc123def456";\n');
      // No .env exists yet — gate will create it
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      fixer.fixAll(scanResults, { repoDir: dir });
      expect(fs.existsSync(path.join(dir, '.env'))).toBe(true);

      // Undo — .env should be deleted since it was created by gate
      fixer.undo(dir);
      expect(fs.existsSync(path.join(dir, '.env'))).toBe(false);
    } finally {
      cleanDir(dir);
      const snapshotDir = fixer._getSnapshotDir(dir);
      if (fs.existsSync(snapshotDir)) {
        fs.rmSync(snapshotDir, { recursive: true, force: true });
      }
    }
  });

  // ─── 28. Undo with no snapshots → helpful error ──────────────────────────
  test('28. undo with no snapshots → helpful error', () => {
    const dir = createTempDir();
    try {
      const result = fixer.undo(dir);
      expect(result.error).toBeTruthy();
      expect(result.error).toMatch(/no.*snapshot|nothing.*undo/i);
    } finally {
      cleanDir(dir);
    }
  });
});

// ─── Snapshot rotation ──────────────────────────────────────────────────────
describe('snapshot management', () => {
  // ─── 29. 11th fix prunes oldest ──────────────────────────────────────────
  test('29. Snapshot rotation: 11th fix prunes oldest', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.js');

      // Create 11 snapshots by running fixAll 11 times
      for (let i = 0; i < 11; i++) {
        const secret = `sk_live_secret_value_${String(i).padStart(3, '0')}`;
        fs.writeFileSync(filePath, `const key = "${secret}";\n`);
        const finding = makeFinding('stripe-live-secret', secret);
        const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);
        fixer.fixAll(scanResults, { repoDir: dir });
      }

      // Check snapshot count — should be at most 10
      const snapshotDir = fixer._getSnapshotDir(dir);
      const snapshots = fs.readdirSync(snapshotDir).filter(f => {
        return fs.statSync(path.join(snapshotDir, f)).isDirectory();
      });
      expect(snapshots.length).toBeLessThanOrEqual(10);
    } finally {
      cleanDir(dir);
      const snapshotDir = fixer._getSnapshotDir(dir);
      if (fs.existsSync(snapshotDir)) {
        fs.rmSync(snapshotDir, { recursive: true, force: true });
      }
    }
  });
});

// ─── Verification after fix ─────────────────────────────────────────────────
describe('verification', () => {
  // ─── 30. Re-scan passes ──────────────────────────────────────────────────
  test('30. Verification after fix: re-scan passes', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'config.js');
      fs.writeFileSync(filePath, 'const key = "sk_live_abc123def456";\n');
      const finding = makeFinding('stripe-live-secret', 'sk_live_abc123def456');
      const scanResults = makeScanResults([{ file: filePath, findings: [finding] }]);

      const result = fixer.fixAll(scanResults, { repoDir: dir });

      // The fixed file should not contain the secret anymore
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toContain('sk_live_abc123def456');
      // Result should indicate verification passed
      expect(result.verified).toBe(true);
    } finally {
      cleanDir(dir);
      const snapshotDir = fixer._getSnapshotDir(dir);
      if (fs.existsSync(snapshotDir)) {
        fs.rmSync(snapshotDir, { recursive: true, force: true });
      }
    }
  });
});

// ─── detectLanguage ─────────────────────────────────────────────────────────
describe('detectLanguage', () => {
  test('detects all supported languages', () => {
    expect(fixer.detectLanguage('app.js')).toBe('javascript');
    expect(fixer.detectLanguage('app.ts')).toBe('javascript');
    expect(fixer.detectLanguage('app.jsx')).toBe('javascript');
    expect(fixer.detectLanguage('app.tsx')).toBe('javascript');
    expect(fixer.detectLanguage('app.mjs')).toBe('javascript');
    expect(fixer.detectLanguage('app.cjs')).toBe('javascript');
    expect(fixer.detectLanguage('app.py')).toBe('python');
    expect(fixer.detectLanguage('main.go')).toBe('go');
    expect(fixer.detectLanguage('app.rb')).toBe('ruby');
    expect(fixer.detectLanguage('App.java')).toBe('java');
    expect(fixer.detectLanguage('config.yml')).toBe('yaml');
    expect(fixer.detectLanguage('config.yaml')).toBe('yaml');
    expect(fixer.detectLanguage('main.tf')).toBe('terraform');
    expect(fixer.detectLanguage('config.json')).toBe('json');
    expect(fixer.detectLanguage('Dockerfile')).toBe('dockerfile');
    expect(fixer.detectLanguage('unknown.xyz')).toBe('unknown');
  });
});
