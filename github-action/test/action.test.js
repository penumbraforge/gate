const { GateAction } = require('../action');
const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Mock dependencies
jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('fs');
jest.mock('child_process');

describe('Gate GitHub Action', () => {
  let action;
  let mockOctokit;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock core.getInput
    core.getInput.mockImplementation((name) => {
      const inputs = {
        'mode': 'enforce',
        'slack-webhook': 'https://hooks.slack.com/test',
        'failure-mode': 'block',
        'github-token': 'test-token'
      };
      return inputs[name] || '';
    });

    // Mock github context
    github.context = {
      eventName: 'pull_request',
      sha: 'abc123def456',
      actor: 'test-user',
      serverUrl: 'https://github.com',
      runId: '12345',
      payload: {
        pull_request: {
          number: 1,
          html_url: 'https://github.com/test/repo/pull/1'
        }
      },
      repo: {
        owner: 'test-owner',
        repo: 'test-repo'
      }
    };

    // Mock octokit
    mockOctokit = {
      rest: {
        pulls: {
          listFiles: jest.fn(),
          listReviews: jest.fn(),
          createReview: jest.fn()
        },
        issues: {
          listComments: jest.fn(),
          deleteComment: jest.fn(),
          createComment: jest.fn()
        },
        git: {
          getCommit: jest.fn(),
          getTree: jest.fn()
        }
      }
    };

    github.getOctokit.mockReturnValue(mockOctokit);

    // Create action instance
    action = new GateAction();
  });

  describe('Initialization', () => {
    it('should initialize with correct inputs', () => {
      expect(action.mode).toBe('enforce');
      expect(action.failureMode).toBe('block');
      expect(action.slackWebhook).toBe('https://hooks.slack.com/test');
    });

    it('should have empty findings initially', () => {
      expect(action.findings).toEqual([]);
    });
  });

  describe('Repository Configuration', () => {
    it('should load .gate.json if present', () => {
      const mockConfig = {
        enforce_mode: true,
        notify_security: true
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

      const config = action.loadRepoConfig();
      expect(config).toEqual(mockConfig);
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('.gate.json'));
    });

    it('should handle missing .gate.json gracefully', () => {
      fs.existsSync.mockReturnValue(false);
      const config = action.loadRepoConfig();
      expect(config).toEqual({});
    });

    it('should warn on malformed .gate.json', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json {');

      const config = action.loadRepoConfig();
      expect(config).toEqual({});
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('parse'));
    });
  });

  describe('Allowlist Handling', () => {
    it('should load allowlist from .gate-allowlist.json', () => {
      const mockAllowlist = [
        { file: 'docs/example.md', rule: 'aws-secret-key' }
      ];

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockAllowlist));

      const allowlist = action.loadAllowlist({});
      expect(allowlist).toEqual(mockAllowlist);
    });

    it('should filter allowlisted findings', () => {
      action.findings = [
        { file: 'config.js', rule: 'aws-secret-key', severity: 'CRITICAL' },
        { file: 'docs/example.md', rule: 'aws-secret-key', severity: 'CRITICAL' },
        { file: 'src/index.js', rule: 'api-key-exposed', severity: 'HIGH' }
      ];

      const allowlist = [
        { file: 'docs/example.md', rule: 'aws-secret-key' }
      ];

      action.filterAllowlistedFindings(allowlist);

      expect(action.findings).toHaveLength(2);
      expect(action.findings).not.toContainEqual(
        expect.objectContaining({ file: 'docs/example.md' })
      );
    });
  });

  describe('License Verification', () => {
    it('should verify license successfully', async () => {
      action.checkLicense = jest.fn().mockResolvedValue(true);

      await action.verifyLicense({});

      expect(action.auditLog.licenseValid).toBe(true);
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('License verified'));
    });

    it('should warn when license verification fails', async () => {
      action.checkLicense = jest.fn().mockRejectedValue(new Error('Network error'));

      await action.verifyLicense({});

      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('License check failed'));
    });

    it('should skip license check if configured', async () => {
      action.checkLicense = jest.fn();

      await action.verifyLicense({ skip_license_check: true });

      expect(action.checkLicense).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('skipped'));
    });
  });

  describe('File Scanning', () => {
    it('should get PR files for pull_request event', async () => {
      mockOctokit.rest.pulls.listFiles.mockResolvedValue({
        data: [
          { filename: 'src/index.js' },
          { filename: 'config.json' }
        ]
      });

      const files = await action.getFilesToScan();

      expect(files).toEqual(['src/index.js', 'config.json']);
      expect(mockOctokit.rest.pulls.listFiles).toHaveBeenCalled();
    });

    it('should handle API errors when getting files', async () => {
      mockOctokit.rest.pulls.listFiles.mockRejectedValue(new Error('API error'));

      const files = await action.getFilesToScan();

      expect(files).toEqual([]);
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to get files'));
    });
  });

  describe('Gate Scanner Execution', () => {
    it('should parse Gate JSON output correctly', async () => {
      const mockOutput = {
        findings: [
          {
            file: 'config.js',
            rule: 'aws-secret-access-key',
            severity: 'CRITICAL',
            message: 'AWS secret key detected'
          }
        ]
      };

      const spawnMock = jest.fn();
      spawn.mockImplementation((cmd, args, opts) => {
        return {
          stdout: {
            on: (event, cb) => {
              if (event === 'data') {
                cb(JSON.stringify(mockOutput));
              }
            }
          },
          stderr: { on: jest.fn() },
          on: (event, cb) => {
            if (event === 'close') {
              setTimeout(() => cb(1), 0);
            }
          }
        };
      });

      await action.runGateScanner(['config.js'], {});

      expect(action.findings).toHaveLength(1);
      expect(action.findings[0].rule).toBe('aws-secret-access-key');
    });

    it('should handle Gate not installed', async () => {
      const spawnMock = jest.fn();
      spawn.mockImplementation((cmd, args, opts) => {
        return {
          stdout: { on: jest.fn() },
          stderr: {
            on: (event, cb) => {
              if (event === 'data') {
                cb('command not found: gate');
              }
            }
          },
          on: (event, cb) => {
            if (event === 'close') {
              setTimeout(() => cb(127), 0);
            }
          }
        };
      });

      action.installGate = jest.fn().mockResolvedValue(undefined);

      await action.runGateScanner(['config.js'], {});

      expect(action.installGate).toHaveBeenCalled();
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Gate not installed'));
    });
  });

  describe('PR Comments', () => {
    beforeEach(() => {
      github.context.eventName = 'pull_request';
      mockOctokit.rest.issues.listComments.mockResolvedValue({ data: [] });
      mockOctokit.rest.issues.createComment.mockResolvedValue({});
      mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
    });

    it('should post PR comment with findings', async () => {
      action.findings = [
        {
          file: 'config.js',
          rule: 'aws-secret-access-key',
          severity: 'CRITICAL',
          message: 'AWS secret detected'
        }
      ];

      await action.postPRComment();

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
      const comment = mockOctokit.rest.issues.createComment.mock.calls[0][0];
      expect(comment.body).toContain('Gate blocked this PR');
      expect(comment.body).toContain('config.js');
    });

    it('should post success comment when no findings', async () => {
      action.findings = [];

      await action.postPRComment();

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
      const comment = mockOctokit.rest.issues.createComment.mock.calls[0][0];
      expect(comment.body).toContain('Gate scan passed');
    });

    it('should delete old Gate comments', async () => {
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, body: '⛔ Gate blocked this PR\n...' },
          { id: 2, body: 'Some other comment' }
        ]
      });

      action.findings = [];

      await action.postPRComment();

      expect(mockOctokit.rest.issues.deleteComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 1
      });
      expect(mockOctokit.rest.issues.deleteComment).not.toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 2 })
      );
    });

    it('should request changes on critical findings', async () => {
      action.findings = [
        { severity: 'CRITICAL', rule: 'aws-secret-key' }
      ];

      mockOctokit.rest.issues.listComments.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.createReview.mockResolvedValue({});

      await action.postPRComment();

      expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'REQUEST_CHANGES' })
      );
    });
  });

  describe('Slack Notifications', () => {
    it('should send Slack notification on findings', async () => {
      action.findings = [
        { file: 'config.js', rule: 'aws-secret-key', severity: 'CRITICAL' }
      ];
      action.postToSlack = jest.fn().mockResolvedValue(undefined);

      await action.sendSlackNotification();

      expect(action.postToSlack).toHaveBeenCalled();
    });

    it('should not send Slack if no webhook configured', async () => {
      action.slackWebhook = null;
      action.postToSlack = jest.fn();

      await action.sendSlackNotification();

      expect(action.postToSlack).not.toHaveBeenCalled();
    });

    it('should handle Slack notification errors gracefully', async () => {
      action.findings = [{ rule: 'aws-secret-key' }];
      action.postToSlack = jest.fn().mockRejectedValue(new Error('Slack error'));

      await action.sendSlackNotification();

      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Slack'));
    });
  });

  describe('Findings Handling', () => {
    it('should fail on findings in enforce mode', () => {
      action.findings = [{ rule: 'aws-secret-key' }];
      action.mode = 'enforce';

      action.handleFindings();

      expect(core.setFailed).toHaveBeenCalled();
    });

    it('should warn on findings in report mode', () => {
      action.findings = [{ rule: 'aws-secret-key' }];
      action.mode = 'report';
      action.failureMode = 'warn';

      action.handleFindings();

      expect(core.warning).toHaveBeenCalled();
    });

    it('should set outputs correctly', () => {
      action.findings = [{ rule: 'aws-secret-key' }, { rule: 'api-key' }];

      action.handleFindings();

      expect(core.setOutput).toHaveBeenCalledWith('findings-count', '2');
      expect(core.setOutput).toHaveBeenCalledWith('blocked', 'true');
    });

    it('should bypass detection override mode', () => {
      action.findings = [];
      action.bypassDetected = true;

      action.handleFindings();

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('bypass')
      );
    });
  });

  describe('Error Handling', () => {
    it('should fail closed on corrupted rules', async () => {
      const error = new Error('rules file corrupted');
      action.handleError(error);

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('fail-closed')
      );
    });

    it('should fail open on scanner errors', () => {
      const error = new Error('Gate scanner crashed');
      action.mode = 'enforce';
      action.handleError(error);

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('fail open')
      );
    });

    it('should handle network errors gracefully', () => {
      const error = new Error('GitHub API unreachable');
      action.handleError(error);

      expect(core.error).toHaveBeenCalled();
    });
  });

  describe('Audit Log', () => {
    it('should create audit log with findings', () => {
      action.findings = [
        { rule: 'aws-secret-key' },
        { rule: 'api-key' }
      ];
      action.auditLog.filesScanned = ['config.js'];

      action.postAuditLog();

      expect(action.auditLog.decision).toBe('blocked');
      expect(action.auditLog.rulesMatched).toHaveLength(2);
      expect(core.info).toHaveBeenCalled();
    });

    it('should mark passed in audit log when no findings', () => {
      action.findings = [];
      action.postAuditLog();

      expect(action.auditLog.decision).toBe('passed');
    });
  });
});
