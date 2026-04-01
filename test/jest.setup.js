'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function createGateHomePath() {
  const testName = (expect.getState().currentTestName || 'gate-test')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return path.join(
    os.tmpdir(),
    'gate-jest-home',
    String(process.pid),
    `${Date.now()}-${Math.random().toString(16).slice(2)}-${testName}`
  );
}

beforeEach(() => {
  const gateHome = createGateHomePath();
  fs.rmSync(gateHome, { recursive: true, force: true });
  fs.mkdirSync(gateHome, { recursive: true });
  process.env.GATE_HOME = gateHome;
});

afterEach(() => {
  if (process.env.GATE_HOME) {
    fs.rmSync(process.env.GATE_HOME, { recursive: true, force: true });
  }
  delete process.env.GATE_HOME;
});
