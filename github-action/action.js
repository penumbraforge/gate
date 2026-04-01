const core = require('@actions/core');
const github = require('@actions/github');
const { spawn, execSync } = require('child_process');
const https = require('https');

/**
 * Gate GitHub Action v2 — runs Gate CLI and handles GitHub-specific integration.
 * Gate CLI handles repository config, ignores, findings, and verification.
 */

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const PACKAGE_NAME = '@penumbraforge/gate';

function severityRank(severity) {
  const rank = SEVERITY_ORDER.indexOf((severity || 'low').toLowerCase());
  return rank === -1 ? SEVERITY_ORDER.length : rank;
}

function meetsThreshold(severity, threshold) {
  return severityRank(severity) <= severityRank(threshold);
}

function resolveFailureMode(mode, failureMode) {
  if (failureMode === 'block' || failureMode === 'warn') {
    return failureMode;
  }
  return mode === 'enforce' ? 'block' : 'warn';
}

/**
 * Ensure Gate CLI is installed and available on PATH.
 */
function ensureGateInstalled() {
  try {
    execSync('gate --version', { stdio: 'ignore' });
    return 'gate';
  } catch {
    core.info(`Gate not found — installing ${PACKAGE_NAME}`);
    execSync(`npm install -g ${PACKAGE_NAME}`, { stdio: 'inherit' });
    execSync('gate --version', { stdio: 'ignore' });
    core.info('Gate installed');
    return 'gate';
  }
}

/**
 * Run a gate scan and return parsed JSON output.
 */
function runGateScan(args, gateCmd = 'gate') {
  return new Promise((resolve, reject) => {
    const fullArgs = ['scan', '--all', '--format', 'json', ...args];
    core.debug(`Running: ${gateCmd} ${fullArgs.join(' ')}`);

    const proc = spawn(gateCmd, fullArgs, {
      cwd: process.env.GITHUB_WORKSPACE || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code === 0 || code === 1) {
        try {
          resolve(JSON.parse(stdout));
        } catch (err) {
          reject(new Error(`Failed to parse Gate JSON output: ${err.message}\nStdout: ${stdout}\nStderr: ${stderr}`));
        }
      } else {
        reject(new Error(`Gate exited with code ${code}\nStderr: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Run gate scan --format sarif and return the SARIF payload.
 */
function runGateScanSarif(args, gateCmd = 'gate') {
  return new Promise((resolve, reject) => {
    const fullArgs = ['scan', '--all', '--format', 'sarif', ...args];
    core.debug(`Running: ${gateCmd} ${fullArgs.join(' ')}`);

    const proc = spawn(gateCmd, fullArgs, {
      cwd: process.env.GITHUB_WORKSPACE || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code === 0 || code === 1) {
        resolve(stdout);
      } else {
        reject(new Error(`Gate SARIF scan exited with code ${code}\nStderr: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

async function uploadSarif(sarifContent, octokit, context) {
  if (!octokit) {
    core.warning('Skipping SARIF upload: github-token is not available');
    return;
  }

  const { owner, repo } = context.repo;
  const sarifEncoded = Buffer.from(sarifContent).toString('base64');

  try {
    await octokit.rest.codeScanning.uploadSarif({
      owner,
      repo,
      commit_sha: context.sha,
      ref: context.ref,
      sarif: sarifEncoded,
      tool_name: 'Gate Security Scanner',
    });
    core.info('SARIF uploaded to GitHub Code Scanning');
  } catch (err) {
    core.warning(`Failed to upload SARIF: ${err.message}`);
  }
}

async function postPRComment(findings, octokit, context) {
  if (!octokit) {
    core.warning('Skipping PR comment: github-token is not available');
    return;
  }

  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request.number;

  const criticalCount = findings.filter((finding) => (finding.severity || '').toLowerCase() === 'critical').length;
  const highCount = findings.filter((finding) => (finding.severity || '').toLowerCase() === 'high').length;

  let body = '## Gate Security Scan\n\n';
  body += `**${findings.length} finding${findings.length !== 1 ? 's' : ''} detected**`;
  if (criticalCount || highCount) {
    body += ` (${criticalCount} critical, ${highCount} high)`;
  }
  body += '\n\n';
  body += '| File | Line | Finding | Severity |\n';
  body += '|------|------|---------|----------|\n';

  for (const finding of findings.slice(0, 25)) {
    const file = finding.file || '';
    const line = finding.line || finding.lineNumber || '';
    const rule = finding.ruleName || finding.ruleId || finding.rule || finding.message || 'Unknown';
    const severity = (finding.severity || 'unknown').toLowerCase();
    body += `| \`${file}\` | ${line} | ${rule} | ${severity} |\n`;
  }

  if (findings.length > 25) {
    body += `\n_...and ${findings.length - 25} more findings._\n`;
  }

  body += '\nRun `gate fix` to auto-remediate, or `gate scan --interactive` for guided walkthrough.\n\n';
  body += '---\n*[Gate](https://github.com/penumbraforge/gate) — free, open source secret scanner*';

  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });
    for (const comment of comments) {
      if (comment.body && comment.body.includes('## Gate Security Scan')) {
        await octokit.rest.issues.deleteComment({ owner, repo, comment_id: comment.id });
      }
    }
  } catch {
    // Best effort cleanup.
  }

  await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
  core.info('Posted PR comment');
}

function sendSlackNotification(findings, slackWebhook, context) {
  return new Promise((resolve, reject) => {
    const { owner, repo } = context.repo;
    const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;

    const topFindings = findings
      .slice(0, 5)
      .map((finding) => {
        const line = finding.line || finding.lineNumber || '';
        const label = finding.ruleName || finding.ruleId || finding.rule || finding.message || 'unknown';
        return `• ${finding.file || ''}:${line} — ${label}`;
      })
      .join('\n');

    const payload = JSON.stringify({
      attachments: [{
        color: '#FF4444',
        title: `Gate Security Alert — ${owner}/${repo}`,
        fields: [
          { title: 'Event', value: context.eventName, short: true },
          { title: 'Actor', value: context.actor, short: true },
          { title: 'Findings', value: String(findings.length), short: true },
          { title: 'Top findings', value: topFindings || 'none', short: false },
          { title: 'Run', value: runUrl, short: false },
        ],
      }],
    });

    const url = new URL(slackWebhook);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      res.on('data', () => {});
      res.on('end', resolve);
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Slack request timeout'));
    });
    req.write(payload);
    req.end();
  });
}

async function run() {
  try {
    const mode = core.getInput('mode') || 'report';
    const verify = core.getInput('verify') === 'true';
    const format = core.getInput('format') || 'text';
    const failOn = core.getInput('fail-on') || 'high';
    const slackWebhook = core.getInput('slack-webhook');
    const githubToken = core.getInput('github-token');
    const failureMode = resolveFailureMode(mode, core.getInput('failure-mode'));

    const context = github.context;
    const octokit = githubToken ? github.getOctokit(githubToken) : null;

    const gateCmd = ensureGateInstalled();

    const scanArgs = [];
    if (verify) scanArgs.push('--verify');

    core.info('Running Gate scan...');
    const result = await runGateScan(scanArgs, gateCmd);

    const allFindings = Array.isArray(result.findings) ? result.findings : [];
    const filteredFindings = allFindings.filter((finding) => meetsThreshold(finding.severity, failOn));
    const scanErrorCount = Number(result.summary && result.summary.errors) || 0;
    const scanReport = {
      findings: filteredFindings,
      errors: result.errors || [],
      skipped: result.skipped || [],
      summary: result.summary || {},
      timestamp: result.timestamp || new Date().toISOString(),
    };

    core.info(`Gate found ${allFindings.length} total finding(s)`);
    if (filteredFindings.length < allFindings.length) {
      core.info(`${allFindings.length - filteredFindings.length} finding(s) below '${failOn}' threshold — ignored`);
    }

    core.setOutput('findings-count', String(filteredFindings.length));
    core.setOutput('blocked', String(filteredFindings.length > 0 && failureMode === 'block'));
    core.setOutput('scan-report', JSON.stringify(scanReport));

    if (scanErrorCount > 0) {
      const summary = `Gate scan incomplete: ${scanErrorCount} file(s) could not be scanned`;
      if (failureMode === 'block') {
        core.setFailed(summary);
      } else {
        core.warning(summary);
      }
      return;
    }

    if (context.eventName === 'pull_request' && filteredFindings.length > 0) {
      try {
        await postPRComment(filteredFindings, octokit, context);
      } catch (err) {
        core.warning(`Failed to post PR comment: ${err.message}`);
      }
    }

    if (slackWebhook && filteredFindings.length > 0) {
      try {
        await sendSlackNotification(filteredFindings, slackWebhook, context);
        core.info('Slack notification sent');
      } catch (err) {
        core.warning(`Failed to send Slack notification: ${err.message}`);
      }
    }

    if (format === 'sarif') {
      try {
        core.info('Running Gate scan in SARIF format for Code Scanning upload...');
        const sarifOutput = await runGateScanSarif(scanArgs, gateCmd);
        await uploadSarif(sarifOutput, octokit, context);
      } catch (err) {
        core.warning(`SARIF upload failed: ${err.message}`);
      }
    }

    if (filteredFindings.length === 0) {
      core.info('Gate scan complete — no findings above threshold');
      return;
    }

    const summary = `Gate found ${filteredFindings.length} finding(s) at or above '${failOn}' severity`;
    if (failureMode === 'block') {
      core.setFailed(summary);
    } else {
      core.warning(summary);
    }
  } catch (err) {
    core.setFailed(`Gate action error: ${err.message}`);
    core.debug(err.stack || String(err));
  }
}

module.exports = {
  severityRank,
  meetsThreshold,
  resolveFailureMode,
  ensureGateInstalled,
  runGateScan,
  runGateScanSarif,
  uploadSarif,
  postPRComment,
  sendSlackNotification,
  run,
};

if (require.main === module) {
  run();
}
