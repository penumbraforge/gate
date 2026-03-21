const { GateAction } = require('../action');
const github = require('@actions/github');
const core = require('@actions/core');
const fs = require('fs');

// Integration tests - full workflow scenarios
jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('fs');

describe('Gate Action - Integration Tests', () => {
  let action;
  let mockOctokit;

  beforeEach(() => {
    jest.clearAllMocks();

    core.getInput.mockImplementation((name) => {
      const inputs = {
        'mode': 'enforce',
        'slack-webhook': 'https://hooks.slack.com/test',
        'failure-mode': 'block',
        'github-token': 'test-token'
      };
      return inputs[name] || '';
    });

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
    action = new GateAction();
  });

  describe('End-to-End: PR with Critical Findings', () => {
    it('should block PR with critical findings and request changes', async () => {
      // Setup
      mockOctokit.rest.pulls.listFiles.mockResolvedValue({
        data: [{ filename: 'config.js' }]
      });

      mockOctokit.rest.issues.listComments.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });

      action.findings = [
        {
          file: 'config.js',
          rule: 'aws-secret-access-key',
          severity: 'CRITICAL',
          message: 'AWS secret detected'
        }
      ];

      action.postToSlack = jest.fn().mockResolvedValue(undefined);

      // Execute
      await action.postPRComment();
      await action.sendSlackNotification();
      action.handleFindings();

      // Verify
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'REQUEST_CHANGES' })
      );
      expect(action.postToSlack).toHaveBeenCalled();
      expect(core.setFailed).toHaveBeenCalled();
    });
  });

  describe('End-to-End: Clean PR (No Findings)', () => {
    it('should pass PR with no findings', async () => {
      // Setup
      mockOctokit.rest.pulls.listFiles.mockResolvedValue({
        data: [{ filename: 'src/index.js' }]
      });

      mockOctokit.rest.issues.listComments.mockResolvedValue({ data: [] });
      action.findings = [];

      // Execute
      await action.postPRComment();
      action.handleFindings();

      // Verify
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Gate scan passed')
        })
      );
      expect(core.setFailed).not.toHaveBeenCalled();
    });
  });

  describe('End-to-End: Allowlisted Finding', () => {
    it('should filter allowlisted findings before posting', async () => {
      // Setup
      action.findings = [
        { file: 'docs/example.md', rule: 'aws-secret-key', severity: 'CRITICAL' }
      ];

      const allowlist = [
        { file: 'docs/example.md', rule: 'aws-secret-key' }
      ];

      // Execute
      action.filterAllowlistedFindings(allowlist);

      // Verify
      expect(action.findings).toHaveLength(0);
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Filtered'));
    });
  });

  describe('End-to-End: Report Mode', () => {
    beforeEach(() => {
      action.mode = 'report';
      action.failureMode = 'warn';
    });

    it('should warn but not fail in report mode', () => {
      // Setup
      action.findings = [{ rule: 'aws-secret-key' }];

      // Execute
      action.handleFindings();

      // Verify
      expect(core.warning).toHaveBeenCalled();
      expect(core.setFailed).not.toHaveBeenCalled();
    });
  });

  describe('End-to-End: Bypass Detection', () => {
    it('should always block on bypass regardless of mode', () => {
      // Setup
      action.findings = [];
      action.bypassDetected = true;
      action.mode = 'report';

      // Execute
      action.handleFindings();

      // Verify
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('bypass')
      );
    });
  });

  describe('End-to-End: Slack Notification', () => {
    it('should include proper formatting in Slack message', async () => {
      // Setup
      action.findings = [
        { file: 'config.js', rule: 'aws-secret-key', severity: 'CRITICAL' }
      ];

      action.postToSlack = jest.fn().mockResolvedValue(undefined);

      // Execute
      await action.sendSlackNotification();

      // Verify
      expect(action.postToSlack).toHaveBeenCalled();
      const payload = action.postToSlack.mock.calls[0][0];
      expect(payload.attachments[0].fields).toBeDefined();
      expect(payload.attachments[0].color).toBe('#FFA500');
    });
  });

  describe('End-to-End: Audit Log', () => {
    it('should create complete audit log', () => {
      // Setup
      action.findings = [
        { rule: 'aws-secret-key' },
        { rule: 'api-key' }
      ];
      action.auditLog.filesScanned = ['config.js'];

      // Execute
      action.postAuditLog();

      // Verify
      expect(action.auditLog.decision).toBe('blocked');
      expect(action.auditLog.rulesMatched).toHaveLength(2);
      expect(action.auditLog.commit).toBe(github.context.sha);
      expect(action.auditLog.actor).toBe('test-user');
    });
  });

  describe('End-to-End: License Check Flow', () => {
    it('should continue if license verification succeeds', async () => {
      // Setup
      action.checkLicense = jest.fn().mockResolvedValue(true);

      // Execute
      await action.verifyLicense({});

      // Verify
      expect(action.auditLog.licenseValid).toBe(true);
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('License verified'));
    });

    it('should continue if license check fails', async () => {
      // Setup
      action.checkLicense = jest.fn().mockRejectedValue(new Error('Network error'));

      // Execute
      await action.verifyLicense({});

      // Verify
      expect(core.warning).toHaveBeenCalled();
      expect(action.auditLog.licenseValid).toBe(null);
    });
  });

  describe('End-to-End: Multi-File Findings', () => {
    it('should group findings by file in PR comment', async () => {
      // Setup
      mockOctokit.rest.issues.listComments.mockResolvedValue({ data: [] });

      action.findings = [
        { file: 'config.js', rule: 'aws-secret-key', severity: 'CRITICAL' },
        { file: 'config.js', rule: 'api-key', severity: 'HIGH' },
        { file: 'src/index.js', rule: 'db-password', severity: 'CRITICAL' }
      ];

      // Execute
      await action.postPRComment();

      // Verify
      const comment = mockOctokit.rest.issues.createComment.mock.calls[0][0];
      expect(comment.body).toContain('config.js');
      expect(comment.body).toContain('src/index.js');
      expect(comment.body).toContain('Found 3 security findings');
    });
  });

  describe('End-to-End: Old Comment Cleanup', () => {
    it('should delete old Gate comments', async () => {
      // Setup
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, body: '⛔ Gate blocked this PR\n...' },
          { id: 2, body: '✅ Gate scan passed' },
          { id: 3, body: 'Other bot comment' }
        ]
      });

      action.findings = [];

      // Execute
      await action.postPRComment();

      // Verify
      expect(mockOctokit.rest.issues.deleteComment).toHaveBeenCalledTimes(2);
      expect(mockOctokit.rest.issues.deleteComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 1 })
      );
      expect(mockOctokit.rest.issues.deleteComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 2 })
      );
      // Should NOT delete comment 3
      expect(mockOctokit.rest.issues.deleteComment).not.toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 3 })
      );
    });
  });

  describe('End-to-End: Configuration Override', () => {
    it('should use .gate.json settings', () => {
      // Setup
      const config = {
        enforce_mode: true,
        block_on_findings: true
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(config));

      // Execute
      const loaded = action.loadRepoConfig();

      // Verify
      expect(loaded.enforce_mode).toBe(true);
      expect(loaded.block_on_findings).toBe(true);
    });
  });

  describe('End-to-End: Output Variables', () => {
    it('should set all output variables', () => {
      // Setup
      action.findings = [
        { rule: 'aws-secret-key' },
        { rule: 'api-key' }
      ];

      // Execute
      action.handleFindings();

      // Verify
      expect(core.setOutput).toHaveBeenCalledWith('findings-count', '2');
      expect(core.setOutput).toHaveBeenCalledWith('blocked', 'true');
      expect(core.setOutput).toHaveBeenCalledWith(
        'scan-report',
        expect.stringContaining('findings')
      );
    });
  });

  describe('End-to-End: Error Recovery', () => {
    it('should handle API failures gracefully', async () => {
      // Setup
      mockOctokit.rest.pulls.listFiles.mockRejectedValue(new Error('API error'));

      // Execute
      const files = await action.getFilesToScan();

      // Verify
      expect(files).toEqual([]);
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to get files'));
    });

    it('should recover from Gate scanner failure', async () => {
      // Setup
      action.installGate = jest.fn().mockResolvedValue(undefined);

      // Mock spawn to simulate gate not found
      const { spawn } = require('child_process');
      spawn.mockImplementationOnce(() => ({
        stdout: { on: jest.fn() },
        stderr: {
          on: (event, cb) => {
            if (event === 'data') cb('command not found: gate');
          }
        },
        on: (event, cb) => {
          if (event === 'close') cb(1);
        }
      }));

      // Execute
      await action.runGateScanner(['config.js'], {});

      // Verify
      expect(action.installGate).toHaveBeenCalled();
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('installing'));
    });
  });
});
