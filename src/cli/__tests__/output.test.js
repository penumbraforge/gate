describe('output', () => {
  let output;

  beforeEach(() => {
    jest.resetModules();
    output = require('../output');
  });

  test('formatSeverity returns correct labels', () => {
    expect(output.formatSeverity('critical', false)).toBe('CRITICAL');
    expect(output.formatSeverity('high', false)).toBe('HIGH');
    expect(output.formatSeverity('medium', false)).toBe('MEDIUM');
    expect(output.formatSeverity('low', false)).toBe('LOW');
  });

  test('formatSeverity with color wraps in ANSI codes', () => {
    const result = output.formatSeverity('critical', true);
    expect(result).toContain('\x1b[');
    expect(result).toContain('CRITICAL');
  });

  test('formatCodeContext shows surrounding lines', () => {
    const lines = ['line 1', 'line 2', 'const key = "secret"', 'line 4', 'line 5'];
    const result = output.formatCodeContext(lines, 3, 2, false);
    expect(result).toContain('line 2');
    expect(result).toContain('const key = "secret"');
    expect(result).toContain('line 4');
  });

  test('formatFinding produces complete finding block', () => {
    const finding = {
      ruleId: 'stripe-live-secret',
      ruleName: 'Stripe Live Secret Key',
      severity: 'critical',
      lineNumber: 12,
      match: 'sk_live_00000000000000000000000000',
      file: 'src/config.js',
    };
    const fileLines = ['', '', '', '', '', '', '', '', '', '',
      'const stripe = require("stripe");',
      'const key = "sk_live_00000000000000000000000000";',
      '',
    ];
    const result = output.formatFinding(finding, fileLines, { color: false, context_lines: 2 });
    expect(result).toContain('src/config.js:12');
    expect(result).toContain('Stripe Live Secret Key');
    expect(result).toContain('CRITICAL');
  });

  test('formatSummary shows counts and next steps', () => {
    const counts = { critical: 1, high: 1, medium: 0, low: 0, total: 2 };
    const result = output.formatSummary(counts, false);
    expect(result).toContain('1 critical');
    expect(result).toContain('1 high');
    expect(result).toContain('gate fix');
  });

  test('formatSummary shows clean message when no findings', () => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
    const result = output.formatSummary(counts, false);
    expect(result).toContain('no secrets found');
  });

  test('shouldUseColor respects NO_COLOR env', () => {
    const orig = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    expect(output.shouldUseColor('auto')).toBe(false);
    if (orig === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = orig;
  });

  test('shouldUseColor respects explicit true/false', () => {
    expect(output.shouldUseColor(true)).toBe(true);
    expect(output.shouldUseColor(false)).toBe(false);
  });

  test('formatForCI generates GitHub Actions annotations', () => {
    const finding = {
      file: 'src/config.js',
      lineNumber: 12,
      ruleName: 'Stripe Live Secret Key',
      severity: 'critical',
    };
    const result = output.formatForCI(finding, 'github-actions');
    expect(result).toContain('::error file=src/config.js,line=12');
  });

  test('detectCI identifies CI environments', () => {
    const orig = process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS = 'true';
    expect(output.detectCI()).toBe('github-actions');
    if (orig === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = orig;
  });

  test('formatHeader renders gate banner', () => {
    const result = output.formatHeader(2, false);
    expect(result).toContain('gate');
    expect(result).toContain('2 secrets found');
  });
});

describe('createSpinner', () => {
  const { createSpinner } = require('../output');

  test('exports createSpinner function', () => {
    expect(typeof createSpinner).toBe('function');
  });

  test('returns object with start, update, succeed, fail, stop methods', () => {
    const spinner = createSpinner({ stream: { isTTY: false, write: () => {} } });
    expect(typeof spinner.start).toBe('function');
    expect(typeof spinner.update).toBe('function');
    expect(typeof spinner.succeed).toBe('function');
    expect(typeof spinner.fail).toBe('function');
    expect(typeof spinner.stop).toBe('function');
  });

  test('succeed outputs checkmark and message on non-TTY', () => {
    const output = [];
    const mockStream = { isTTY: false, write: (s) => output.push(s) };
    const spinner = createSpinner({ stream: mockStream });
    spinner.succeed('Done in 1.2s');
    expect(output.join('')).toContain('Done in 1.2s');
  });

  test('start outputs text once on non-TTY', () => {
    const output = [];
    const mockStream = { isTTY: false, write: (s) => output.push(s) };
    const spinner = createSpinner({ stream: mockStream });
    spinner.start('Loading...');
    expect(output.length).toBe(1);
    expect(output[0]).toContain('Loading...');
    spinner.stop();
  });

  test('fail outputs cross mark and message on non-TTY', () => {
    const output = [];
    const mockStream = { isTTY: false, write: (s) => output.push(s) };
    const spinner = createSpinner({ stream: mockStream });
    spinner.fail('Something went wrong');
    expect(output.join('')).toContain('Something went wrong');
  });

  test('stop clears interval without error', () => {
    const mockStream = { isTTY: false, write: () => {} };
    const spinner = createSpinner({ stream: mockStream });
    spinner.start('Test');
    spinner.stop();
    // Should not throw
  });

  test('update changes current text without writing on non-TTY', () => {
    const output = [];
    const mockStream = { isTTY: false, write: (s) => output.push(s) };
    const spinner = createSpinner({ stream: mockStream });
    spinner.start('First');
    const countAfterStart = output.length;
    spinner.update('Second');
    // update should not produce additional output on non-TTY
    expect(output.length).toBe(countAfterStart);
    spinner.stop();
  });

  test('TTY mode renders spinner frames', () => {
    jest.useFakeTimers();
    const output = [];
    const mockStream = { isTTY: true, write: (s) => output.push(s) };
    const spinner = createSpinner({ stream: mockStream });
    spinner.start('Working...');
    // Initial render writes something
    expect(output.length).toBeGreaterThan(0);
    expect(output.join('')).toContain('Working...');
    // Advance timer to trigger another frame
    jest.advanceTimersByTime(80);
    const countAfterTick = output.length;
    expect(countAfterTick).toBeGreaterThan(1);
    spinner.stop();
    jest.useRealTimers();
  });
});
