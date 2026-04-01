'use strict';

const EventEmitter = require('events');

jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('child_process');
jest.mock('https');

const core = require('@actions/core');
const github = require('@actions/github');
const childProcess = require('child_process');
const https = require('https');
const action = require('../action');

function makeSpawnProcess({ code = 0, stdout = '', stderr = '' }) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  process.nextTick(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', code);
  });

  return proc;
}

describe('github-action action.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    github.context = {
      eventName: 'pull_request',
      sha: 'abc123',
      ref: 'refs/pull/1/head',
      actor: 'test-user',
      serverUrl: 'https://github.com',
      runId: '42',
      payload: { pull_request: { number: 7 } },
      repo: { owner: 'penumbraforge', repo: 'gate' },
    };
  });

  test('resolveFailureMode honors explicit setting and sensible defaults', () => {
    expect(action.resolveFailureMode('enforce', '')).toBe('block');
    expect(action.resolveFailureMode('report', '')).toBe('warn');
    expect(action.resolveFailureMode('report', 'block')).toBe('block');
  });

  test('ensureGateInstalled probes the CLI and installs the correct package', () => {
    childProcess.execSync
      .mockImplementationOnce(() => { throw new Error('missing'); })
      .mockImplementation(() => Buffer.from(''));

    const result = action.ensureGateInstalled();

    expect(result).toBe('gate');
    expect(childProcess.execSync).toHaveBeenNthCalledWith(1, 'gate --version', { stdio: 'ignore' });
    expect(childProcess.execSync).toHaveBeenNthCalledWith(
      2,
      'npm install -g @penumbraforge/gate',
      { stdio: 'inherit' }
    );
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('@penumbraforge/gate'));
  });

  test('runGateScan parses JSON output when Gate exits 1 for findings', async () => {
    childProcess.spawn.mockImplementation(() => makeSpawnProcess({
      code: 1,
      stdout: JSON.stringify({
        findings: [{ file: 'config.js', ruleName: 'Stripe Live Secret Key', severity: 'critical' }],
        summary: { errors: 0 },
      }),
    }));

    const result = await action.runGateScan(['--verify']);

    expect(result.findings).toHaveLength(1);
    expect(childProcess.spawn).toHaveBeenCalledWith(
      'gate',
      ['scan', '--all', '--format', 'json', '--verify'],
      expect.objectContaining({ cwd: expect.any(String) })
    );
  });

  test('postPRComment uses current Gate JSON fields', async () => {
    const octokit = {
      rest: {
        issues: {
          listComments: jest.fn().mockResolvedValue({ data: [] }),
          deleteComment: jest.fn(),
          createComment: jest.fn().mockResolvedValue({}),
        },
      },
    };

    await action.postPRComment(
      [{ file: 'src/config.js', line: 12, ruleName: 'Stripe Live Secret Key', severity: 'critical' }],
      octokit,
      github.context
    );

    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('Stripe Live Secret Key'),
      })
    );
  });

  test('sendSlackNotification includes ruleName in the payload', async () => {
    let capturedBody = '';
    const response = new EventEmitter();
    https.request.mockImplementation((options, callback) => {
      callback(response);
      return {
        on: jest.fn(),
        setTimeout: jest.fn(),
        write: (chunk) => { capturedBody += chunk; },
        end: () => process.nextTick(() => response.emit('end')),
      };
    });

    await action.sendSlackNotification(
      [{ file: 'src/config.js', line: 9, ruleName: 'AWS Access Key ID', severity: 'critical' }],
      'https://hooks.slack.com/services/test',
      github.context
    );

    expect(capturedBody).toContain('AWS Access Key ID');
  });
});
