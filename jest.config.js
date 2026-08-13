/** @type {import('jest').Config} */
module.exports = {
  // NOTE: coverageThreshold MUST live at the root of a multi-project config —
  // thresholds declared inside projects[] are silently ignored by Jest.
  // Values are set ~2% under the measured coverage so a normal release is not
  // blocked by small fluctuations; regressions larger than that still fail CI.
  coverageThreshold: {
    global: {
      branches: 62,
      functions: 82,
      lines: 78,
      statements: 77,
    },
  },
  projects: [
    {
      displayName: 'cli',
      testEnvironment: 'node',
      setupFilesAfterEnv: ['<rootDir>/test/jest.setup.js'],
      testMatch: [
        '<rootDir>/test/**/*.test.js',
        '<rootDir>/src/cli/__tests__/**/*.test.js',
      ],
      collectCoverageFrom: ['src/cli/**/*.js'],
      coveragePathIgnorePatterns: ['/node_modules/', '/bin/'],
      testTimeout: 10000,
    },
    {
      displayName: 'github-action',
      testEnvironment: 'node',
      setupFilesAfterEnv: ['<rootDir>/test/jest.setup.js'],
      testMatch: ['<rootDir>/github-action/test/**/*.test.js'],
      moduleNameMapper: {
        '^@actions/core$': '<rootDir>/github-action/test/mocks/actions-core.js',
        '^@actions/github$': '<rootDir>/github-action/test/mocks/actions-github.js',
      },
      collectCoverageFrom: ['github-action/action.js'],
      coveragePathIgnorePatterns: ['/node_modules/', '/github-action/dist/'],
      testTimeout: 10000,
    },
  ],
};
