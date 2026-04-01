'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function isWritableOrCreatable(targetPath) {
  let currentPath = path.resolve(targetPath);

  while (!fs.existsSync(currentPath)) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return false;
    }
    currentPath = parentPath;
  }

  try {
    fs.accessSync(currentPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function getFallbackGateHome() {
  const cwdGateHome = path.join(process.cwd(), '.gate');
  if (isWritableOrCreatable(cwdGateHome)) {
    return cwdGateHome;
  }

  const cwdHash = crypto.createHash('sha256')
    .update(process.cwd())
    .digest('hex')
    .slice(0, 16);

  return path.join(os.tmpdir(), 'gate-state', cwdHash);
}

function getGateHome() {
  if (process.env.GATE_HOME && process.env.GATE_HOME.trim()) {
    return path.resolve(process.env.GATE_HOME);
  }

  const preferredHome = path.join(os.homedir(), '.gate');
  if (isWritableOrCreatable(preferredHome)) {
    return preferredHome;
  }

  return getFallbackGateHome();
}

function getGatePath(...segments) {
  return path.join(getGateHome(), ...segments);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // Best effort on platforms/filesystems that do not support chmod.
  }
  return dirPath;
}

function ensureGateHome() {
  return ensureDir(getGateHome());
}

module.exports = {
  getGateHome,
  getGatePath,
  ensureDir,
  ensureGateHome,
  isWritableOrCreatable,
  getFallbackGateHome,
};
