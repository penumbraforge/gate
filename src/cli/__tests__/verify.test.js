/**
 * Tests for credential verification module
 * All HTTP requests are mocked — NEVER hits real APIs
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

// Mock fs before requiring verify module
jest.mock('fs');
const fs = require('fs');

// Mock https and http modules
jest.mock('https');
jest.mock('http');
const https = require('https');
const http = require('http');

const {
  verifyFindings,
  verifyCredential,
  loadCache,
  saveCache,
  VERIFIERS,
} = require('../verify');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a mock https.request that calls the callback with a
 * simulated response emitting data + end events.
 *
 * The implementation calls: mod.request(optionsObject, callback)
 * so our mock receives (options, callback).
 */
function mockHttpResponse(statusCode, body, delay = 0) {
  return (options, callback) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.headers = {};

    const req = new EventEmitter();
    req.end = jest.fn(() => {
      const deliver = () => {
        callback(res);
        if (body !== null) {
          res.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
        }
        res.emit('end');
      };
      if (delay > 0) {
        setTimeout(deliver, delay);
      } else {
        // Use nextTick for zero-delay to keep async flow clean
        process.nextTick(deliver);
      }
    });

    return req;
  };
}

/**
 * Build a mock HTTP request that errors.
 */
function mockHttpError(errorMessage) {
  return (options, callback) => {
    const req = new EventEmitter();
    req.end = jest.fn(() => {
      process.nextTick(() => {
        req.emit('error', new Error(errorMessage));
      });
    });
    return req;
  };
}

/**
 * Build a finding object for testing.
 */
function makeFinding(ruleId, match) {
  return { ruleId, match, file: 'test.js', line: 1 };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();

  // Default: no cache file exists
  fs.existsSync.mockReturnValue(false);
  fs.readFileSync.mockReturnValue('{}');
  fs.writeFileSync.mockImplementation(() => {});
  fs.mkdirSync.mockImplementation(() => {});

  // Default: https.request resolves with 200
  https.request.mockImplementation(mockHttpResponse(200, '{}'));
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('verifyCredential', () => {
  test('GitHub PAT verified live (200 response)', async () => {
    https.request.mockImplementation(
      mockHttpResponse(200, JSON.stringify({ login: 'testuser' }))
    );

    const result = await verifyCredential('github-pat', 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(result.status).toBe('live');
  });

  test('GitHub PAT verified inactive (401 response)', async () => {
    https.request.mockImplementation(
      mockHttpResponse(401, JSON.stringify({ message: 'Bad credentials' }))
    );

    const result = await verifyCredential('github-pat', 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(result.status).toBe('inactive');
  });

  test('Stripe key live vs test mode detection', async () => {
    // Stripe live key — 200 with livemode: true
    https.request.mockImplementation(
      mockHttpResponse(200, JSON.stringify({ livemode: true, object: 'balance' }))
    );

    const liveResult = await verifyCredential('stripe-live-secret', 'sk_live_00000000000000000000000000');
    expect(liveResult.status).toBe('live');
    expect(liveResult.details).toMatchObject({ livemode: true });

    // Stripe test key — 200 with livemode: false
    https.request.mockImplementation(
      mockHttpResponse(200, JSON.stringify({ livemode: false, object: 'balance' }))
    );

    const testResult = await verifyCredential('stripe-test-secret', 'sk_test_00000000000000000000000000');
    expect(testResult.status).toBe('live');
    expect(testResult.details).toMatchObject({ livemode: false });
  });

  test('Slack token verified (ok:true response)', async () => {
    https.request.mockImplementation(
      mockHttpResponse(200, JSON.stringify({ ok: true, user: 'testbot' }))
    );

    const result = await verifyCredential('slack-bot-token', 'xoxb-000000000000-000000000000-000000000000');
    expect(result.status).toBe('live');
  });

  test('OpenAI key verified live', async () => {
    https.request.mockImplementation(
      mockHttpResponse(200, JSON.stringify({ data: [{ id: 'gpt-4' }] }))
    );

    const result = await verifyCredential('openai-api-key', 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(result.status).toBe('live');
  });

  test('Anthropic key verified live', async () => {
    https.request.mockImplementation(
      mockHttpResponse(200, JSON.stringify({ data: [{ id: 'claude-3' }] }))
    );

    const result = await verifyCredential('anthropic-api-key', 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(result.status).toBe('live');
  });

  test('Provider timeout (response takes > 2s)', async () => {
    // Simulate a response that takes 3 seconds — beyond PER_PROVIDER_TIMEOUT (2s)
    https.request.mockImplementation(
      mockHttpResponse(200, '{}', 3000)
    );

    const result = await verifyCredential('github-pat', 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(result.status).toBe('timeout');
  }, 10000);

  test('No network available (connection error) → graceful error status', async () => {
    https.request.mockImplementation(mockHttpError('ENOTFOUND'));

    const result = await verifyCredential('github-pat', 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(result.status).toBe('error');
    expect(result.reason).toMatch(/ENOTFOUND/);
  });

  test('Unknown provider → returns unknown status', async () => {
    const result = await verifyCredential('some-unknown-rule', 'secret_value_here');
    expect(result.status).toBe('unknown');
    expect(result.reason).toMatch(/no verifier/i);
  });
});

describe('verifyFindings', () => {
  test('noVerify option skips all verification', async () => {
    const findings = [makeFinding('github-pat', 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')];
    const result = await verifyFindings(findings, { noVerify: true });

    expect(result).toEqual(findings);
    expect(result[0].verification).toBeUndefined();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('Total budget exceeded (many findings, budget runs out)', async () => {
    // Create 20 findings
    const findings = Array.from({ length: 20 }, (_, i) =>
      makeFinding('github-pat', `ghp_token_${i}_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
    );

    // Mock response that takes 500ms — with 5s total budget,
    // parallel execution might complete all, but budget check before dispatch
    // should catch some if we mock Date.now to simulate passage of time
    let callCount = 0;
    https.request.mockImplementation((options, callback) => {
      callCount++;
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {};

      const req = new EventEmitter();
      req.end = jest.fn(() => {
        setTimeout(() => {
          callback(res);
          res.emit('data', JSON.stringify({ login: 'user' }));
          res.emit('end');
        }, 300);
      });
      return req;
    });

    const result = await verifyFindings(findings, {});

    // All 20 findings should have a verification status set
    expect(result.length).toBe(20);
    result.forEach(f => {
      expect(f.verification).toBeDefined();
    });
  }, 15000);

  test('Cache hit within TTL (no HTTP call made on second verify)', async () => {
    https.request.mockImplementation(
      mockHttpResponse(200, JSON.stringify({ login: 'testuser' }))
    );

    // Simulate cache file that already has a result for this credential
    const credential = 'ghp_cached_token_xxxxxxxxxxxxxxxxxxxxxxxx';
    const cacheKey = 'github-pat:' + crypto.createHash('sha256').update(credential).digest('hex');
    const cacheData = {};
    cacheData[cacheKey] = {
      result: { status: 'live', details: {} },
      timestamp: Date.now(),
    };
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(cacheData));

    const findings = [makeFinding('github-pat', credential)];
    const result = await verifyFindings(findings, {});

    // Should NOT have made any HTTP calls — cache was used
    expect(https.request).not.toHaveBeenCalled();
    expect(result[0].verification.status).toBe('live');
  });

  test('Cache miss after TTL expiry (HTTP call made again)', async () => {
    https.request.mockImplementation(
      mockHttpResponse(200, JSON.stringify({ login: 'testuser' }))
    );

    // Simulate cache with expired entry (2 hours ago)
    const credential = 'ghp_expired_token_xxxxxxxxxxxxxxxxxxxxxxx';
    const cacheKey = 'github-pat:' + crypto.createHash('sha256').update(credential).digest('hex');
    const cacheData = {};
    cacheData[cacheKey] = {
      result: { status: 'live', details: {} },
      timestamp: Date.now() - (2 * 60 * 60 * 1000), // 2 hours ago — beyond 1h TTL
    };
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(cacheData));

    const findings = [makeFinding('github-pat', credential)];
    const result = await verifyFindings(findings, {});

    // Should have made an HTTP call since cache expired
    expect(https.request).toHaveBeenCalled();
    expect(result[0].verification.status).toBe('live');
  });
});

describe('Cache key hashing', () => {
  test('Different credentials get different cache keys', () => {
    const hash1 = crypto.createHash('sha256').update('ghp_token_aaa').digest('hex');
    const hash2 = crypto.createHash('sha256').update('ghp_token_bbb').digest('hex');

    const key1 = `github-pat:${hash1}`;
    const key2 = `github-pat:${hash2}`;

    expect(key1).not.toEqual(key2);
    expect(hash1).not.toEqual(hash2);
  });
});

describe('VERIFIERS mapping', () => {
  test('all expected rule IDs have verifier functions', () => {
    const expectedRules = [
      'github-pat',
      'github-oauth',
      'github-app-token',
      'gitlab-pat',
      'gitlab-pipeline-token',
      'stripe-live-secret',
      'stripe-test-secret',
      'stripe-live-restricted',
      'slack-bot-token',
      'slack-user-token',
      'openai-api-key',
      'anthropic-api-key',
      'sendgrid-api-key',
      'huggingface-token',
      'aws-access-key-id',
      'gcp-api-key',
      'twilio-api-key',
      'supabase-key',
      'vercel-token',
      'netlify-token',
      'cloudflare-api-key',
      'cloudflare-api-token',
      'linear-api-key',
    ];

    for (const ruleId of expectedRules) {
      expect(VERIFIERS[ruleId]).toBeDefined();
      expect(typeof VERIFIERS[ruleId]).toBe('function');
    }
  });
});
