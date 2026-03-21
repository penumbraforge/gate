# Development Guide

This guide is for developers contributing to the Gate GitHub Action.

## Setup

### Prerequisites

- Node.js 20+
- npm 9+
- Git
- GitHub CLI (optional but useful)

### Installation

```bash
git clone https://github.com/penumbra/gate-github-action.git
cd gate-github-action
npm install
```

## Project Structure

```
.
├── action.js                 # Main action logic
├── action.yml              # GitHub Action definition
├── package.json            # Dependencies
├── test/
│   └── action.test.js     # Jest tests
├── examples/
│   ├── .gate.json         # Example config
│   ├── .gate-allowlist.json # Example allowlist
│   └── gate-*.yml         # Example workflows
├── docs/
│   ├── README.md          # User guide
│   ├── CONFIGURATION.md   # Configuration guide
│   ├── TROUBLESHOOTING.md # Troubleshooting
│   ├── SECURITY.md        # Security info
│   └── DEVELOPMENT.md     # This file
└── LICENSE               # MIT License
```

## Development Tasks

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode (auto-rerun on changes)
npm run test:watch

# Run specific test
npm test -- --testNamePattern="PR Comments"
```

### Code Style

```bash
# Lint code
npm run lint

# Format code
npm run format

# Check for issues
npm run lint -- --fix
```

## Architecture

### Main Components

**`action.js`** - Core action logic:
- `GateAction` class: Main orchestrator
- Methods:
  - `run()` - Entry point
  - `loadRepoConfig()` - Load `.gate.json`
  - `verifyLicense()` - Check license status
  - `getFilesToScan()` - Determine files to scan
  - `runGateScanner()` - Execute Gate CLI
  - `postPRComment()` - Post findings to PR
  - `sendSlackNotification()` - Send Slack alert
  - `handleFindings()` - Process results
  - `handleError()` - Error handling

**`action.yml`** - Action definition:
- Inputs: mode, slack-webhook, failure-mode, rules-version
- Outputs: findings-count, blocked, scan-report
- Branding: icon, color

### Data Flow

```
GitHub Event (PR/Push)
    ↓
Load Config (.gate.json)
    ↓
Verify License
    ↓
Get Files to Scan
    ↓
Run Gate Scanner
    ↓
Filter Allowlist
    ↓
Detect Bypass
    ↓
Post Audit Log
    ↓
Post PR Comment (if PR)
    ↓
Send Slack (if findings)
    ↓
Handle Findings (block/warn)
```

### Error Handling Strategy

**Fail Closed** (block for safety):
- Rules file corrupted
- Critical security issues

**Fail Open** (don't block):
- Gate scanner crashes
- GitHub API unavailable
- Network timeouts
- License check fails

**Configurable**:
- Via `failure-mode`: `block` or `warn`
- Via `mode`: `enforce` or `report`

## Testing

### Unit Tests

Located in `test/action.test.js`

Test categories:
- Initialization
- Configuration loading
- License verification
- File scanning
- Gate execution
- PR comments
- Slack notifications
- Findings handling
- Error handling
- Audit logging

### Running Tests

```bash
# All tests
npm test

# Coverage report
npm run test:coverage

# Specific suite
npm test -- --testNamePattern="PR Comments"

# Verbose output
npm test -- --verbose
```

### Mocking

Uses Jest mocks for:
- `@actions/core` - Logging and outputs
- `@actions/github` - GitHub API
- `fs` - File system
- `child_process` - Gate execution
- `https` - License and Slack APIs

### Test Examples

```javascript
// Test finding files for PR
it('should get PR files for pull_request event', async () => {
  mockOctokit.rest.pulls.listFiles.mockResolvedValue({
    data: [
      { filename: 'src/index.js' },
      { filename: 'config.json' }
    ]
  });

  const files = await action.getFilesToScan();
  
  expect(files).toEqual(['src/index.js', 'config.json']);
});
```

## Adding Features

### New Input

1. Add to `action.yml`:
```yaml
inputs:
  new-input:
    description: 'Description'
    required: false
    default: 'value'
```

2. Read in `action.js`:
```javascript
this.newInput = core.getInput('new-input');
```

3. Add tests:
```javascript
it('should use new input', () => {
  expect(action.newInput).toBe('value');
});
```

### New Feature

Example: Add custom reporter

1. Create method in `GateAction`:
```javascript
async sendCustomReport() {
  // Implementation
}
```

2. Call from `run()`:
```javascript
await this.sendCustomReport();
```

3. Add tests:
```javascript
it('should send custom report', async () => {
  // Test implementation
});
```

4. Update documentation

## GitHub Actions Toolkit

### Common APIs Used

**Logging:**
```javascript
core.info('Info message');
core.warning('Warning message');
core.error('Error message');
core.debug('Debug message');
```

**Outputs:**
```javascript
core.setOutput('name', 'value');
```

**Errors:**
```javascript
core.setFailed('Error message');
```

**Environment:**
```javascript
const token = core.getInput('github-token');
const actor = github.context.actor;
```

### GitHub API

**Using Octokit:**
```javascript
const octokit = github.getOctokit(token);

// List PR files
octokit.rest.pulls.listFiles({
  owner, repo, pull_number
});

// Create comment
octokit.rest.issues.createComment({
  owner, repo, issue_number, body
});
```

## Debugging

### Local Testing

```bash
# Run action locally (via Docker)
act -e .

# With specific event
act pull_request

# With secrets
act -s SLACK_WEBHOOK=https://...
```

### Debug Logging

Enable debug output:
```yaml
env:
  RUNNER_DEBUG: true
```

In code:
```javascript
core.debug('Debug message');
```

## Release Process

### Version Bumping

```bash
npm version patch  # 1.0.0 → 1.0.1
npm version minor  # 1.0.0 → 1.1.0
npm version major  # 1.0.0 → 2.0.0
```

### Publishing

1. Update version: `npm version patch`
2. Build: `npm run build`
3. Commit and tag: Git handles this
4. Push: `git push && git push --tags`
5. Create release on GitHub
6. Update GitHub Actions Marketplace (if published)

### Version Tags

Maintain version tags:
- `v1` - Latest v1 release
- `v1.0.0` - Specific version
- `main` - Development version (not recommended for users)

```bash
git tag -d v1
git tag v1
git push origin v1 --force
```

## Performance Optimization

### Benchmarking

```bash
# Measure execution time
time npm test

# Profile with Node
node --prof action.js
node --prof-process isolate-*.log > profile.txt
```

### Common Optimizations

1. **Reduce API calls**
   - Batch GitHub API requests
   - Cache license checks

2. **Optimize file scanning**
   - Exclude node_modules, .git
   - Use glob patterns efficiently

3. **Parallel processing**
   - Process files concurrently
   - Match rules in parallel

4. **Memory efficiency**
   - Stream large files
   - Clean up after operations

## Security Development

### Code Review Checklist

- [ ] No hardcoded secrets
- [ ] Input validation
- [ ] Error messages don't leak info
- [ ] Proper permission usage
- [ ] Dependencies up-to-date
- [ ] No arbitrary code execution
- [ ] Secure API calls (HTTPS, timeouts)

### Dependency Management

```bash
# Check for vulnerabilities
npm audit

# Fix vulnerabilities
npm audit fix

# List outdated packages
npm outdated

# Update dependencies
npm update
```

### Secrets Handling

Never:
- Log secrets
- Pass to untrusted services
- Store in config files
- Commit to repository

Safe to log:
- Finding metadata (filename, rule name)
- Counts and statistics
- Audit trails

## Documentation

### Update Locations

When making changes:

1. **Code changes** → Update action.js
2. **Input changes** → Update action.yml AND README.md
3. **Configuration** → Update CONFIGURATION.md
4. **Issues found** → Update TROUBLESHOOTING.md
5. **Security info** → Update SECURITY.md
6. **Setup** → Update DEVELOPMENT.md

### Documentation Standards

- Clear headings
- Code examples
- Troubleshooting sections
- Links to related docs
- Maintain table of contents

## Contributing

### Pull Request Process

1. Fork repository
2. Create feature branch: `git checkout -b feature/name`
3. Make changes
4. Add tests: `npm test`
5. Update docs
6. Lint code: `npm run lint`
7. Format code: `npm run format`
8. Commit with clear message
9. Push and create PR
10. Address review feedback
11. Merge when approved

### Commit Message Format

```
type(scope): description

- Change detail 1
- Change detail 2

Fixes #123
```

Types:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `test` - Tests
- `refactor` - Code refactor
- `perf` - Performance
- `ci` - CI/CD changes

## Roadmap

Potential future features:
- [ ] Custom rule support
- [ ] Database backend for audit logs
- [ ] Web dashboard for audit logs
- [ ] Automated remediation
- [ ] Advanced filtering
- [ ] Team management UI
- [ ] Scheduled scanning
- [ ] Cost tracking/analytics

## Support

### Getting Help

- 📚 [Gate Docs](https://gate.penumbraforge.com/docs)
- 🐛 [GitHub Issues](https://github.com/penumbra/gate/issues)
- 💬 [Slack Community](https://github.com/penumbra/gate/discussions)
- 📧 Email: dev@penumbraforge.com

### Reporting Bugs

Include:
- Minimal reproduction
- Error message (full)
- Environment (OS, Node version)
- Gate version
- Recent changes

### Feature Requests

Discuss in issues first; include:
- Use case
- Expected behavior
- Current workarounds
- Priority level

## License

MIT - See LICENSE file
