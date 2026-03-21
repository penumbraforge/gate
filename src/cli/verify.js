/**
 * Gate Credential Verification Engine
 *
 * Makes read-only API calls to provider endpoints to check if a
 * detected credential is actually live. Never sends credentials
 * to third parties — only to the provider's own API.
 *
 * Uses Node built-in https/http modules (no axios dependency).
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Constants ────────────────────────────────────────────────────────────────

/** Per-provider timeout in milliseconds */
const PER_PROVIDER_TIMEOUT = 2000;

/** Total time budget for all verifications in milliseconds */
const TOTAL_BUDGET = 5000;

/** Cache time-to-live: 1 hour */
const CACHE_TTL = 60 * 60 * 1000;

/** Path to verification cache */
const GATE_DIR = path.join(os.homedir(), '.gate');
const CACHE_PATH = path.join(GATE_DIR, 'verify-cache.json');

// ── HTTP Helper ──────────────────────────────────────────────────────────────

/**
 * Make an HTTP/HTTPS request using Node built-in modules.
 *
 * @param {string} url - Full URL to request
 * @param {object} options - Request options (method, headers, body)
 * @returns {Promise<{statusCode: number, body: string, headers: object}>}
 */
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (url.startsWith('https') ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: true,
    };

    const req = mod.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: data,
          headers: res.headers,
        });
      });
    });

    req.on('error', reject);
    req.end(options.body || undefined);
  });
}

/**
 * Race a promise against a timeout.
 *
 * @param {Promise} promise - The promise to race
 * @param {number} ms - Timeout in milliseconds
 * @returns {Promise} Resolves with the promise result, or rejects on timeout
 */
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.then(r => { clearTimeout(timer); return r; }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })
  ]);
}

// ── Cache ────────────────────────────────────────────────────────────────────

/**
 * Hash a credential value for use as a cache key.
 * Never stores raw credentials on disk.
 *
 * @param {string} credential - Raw credential string
 * @returns {string} SHA-256 hex hash
 */
function hashCredential(credential) {
  return crypto.createHash('sha256').update(credential).digest('hex');
}

/**
 * Load the verification cache from disk.
 *
 * @returns {object} Cache object (cacheKey → { result, timestamp })
 */
function loadCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const data = fs.readFileSync(CACHE_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch {
    // Corrupted cache — start fresh
  }
  return {};
}

/**
 * Save the verification cache to disk.
 *
 * @param {object} cache - Cache object to write
 */
function saveCache(cache) {
  try {
    if (!fs.existsSync(GATE_DIR)) {
      fs.mkdirSync(GATE_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), { mode: 0o600 });
  } catch {
    // Non-fatal: cache write failure should not block scanning
  }
}

// ── Provider Verifiers ───────────────────────────────────────────────────────

/**
 * Verify a GitHub token (PAT, OAuth, or App token).
 * GET https://api.github.com/user with Bearer auth.
 *
 * @param {string} token - The GitHub token
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyGitHub(token) {
  const res = await httpRequest('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'gate-scanner',
      'Accept': 'application/vnd.github+json',
    },
  });

  if (res.statusCode === 200) {
    let details = {};
    try { details = JSON.parse(res.body); } catch {}
    return { status: 'live', details: { login: details.login } };
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify a GitLab token (PAT or pipeline token).
 * GET https://gitlab.com/api/v4/user with Private-Token header.
 *
 * @param {string} token - The GitLab token
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyGitLab(token) {
  const res = await httpRequest('https://gitlab.com/api/v4/user', {
    headers: {
      'Private-Token': token,
    },
  });

  if (res.statusCode === 200) {
    let details = {};
    try { details = JSON.parse(res.body); } catch {}
    return { status: 'live', details: { username: details.username } };
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify a Stripe API key.
 * GET https://api.stripe.com/v1/balance with Bearer auth.
 * Distinguishes live vs test mode from response.
 *
 * @param {string} token - The Stripe API key
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyStripe(token) {
  const res = await httpRequest('https://api.stripe.com/v1/balance', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (res.statusCode === 200) {
    let body = {};
    try { body = JSON.parse(res.body); } catch {}
    return {
      status: 'live',
      details: { livemode: body.livemode === true },
    };
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify a Slack token (bot or user token).
 * POST https://slack.com/api/auth.test with Bearer auth.
 * Checks the `ok` field in the JSON response.
 *
 * @param {string} token - The Slack token
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifySlack(token) {
  const res = await httpRequest('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (res.statusCode === 200) {
    let body = {};
    try { body = JSON.parse(res.body); } catch {}
    if (body.ok === true) {
      return { status: 'live', details: { user: body.user, team: body.team } };
    }
    return { status: 'inactive', details: { error: body.error } };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify an OpenAI API key.
 * GET https://api.openai.com/v1/models with Bearer auth.
 *
 * @param {string} token - The OpenAI API key
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyOpenAI(token) {
  const res = await httpRequest('https://api.openai.com/v1/models', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (res.statusCode === 200) {
    return { status: 'live', details: {} };
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify an Anthropic API key.
 * GET https://api.anthropic.com/v1/models with x-api-key header.
 *
 * @param {string} token - The Anthropic API key
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyAnthropic(token) {
  const res = await httpRequest('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': token,
      'anthropic-version': '2023-06-01',
    },
  });

  if (res.statusCode === 200) {
    return { status: 'live', details: {} };
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify a SendGrid API key.
 * GET https://api.sendgrid.com/v3/user/profile with Bearer auth.
 *
 * @param {string} token - The SendGrid API key
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifySendGrid(token) {
  const res = await httpRequest('https://api.sendgrid.com/v3/user/profile', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (res.statusCode === 200) {
    return { status: 'live', details: {} };
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify a HuggingFace token.
 * GET https://huggingface.co/api/whoami-v2 with Bearer auth.
 *
 * @param {string} token - The HuggingFace token
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyHuggingFace(token) {
  const res = await httpRequest('https://huggingface.co/api/whoami-v2', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (res.statusCode === 200) {
    return { status: 'live', details: {} };
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify an AWS access key.
 *
 * Full verification requires both the access key ID and secret access key
 * to sign a request to STS GetCallerIdentity. Since the scanner may only
 * detect the access key ID (AKIA...), we attempt verification only when
 * the credential looks like a full key. Otherwise, return unknown.
 *
 * @param {string} credential - The AWS credential (access key ID)
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyAWS(credential) {
  // AWS access key IDs start with AKIA and are 20 characters
  if (!/^AKIA[0-9A-Z]{16}$/.test(credential)) {
    return {
      status: 'unknown',
      reason: 'Partial or malformed AWS access key — cannot verify without secret key',
    };
  }

  // Without the corresponding secret access key, we cannot sign
  // an STS request. Return unknown with explanation.
  return {
    status: 'unknown',
    reason: 'AWS verification requires both access key ID and secret access key to sign STS requests. Access key ID detected but secret key not available for signing.',
    details: { keyPrefix: credential.substring(0, 8) + '...' },
  };
}

/**
 * Verify a GCP access token.
 * GET https://oauth2.googleapis.com/tokeninfo?access_token=<token>. 200=live.
 *
 * @param {string} token - The GCP access token
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyGCP(token) {
  const res = await httpRequest(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);

  if (res.statusCode === 200) {
    return { status: 'live', details: {} };
  }
  if (res.statusCode === 400 || res.statusCode === 401) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify a Twilio API key.
 * GET https://api.twilio.com/2010-04-01/Accounts.json with Basic auth (SID:token). 200=live.
 *
 * @param {string} token - The Twilio credential (SID:token format or just token)
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyTwilio(token) {
  const basicAuth = Buffer.from(token.includes(':') ? token : `${token}:`).toString('base64');
  const res = await httpRequest('https://api.twilio.com/2010-04-01/Accounts.json', {
    headers: {
      'Authorization': `Basic ${basicAuth}`,
    },
  });

  if (res.statusCode === 200) {
    return { status: 'live', details: {} };
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify a Supabase key.
 * GET https://<project-ref>.supabase.co/rest/v1/ with apikey header.
 * Without a project ref, returns unknown.
 *
 * @param {string} token - The Supabase key
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifySupabase(token) {
  // Supabase keys are JWTs; without knowing the project ref we cannot construct the URL
  return {
    status: 'unknown',
    reason: 'Supabase verification requires project ref to construct API URL',
  };
}

/**
 * Verify a Vercel token.
 * GET https://api.vercel.com/v2/user with Bearer auth. 200=live.
 *
 * @param {string} token - The Vercel token
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyVercel(token) {
  const res = await httpRequest('https://api.vercel.com/v2/user', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (res.statusCode === 200) {
    return { status: 'live', details: {} };
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify a Netlify token.
 * GET https://api.netlify.com/api/v1/user with Bearer auth. 200=live.
 *
 * @param {string} token - The Netlify token
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyNetlify(token) {
  const res = await httpRequest('https://api.netlify.com/api/v1/user', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (res.statusCode === 200) {
    return { status: 'live', details: {} };
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify a Cloudflare API token.
 * GET https://api.cloudflare.com/client/v4/user/tokens/verify with Bearer auth.
 * 200 + result.status=active = live.
 *
 * @param {string} token - The Cloudflare API token
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyCloudflare(token) {
  const res = await httpRequest('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (res.statusCode === 200) {
    let body = {};
    try { body = JSON.parse(res.body); } catch {}
    if (body.result && body.result.status === 'active') {
      return { status: 'live', details: {} };
    }
    return { status: 'inactive', details: {} };
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Verify a Linear API key.
 * POST https://api.linear.app/graphql with Authorization header.
 * Body: {"query":"{ viewer { id } }"}. 200=live.
 *
 * @param {string} token - The Linear API key
 * @returns {Promise<{status: string, details: object}>}
 */
async function verifyLinear(token) {
  const res = await httpRequest('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: '{ viewer { id } }' }),
  });

  if (res.statusCode === 200) {
    let body = {};
    try { body = JSON.parse(res.body); } catch {}
    if (body.data && body.data.viewer) {
      return { status: 'live', details: {} };
    }
    return { status: 'inactive', details: {} };
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    return { status: 'inactive', details: {} };
  }
  return { status: 'unknown', reason: `Unexpected status: ${res.statusCode}` };
}

/**
 * Generic verifier for unknown providers.
 * Returns unknown since we cannot determine the provider API.
 *
 * @param {string} credential - The credential value
 * @returns {Promise<{status: string, reason: string}>}
 */
async function verifyGeneric(credential) {
  return {
    status: 'unknown',
    reason: 'No verifier available for this credential type',
  };
}

// ── Verifier Registry ────────────────────────────────────────────────────────

/** Map of rule ID to verifier function */
const VERIFIERS = {
  'github-pat': verifyGitHub,
  'github-oauth': verifyGitHub,
  'github-app-token': verifyGitHub,
  'gitlab-pat': verifyGitLab,
  'gitlab-pipeline-token': verifyGitLab,
  'stripe-live-secret': verifyStripe,
  'stripe-test-secret': verifyStripe,
  'stripe-live-restricted': verifyStripe,
  'slack-bot-token': verifySlack,
  'slack-user-token': verifySlack,
  'openai-api-key': verifyOpenAI,
  'anthropic-api-key': verifyAnthropic,
  'sendgrid-api-key': verifySendGrid,
  'huggingface-token': verifyHuggingFace,
  'aws-access-key-id': verifyAWS,
  'gcp-api-key': verifyGCP,
  'twilio-api-key': verifyTwilio,
  'supabase-key': verifySupabase,
  'vercel-token': verifyVercel,
  'netlify-token': verifyNetlify,
  'cloudflare-api-key': verifyCloudflare,
  'cloudflare-api-token': verifyCloudflare,
  'linear-api-key': verifyLinear,
};

// ── Main API ─────────────────────────────────────────────────────────────────

/**
 * Verify a single credential by rule ID.
 *
 * @param {string} ruleId - The rule ID that detected the credential
 * @param {string} credential - The raw credential value
 * @returns {Promise<{status: string, details?: object, reason?: string}>}
 */
async function verifyCredential(ruleId, credential) {
  const verifier = VERIFIERS[ruleId];
  if (!verifier) {
    return { status: 'unknown', reason: 'No verifier for this provider' };
  }

  try {
    return await withTimeout(verifier(credential), PER_PROVIDER_TIMEOUT);
  } catch (err) {
    if (err.message === 'timeout') {
      return { status: 'timeout', reason: 'Provider did not respond in time' };
    }
    return { status: 'error', reason: err.message };
  }
}

/**
 * Verify an array of findings in parallel with budget constraints.
 *
 * @param {Array} findings - Array of finding objects with ruleId and match
 * @param {object} options - Options ({ noVerify, cache })
 * @returns {Promise<Array>} The same findings array with .verification added
 */
async function verifyFindings(findings, options = {}) {
  if (options.noVerify) return findings;

  // Respect GATE_OFFLINE mode
  if (process.env.GATE_OFFLINE === '1') return findings;

  // Check if TLS validation is disabled — skip verification for safety
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    process.stderr.write('gate: warning: TLS validation is disabled. Credential verification skipped for safety.\n');
    return findings;
  }

  const cache = loadCache();
  const budget = { start: Date.now(), limit: TOTAL_BUDGET };

  const promises = findings.map(async (finding) => {
    // Check cache first
    const cacheKey = `${finding.ruleId}:${hashCredential(finding.match)}`;
    const cached = cache[cacheKey];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      finding.verification = cached.result;
      adjustSeverity(finding);
      return;
    }

    // Check budget
    if (Date.now() - budget.start > budget.limit) {
      finding.verification = { status: 'skipped', reason: 'budget exceeded' };
      return;
    }

    const verifier = VERIFIERS[finding.ruleId];
    if (!verifier) {
      finding.verification = { status: 'unknown', reason: 'No verifier for this provider' };
      return;
    }

    try {
      const result = await withTimeout(verifier(finding.match), PER_PROVIDER_TIMEOUT);
      finding.verification = result;
      cache[cacheKey] = { result, timestamp: Date.now() };
      adjustSeverity(finding);
    } catch (err) {
      if (err.message === 'timeout') {
        finding.verification = { status: 'timeout', reason: 'Provider did not respond in time' };
      } else {
        finding.verification = { status: 'error', reason: err.message };
      }
    }
  });

  await Promise.allSettled(promises);
  saveCache(cache);
  return findings;
}

/**
 * Adjust finding severity based on verification status.
 * - If live and not already critical, upgrade to critical.
 * - If inactive, downgrade to low.
 *
 * @param {object} finding - Finding object with verification result
 */
function adjustSeverity(finding) {
  if (!finding.verification) return;

  const { status } = finding.verification;

  if (status === 'live' && finding.severity !== 'critical') {
    finding.severity = 'critical';
  } else if (status === 'inactive') {
    finding.severity = 'low';
    finding.autoDowngraded = true;
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  verifyFindings,
  verifyCredential,
  loadCache,
  saveCache,
  VERIFIERS,
  // Exported for testing
  httpRequest,
  withTimeout,
  hashCredential,
  adjustSeverity,
  PER_PROVIDER_TIMEOUT,
  TOTAL_BUDGET,
  CACHE_TTL,
};
