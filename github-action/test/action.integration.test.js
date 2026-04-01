'use strict';

const EventEmitter = require('events');

jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('child_process');

const core = require('@actions/core');
const github = require('@actions/github');
const childProcess = require('child_process');
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

describe('github-action run()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    childProcess.execSync.mockImplementation(() => Buffer.from(''));
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
    github.getOctokit.mockReturnValue({
      rest: {
        issues: {
          listComments: jest.fn().mockResolvedValue({ data: [] }),
          deleteComment: jest.fn(),
          createComment: jest.fn().mockResolvedValue({}),
        },
        codeScanning: {
          uploadSarif: jest.fn().mockResolvedValue({}),
        },
      },
    });
  });

  test('blocks the workflow on findings when failure-mode resolves to block', async () => {
    core.getInput.mockImplementation((name) => ({
      mode: 'enforce',
      verify: 'false',
      format: 'text',
      'fail-on': 'high',
      'failure-mode': 'block',
      'github-token': 'token',
      'slack-webhook': '',
    }[name] || ''));

    childProcess.spawn.mockImplementation(() => makeSpawnProcess({
      code: 1,
      stdout: JSON.stringify({
        findings: [{ file: 'config.js', line: 1, ruleName: 'AWS Access Key ID', severity: 'critical' }],
        summary: { errors: 0 },
      }),
    }));

    await action.run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('at or above'));
    expect(core.setOutput).toHaveBeenCalledWith('findings-count', '1');
  });

  test('warns instead of failing when scan errors occur in warn mode', async () => {
    core.getInput.mockImplementation((name) => ({
      mode: 'report',
      verify: 'false',
      format: 'text',
      'fail-on': 'high',
      'failure-mode': 'warn',
      'github-token': '',
      'slack-webhook': '',
    }[name] || ''));

    childProcess.spawn.mockImplementation(() => makeSpawnProcess({
      code: 1,
      stdout: JSON.stringify({
        findings: [],
        errors: [{ file: 'secrets.txt', error: 'Permission denied' }],
        summary: { errors: 1 },
      }),
    }));

    await action.run();

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('scan incomplete'));
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('uploads SARIF when requested', async () => {
    core.getInput.mockImplementation((name) => ({
      mode: 'report',
      verify: 'false',
      format: 'sarif',
      'fail-on': 'high',
      'failure-mode': 'warn',
      'github-token': 'token',
      'slack-webhook': '',
    }[name] || ''));

    childProcess.spawn
      .mockImplementationOnce(() => makeSpawnProcess({
        code: 0,
        stdout: JSON.stringify({ findings: [], summary: { errors: 0 } }),
      }))
      .mockImplementationOnce(() => makeSpawnProcess({
        code: 0,
        stdout: JSON.stringify({ version: '2.1.0', runs: [] }),
      }));

    await action.run();

    const octokit = github.getOctokit.mock.results[0].value;
    expect(octokit.rest.codeScanning.uploadSarif).toHaveBeenCalled();
  });
});
