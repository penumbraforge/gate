/**
 * Lightweight logger with level-based filtering.
 * Reads LOG_LEVEL from env: 'silent' | 'error' | 'warn' | 'info' | 'debug'
 * Default: 'error' in production, 'info' in development.
 *
 * CLI files (bin/gate.js, src/cli/*) should NOT use this logger —
 * they print directly to console for user interaction.
 */

type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function getLevel(): LogLevel {
  const env = process.env.LOG_LEVEL as LogLevel | undefined;
  if (env && env in LEVEL_PRIORITY) return env;
  return (process.env.NODE_ENV || 'development') === 'production' ? 'error' : 'info';
}

function shouldLog(msgLevel: LogLevel): boolean {
  return LEVEL_PRIORITY[msgLevel] <= LEVEL_PRIORITY[getLevel()];
}

export const logger = {
  error(...args: unknown[]) {
    if (shouldLog('error')) console.error(...args);
  },
  warn(...args: unknown[]) {
    if (shouldLog('warn')) console.warn(...args);
  },
  info(...args: unknown[]) {
    if (shouldLog('info')) console.log(...args);
  },
  debug(...args: unknown[]) {
    if (shouldLog('debug')) console.debug(...args);
  },
};
