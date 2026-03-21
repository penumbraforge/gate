const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const https = require('https');

/**
 * Gate GitHub Action v2 — runs Gate CLI and handles GitHub-specific integration.
 * Gate CLI handles all config (.gaterc), ignores (.gateignore), and verification.
 */

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

function severityRank(severity) {
  const rank = SEVERITY_ORDER.indexOf((severity || 'low').toLowerCase());
  return rank === -1 ? SEVERITY_ORDER.length : rank;
}

function meetsThreshold(severity, threshold) {
  return severityRank(severity) <= severityRank(threshold);
}

/**
 * Ensure Gate CLI is installed.
 */
function ensureGateInstalled() {
  try {
    execSync('gate --version', { stdio: 'ignore' });
  } catch {
    core.info('Gate not found — installing @penumbra/gate');
    execSync('npm install -g @penumbra/gate', { stdio: 'inherit' });
    core.info('Gate installed');
  }
}

/**
 * Run a gate scan and return parsed JSON output.
 */
function runGateScan(args) {
  return new Promise((resolve, reject) => {
    const fullArgs = ['scan', '--all', '--format', 'json', ...args];
    core.debug(`Running: gate ${fullArgs.join(' ')}`);

    const proc = spawn('gate', fullArgs, {
      cwd: process.env.GITHUB_WORKSPACE || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', code => {
      // Gate exits 0 (no findings) or 1 (findings found) — both are valid
      if (code === 0 || code === 1) {
        try {
          resolve(JSON.parse(stdout));
        } catch (err) {
          reject(new Error(`Failed to parse Gate JSON output: ${err.message}\nStdout: ${stdout}`));
        }
      } else {
        reject(new Error(`Gate exited with code ${code}\nStderr: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Run gate scan --format sarif and return the SARIF output string.
 */
function runGateScanSarif(extraArgs) {
  return new Promise((resolve, reject) => {
    const fullArgs = ['scan', '--all', '--format', 'sarif', ...extraArgs];
    core.debug(`Running: gate ${fullArgs.join(' ')}`);

    const proc = spawn('gate', fullArgs, {
      cwd: process.env.GITHUB_WORKSPACE || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', code => {
      if (code === 0 || code === 1) {
        resolve(stdout);
      } else {
        reject(new Error(`Gate SARIF scan exited with code ${code}\nStderr: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Upload a SARIF file to GitHub Code Scanning.
 */
async function uploadSarif(sarifContent, octokit, context) {
  const { owner, repo } = context.repo;
  const sarifEncoded = Buffer.from(sarifContent).toString('base64');

  try {
    await octokit.rest.codeScanning.uploadSarif({
      owner,
      repo,
      commit_sha: context.sha,
      ref: context.ref,
      sarif: sarifEncoded,
      tool_name: 'Gate Security Scanner'
    });
    core.info('SARIF uploaded to GitHub Code Scanning');
  } catch (err) {
    core.warning(`Failed to upload SARIF: ${err.message}`);
  }
}

/**
 * Post (or update) a PR comment with scan results.
 */
async function postPRComment(findings, octokit, context) {
  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request.number;

  const criticalCount = findings.filter(f => (f.severity || '').toLowerCase() === 'critical').length;
  const highCount = findings.filter(f => (f.severity || '').toLowerCase() === 'high').length;

  let body = `## Gate Security Scan\n\n`;
  body += `**${findings.length} finding${findings.length !== 1 ? 's' : ''} detected**`;
  if (criticalCount || highCount) {
    body += ` (${criticalCount} critical, ${highCount} high)`;
  }
  body += `\n\n`;

  body += `| File | Line | Finding | Severity |\n`;
  body += `|------|------|---------|----------|\n`;

  for (const f of findings.slice(0, 25)) {
    const file = f.file || '';
    const line = f.line || '';
    const rule = f.rule || f.message || 'Unknown';
    const severity = (f.severity || 'unknown').toLowerCase();
    body += `| \`${file}\` | ${line} | ${rule} | ${severity} |\n`;
  }

  if (findings.length > 25) {
    body += `\n_...and ${findings.length - 25} more findings._\n`;
  }

  body += `\nRun \`gate fix\` to auto-remediate, or \`gate scan --interactive\` for guided walkthrough.\n\n`;
  body += `---\n*[Gate](https://github.com/penumbraforge/gate) — free, open source secret scanner*`;

  // Delete previous Gate comments on this PR
  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner, repo, issue_number: prNumber
    });
    for (const c of comments) {
      if (c.body && c.body.includes('## Gate Security Scan')) {
        await octokit.rest.issues.deleteComment({ owner, repo, comment_id: c.id });
      }
    }
  } catch {
    // Best-effort cleanup
  }

  await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
  core.info('Posted PR comment');
}

/**
 * Send a Slack notification.
 */
function sendSlackNotification(findings, slackWebhook, context) {
  return new Promise((resolve, reject) => {
    const { owner, repo } = context.repo;
    const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;

    const topFindings = findings.slice(0, 5).map(f => `• ${f.file || ''}:${f.line || ''} — ${f.rule || f.message || 'unknown'}`).join('\n');

    const payload = JSON.stringify({
      attachments: [{
        color: '#FF4444',
        title: `Gate Security Alert — ${owner}/${repo}`,
        fields: [
          { title: 'Event', value: context.eventName, short: true },
          { title: 'Actor', value: context.actor, short: true },
          { title: 'Findings', value: String(findings.length), short: true },
          { title: 'Top findings', value: topFindings || 'none', short: false },
          { title: 'Run', value: runUrl, short: false }
        ]
      }]
    });

    const url = new URL(slackWebhook);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      res.on('data', () => {});
      res.on('end', resolve);
    });

    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Slack request timeout')); });
    req.write(payload);
    req.end();
  });
}

/**
 * Main action entry point.
 */
async function run() {
  try {
    const mode = core.getInput('mode') || 'report';
    const verify = core.getInput('verify') === 'true';
    const format = core.getInput('format') || 'text';
    const failOn = core.getInput('fail-on') || 'high';
    const slackWebhook = core.getInput('slack-webhook');
    const githubToken = core.getInput('github-token');

    const context = github.context;
    const octokit = github.getOctokit(githubToken);

    // 1. Ensure Gate CLI is available
    ensureGateInstalled();

    // 2. Build scan args
    const scanArgs = [];
    if (verify) scanArgs.push('--verify');

    // 3. Run scan (always JSON internally for processing)
    core.info('Running Gate scan...');
    const result = await runGateScan(scanArgs);
    const allFindings = result.findings || [];
    core.info(`Gate found ${allFindings.length} total finding(s)`);

    // 4. Filter by severity threshold
    const findings = allFindings.filter(f => meetsThreshold(f.severity, failOn));
    if (findings.length < allFindings.length) {
      core.info(`${allFindings.length - findings.length} finding(s) below '${failOn}' threshold — ignored`);
    }

    // 5. Set outputs
    core.setOutput('findings-count', String(findings.length));
    core.setOutput('blocked', String(findings.length > 0 && mode === 'enforce'));
    core.setOutput('scan-report', JSON.stringify({ findings, timestamp: new Date().toISOString() }));

    // 6. Post PR comment if pull_request event and findings found
    if (context.eventName === 'pull_request' && findings.length > 0) {
      try {
        await postPRComment(findings, octokit, context);
      } catch (err) {
        core.warning(`Failed to post PR comment: ${err.message}`);
      }
    }

    // 7. Send Slack notification if webhook provided and findings found
    if (slackWebhook && findings.length > 0) {
      try {
        await sendSlackNotification(findings, slackWebhook, context);
        core.info('Slack notification sent');
      } catch (err) {
        core.warning(`Failed to send Slack notification: ${err.message}`);
      }
    }

    // 8. SARIF upload if format is sarif
    if (format === 'sarif') {
      try {
        core.info('Running Gate scan in SARIF format for Code Scanning upload...');
        const sarifOutput = await runGateScanSarif(scanArgs);
        await uploadSarif(sarifOutput, octokit, context);
      } catch (err) {
        core.warning(`SARIF upload failed: ${err.message}`);
      }
    }

    // 9. Exit with appropriate code
    if (findings.length === 0) {
      core.info('Gate scan complete — no findings above threshold');
      return;
    }

    const summary = `Gate found ${findings.length} finding(s) at or above '${failOn}' severity`;

    if (mode === 'enforce') {
      core.setFailed(summary);
    } else {
      core.warning(summary);
    }
  } catch (err) {
    core.setFailed(`Gate action error: ${err.message}`);
    core.debug(err.stack);
  }
}

run();
