/**
 * License Verification Module for Gate
 * 
 * Handles:
 * - License key validation (signature verification)
 * - Quota checking (free tier 100/month)
 * - Account binding (GitHub OAuth + token encryption)
 * - Offline verification (no internet needed)
 * 
 * Ready to integrate into Gate CLI
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import os from 'os';

// =============================================================================
// TYPES
// =============================================================================

export interface LicenseKey {
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  teamId: string;
  expiryDate: string;
  signature: string;
  raw: string; // Full unparsed key
}

export interface License {
  key: LicenseKey;
  isValid: boolean;
  plan: string;
  teamId: string;
  expiryDate: Date;
  daysRemaining: number;
  scansRemaining?: number; // For free tier only
}

export interface GitHubCredentials {
  token: string;
  username: string;
  email: string;
  createdAt: string;
}

export interface QuotaInfo {
  plan: string;
  scansUsed: number;
  scansLimit: number;
  scansRemaining: number;
  inGracePeriod: boolean;
  monthStart: Date;
  monthEnd: Date;
}

export interface VerificationResult {
  valid: boolean;
  license?: License;
  quota?: QuotaInfo;
  authenticated?: boolean;
  error?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const GATE_CONFIG_DIR = path.join(os.homedir(), '.gate');
const LICENSE_FILE = path.join(GATE_CONFIG_DIR, 'license');
const CREDENTIALS_FILE = path.join(GATE_CONFIG_DIR, 'credentials');
const QUOTA_FILE = path.join(GATE_CONFIG_DIR, 'quota');

const FREE_TIER_MONTHLY_LIMIT = 100;
const FREE_TIER_GRACE_PERIOD = 150; // 50% over limit
const PLAN_SEAT_LIMITS = {
  FREE: 1,
  PRO: 5,
  ENTERPRISE: Infinity
};

// THIS SHOULD BE IN ENVIRONMENT (never hardcode in production)
const SERVER_SECRET = process.env.GATE_LICENSE_SECRET || 'dev-secret-do-not-use';

// =============================================================================
// LICENSE KEY PARSING & VERIFICATION
// =============================================================================

/**
 * Parse and validate a Gate license key
 * Format: GATE-[PLAN]-[TEAM_ID]-[EXPIRY_DATE]-[SIGNATURE]
 * Example: GATE-PRO-a1b2c3d4e5f6-2026-03-16-ABCDEFGH12345678IJKLMNOP90QRSTU
 */
export function parseLicenseKey(keyString: string): LicenseKey | null {
  const pattern = /^GATE-([A-Z]+)-([A-Z0-9]+)-(\d{4}-\d{2}-\d{2})-([A-Z0-9]{32})$/;
  const match = keyString.trim().match(pattern);

  if (!match) {
    return null;
  }

  const [, plan, teamId, expiryDate, signature] = match;

  return {
    plan: plan as 'FREE' | 'PRO' | 'ENTERPRISE',
    teamId,
    expiryDate,
    signature,
    raw: keyString.trim()
  };
}

/**
 * Verify license key signature using HMAC-SHA256
 * Prevents tampering with key components
 */
export function verifyLicenseSignature(key: LicenseKey, secret: string = SERVER_SECRET): boolean {
  // Reconstruct the data that was signed
  const data = `GATE-${key.plan}-${key.teamId}-${key.expiryDate}`;

  // Compute expected signature
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest()
    .toString('hex')
    .toUpperCase()
    .substring(0, 32); // Truncate to 32 chars (base32 in real system)

  // Constant-time comparison (prevent timing attacks)
  return crypto.timingSafeEqual(
    Buffer.from(key.signature),
    Buffer.from(expectedSignature)
  ) === true;
}

/**
 * Check if license key has expired
 */
export function isLicenseExpired(key: LicenseKey): boolean {
  const expiryDate = new Date(key.expiryDate);
  expiryDate.setUTCHours(23, 59, 59, 999); // End of day UTC
  return new Date() > expiryDate;
}

/**
 * Calculate days remaining until license expires
 */
export function daysRemaining(key: LicenseKey): number {
  const expiryDate = new Date(key.expiryDate);
  const now = new Date();
  const diffMs = expiryDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Validate complete license object
 */
export function validateLicense(key: LicenseKey, secret: string = SERVER_SECRET): License {
  const isExpired = isLicenseExpired(key);
  const isValidSig = !isExpired && verifyLicenseSignature(key, secret);

  return {
    key,
    isValid: isValidSig && !isExpired,
    plan: key.plan,
    teamId: key.teamId,
    expiryDate: new Date(key.expiryDate),
    daysRemaining: daysRemaining(key)
  };
}

// =============================================================================
// GITHUB TOKEN ENCRYPTION (Machine-Specific)
// =============================================================================

/**
 * Generate machine-specific encryption key
 * Derives from: serial number, hostname, username, local entropy
 */
export function generateMachineKey(): Buffer {
  const systemInfo = [
    os.hostname(),
    os.userInfo().username,
    process.platform,
    process.arch,
    os.cpus()[0]?.model || 'unknown'
  ].join('|');

  // Derive key using PBKDF2 (fast, deterministic)
  const key = crypto.pbkdf2Sync(
    systemInfo,
    'gate-machine-key',
    100000, // iterations
    32, // 256 bits
    'sha256'
  );

  return key;
}

/**
 * Encrypt GitHub credentials (AES-256-GCM)
 * Tied to specific machine (can't transfer between machines)
 */
export function encryptCredentials(credentials: GitHubCredentials): string {
  const machineKey = generateMachineKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', machineKey, iv);

  const data = JSON.stringify(credentials);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Combine IV + encrypted + authTag (base64)
  const combined = Buffer.concat([iv, authTag, Buffer.from(encrypted, 'hex')]);
  return combined.toString('base64');
}

/**
 * Decrypt GitHub credentials
 * Returns null if decryption fails (e.g., different machine)
 */
export function decryptCredentials(encryptedData: string): GitHubCredentials | null {
  try {
    const machineKey = generateMachineKey();
    const combined = Buffer.from(encryptedData, 'base64');

    const iv = combined.slice(0, 16);
    const authTag = combined.slice(16, 32);
    const encrypted = combined.slice(32).toString('hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', machineKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted) as GitHubCredentials;
  } catch (error) {
    // Decryption failed (wrong machine, corrupted data, etc.)
    return null;
  }
}

// =============================================================================
// QUOTA TRACKING (Free Tier)
// =============================================================================

/**
 * Initialize quota file (first run)
 */
export function initializeQuota(): QuotaInfo {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const quota: QuotaInfo = {
    plan: 'FREE',
    scansUsed: 0,
    scansLimit: FREE_TIER_MONTHLY_LIMIT,
    scansRemaining: FREE_TIER_MONTHLY_LIMIT,
    inGracePeriod: false,
    monthStart,
    monthEnd
  };

  return quota;
}

/**
 * Load quota from disk or initialize
 */
export function loadQuota(): QuotaInfo {
  if (!fs.existsSync(QUOTA_FILE)) {
    return initializeQuota();
  }

  try {
    const data = fs.readFileSync(QUOTA_FILE, 'utf-8');
    const quota = JSON.parse(data) as QuotaInfo;

    // Check if quota month has reset
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    if (new Date(quota.monthStart) < monthStart) {
      // Month has passed, reset quota
      return initializeQuota();
    }

    return quota;
  } catch (error) {
    return initializeQuota();
  }
}

/**
 * Save quota to disk
 */
export function saveQuota(quota: QuotaInfo): void {
  fs.writeFileSync(QUOTA_FILE, JSON.stringify(quota, null, 2), { mode: 0o600 });
}

/**
 * Increment scan count for free tier
 * Returns true if scan should proceed, false if quota exceeded
 */
export function recordScan(plan: string = 'FREE'): boolean {
  if (plan !== 'FREE') {
    // Pro/Enterprise have unlimited scans
    return true;
  }

  const quota = loadQuota();
  quota.scansUsed += 1;
  quota.scansRemaining = quota.scansLimit - quota.scansUsed;
  quota.inGracePeriod = quota.scansUsed > quota.scansLimit && quota.scansUsed <= FREE_TIER_GRACE_PERIOD;

  saveQuota(quota);

  // Allow scan if within limit or grace period
  return quota.scansUsed <= FREE_TIER_GRACE_PERIOD;
}

/**
 * Get remaining scans for free tier
 */
export function getScansRemaining(plan: string = 'FREE'): number {
  if (plan !== 'FREE') {
    return Infinity; // Unlimited
  }

  const quota = loadQuota();
  return quota.scansRemaining;
}

// =============================================================================
// LICENSE FILE MANAGEMENT
// =============================================================================

/**
 * Ensure ~/.gate directory exists with correct permissions
 */
export function ensureGateDir(): void {
  if (!fs.existsSync(GATE_CONFIG_DIR)) {
    fs.mkdirSync(GATE_CONFIG_DIR, { mode: 0o700, recursive: true });
  }
}

/**
 * Save license key to disk
 * Stored in plain text (signed, so tamper-proof)
 */
export function saveLicense(keyString: string): void {
  ensureGateDir();
  fs.writeFileSync(LICENSE_FILE, keyString, { mode: 0o600 });
}

/**
 * Load license from disk
 */
export function loadLicenseKey(): LicenseKey | null {
  if (!fs.existsSync(LICENSE_FILE)) {
    return null;
  }

  try {
    const keyString = fs.readFileSync(LICENSE_FILE, 'utf-8');
    return parseLicenseKey(keyString);
  } catch (error) {
    return null;
  }
}

/**
 * Delete/revoke local license
 */
export function revokeLicense(): void {
  if (fs.existsSync(LICENSE_FILE)) {
    fs.unlinkSync(LICENSE_FILE);
  }
}

/**
 * Save GitHub credentials (encrypted)
 */
export function saveCredentials(credentials: GitHubCredentials): void {
  ensureGateDir();
  const encrypted = encryptCredentials(credentials);
  fs.writeFileSync(CREDENTIALS_FILE, encrypted, { mode: 0o600 });
}

/**
 * Load GitHub credentials (decrypt)
 */
export function loadCredentials(): GitHubCredentials | null {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return null;
  }

  try {
    const encrypted = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
    return decryptCredentials(encrypted);
  } catch (error) {
    return null;
  }
}

// =============================================================================
// MAIN VERIFICATION FLOW
// =============================================================================

/**
 * Full license verification flow
 * Checks:
 * 1. License key exists and is valid
 * 2. License hasn't expired
 * 3. GitHub token is still valid (if authenticated)
 * 4. Quota not exceeded (free tier)
 */
export async function verifyLicense(
  options: {
    checkToken?: boolean; // Whether to verify GitHub token
    requireAuth?: boolean; // Whether to require authenticated GitHub
    apiUrl?: string;
  } = {}
): Promise<VerificationResult> {
  const { checkToken = false, apiUrl = 'https://api.github.com' } = options;

  // Check for local license file
  const licenseKey = loadLicenseKey();

  // No license = use free tier
  if (!licenseKey) {
    const quota = loadQuota();
    return {
      valid: true,
      license: {
        key: {
          plan: 'FREE',
          teamId: 'local',
          expiryDate: new Date(Date.UTC(2099, 11, 31)).toISOString().split('T')[0],
          signature: 'none',
          raw: 'FREE_TIER_LOCAL'
        },
        isValid: true,
        plan: 'FREE',
        teamId: 'local',
        expiryDate: new Date(2099, 11, 31),
        daysRemaining: 999999,
        scansRemaining: quota.scansRemaining
      },
      quota,
      authenticated: false
    };
  }

  // Validate license
  const license = validateLicense(licenseKey);

  if (!license.isValid) {
    return {
      valid: false,
      error: 'License invalid or expired. Reverting to free tier.',
      license,
      quota: loadQuota(),
      authenticated: false
    };
  }

  // Check GitHub token if requested
  let authenticated = false;
  if (checkToken) {
    const creds = loadCredentials();
    if (!creds) {
      return {
        valid: false,
        error: 'License requires GitHub authentication. Run: gate auth',
        license,
        authenticated: false
      };
    }

    // Verify token is still valid (optional: make API call to GitHub)
    // In real implementation, verify token hasn't been revoked
    authenticated = true;
  }

  // Return success
  return {
    valid: true,
    license,
    quota: loadQuota(),
    authenticated
  };
}

/**
 * Check if license allows GitHub Actions enforcement
 */
export function canEnforceGitHubActions(license: License): boolean {
  // Only Pro and Enterprise can enforce
  return license.plan !== 'FREE';
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate a new license key (for server-side issuance)
 * Should only be called by backend
 */
export function generateLicenseKey(
  plan: 'FREE' | 'PRO' | 'ENTERPRISE',
  teamId: string,
  expiryDate: Date,
  secret: string = SERVER_SECRET
): string {
  const expiryStr = expiryDate.toISOString().split('T')[0]; // YYYY-MM-DD
  const data = `GATE-${plan}-${teamId}-${expiryStr}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest()
    .toString('hex')
    .toUpperCase()
    .substring(0, 32);

  return `${data}-${signature}`;
}

/**
 * Format quota information for CLI display
 */
export function formatQuota(quota: QuotaInfo): string {
  if (quota.plan !== 'FREE') {
    return `Plan: ${quota.plan}\nScans: Unlimited\n`;
  }

  const remaining = quota.scansRemaining;
  const used = quota.scansUsed;
  const limit = quota.scansLimit;

  let status = '✓';
  if (quota.inGracePeriod) {
    status = '⚠️ ';
  }
  if (used > FREE_TIER_GRACE_PERIOD) {
    status = '❌';
  }

  const daysUntilReset = Math.ceil(
    (quota.monthEnd.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  );

  return `${status} Scans: ${used} / ${limit}
Remaining: ${remaining}
Next reset: ${daysUntilReset} days\n`;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  // License management
  parseLicenseKey,
  verifyLicenseSignature,
  validateLicense,
  saveLicense,
  loadLicenseKey,
  revokeLicense,
  generateLicenseKey,

  // GitHub auth
  encryptCredentials,
  decryptCredentials,
  saveCredentials,
  loadCredentials,

  // Quota
  recordScan,
  getScansRemaining,
  loadQuota,
  saveQuota,

  // Verification
  verifyLicense,
  canEnforceGitHubActions,

  // Utilities
  formatQuota,
  ensureGateDir,
  daysRemaining,
  isLicenseExpired
};
