/**
 * Gate Vault — AES-256-GCM local secret encryption
 * No external dependencies — uses Node crypto only
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const GATE_DIR = path.join(os.homedir(), '.gate');
const KEY_PATH = path.join(GATE_DIR, 'vault.key');
const ALGORITHM = 'aes-256-gcm';

/**
 * Ensure ~/.gate directory exists
 */
function ensureGateDir() {
  if (!fs.existsSync(GATE_DIR)) {
    fs.mkdirSync(GATE_DIR, { recursive: true, mode: 0o700 });
  } else {
    try { fs.chmodSync(GATE_DIR, 0o700); } catch {}
  }
}

/**
 * Generate a new vault key and write to ~/.gate/vault.key
 * @param {boolean} force - Overwrite existing key
 * @returns {{ created: boolean, path: string }}
 */
function keygen(force = false) {
  ensureGateDir();

  if (fs.existsSync(KEY_PATH) && !force) {
    return { created: false, path: KEY_PATH };
  }

  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(KEY_PATH, key, { mode: 0o600 });
  return { created: true, path: KEY_PATH };
}

/**
 * Load vault key from ~/.gate/vault.key, auto-generating if absent
 * @returns {Buffer} 32-byte key
 */
function loadKey() {
  if (!fs.existsSync(KEY_PATH)) {
    keygen();
  }

  const hex = fs.readFileSync(KEY_PATH, 'utf8').trim();
  if (hex.length !== 64) {
    throw new Error(`Invalid vault key (expected 64 hex chars, got ${hex.length}). Regenerate with: gate vault keygen --force`);
  }

  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string
 * @param {string} plaintext
 * @returns {string} base64-encoded vault blob
 */
function encrypt(plaintext) {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ct = cipher.update(plaintext, 'utf8', 'hex');
  ct += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  const blob = JSON.stringify({ v: 1, algo: ALGORITHM, iv: iv.toString('hex'), ct, authTag });
  return Buffer.from(blob).toString('base64');
}

/**
 * Decrypt a vault blob
 * @param {string} blob - base64-encoded vault blob
 * @returns {string} plaintext
 */
function decrypt(blob) {
  const key = loadKey();
  let parsed;
  try {
    const json = Buffer.from(blob, 'base64').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid vault blob — not a valid base64-encoded vault object');
  }
  const { algo, iv, ct, authTag } = parsed;
  if (!iv || !ct || !authTag) {
    throw new Error('Invalid vault blob — missing required fields (iv, ct, authTag)');
  }

  // Always use ALGORITHM (aes-256-gcm) — ignore algo from blob to prevent downgrade
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let plaintext = decipher.update(ct, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

/**
 * Encrypt all values in a .env file, writing to <file>.encrypted
 * @param {string} filePath - path to .env file
 * @returns {{ outputPath: string, count: number }}
 */
function encryptEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const outputLines = [];
  let count = 0;

  for (const line of lines) {
    // Skip comments and blank lines
    if (!line.trim() || line.trim().startsWith('#')) {
      outputLines.push(line);
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      outputLines.push(line);
      continue;
    }

    const key = line.substring(0, eqIndex);
    const value = line.substring(eqIndex + 1);

    // Don't encrypt empty values
    if (!value.trim()) {
      outputLines.push(line);
      continue;
    }

    // Strip surrounding quotes if present
    let raw = value.trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }

    const encrypted = encrypt(raw);
    outputLines.push(`${key}=VAULT:${encrypted}`);
    count++;
  }

  const outputPath = filePath + '.encrypted';
  fs.writeFileSync(outputPath, outputLines.join('\n'), { mode: 0o600 });
  return { outputPath, count };
}

module.exports = {
  keygen,
  encrypt,
  decrypt,
  encryptEnvFile,
};
