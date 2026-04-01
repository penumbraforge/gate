/** @type {import('jest').Config} */
module.exports = {
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
      coverageThreshold: {
        global: {
          branches: 70,
          functions: 70,
          lines: 75,
          statements: 75,
        },
        './src/cli/rules.js': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        './src/cli/scanner.js': {
          branches: 75,
          functions: 75,
          lines: 80,
          statements: 80,
        },
      },
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
      coveragePathIgnorePatterns: ['/node_modules/'],
      testTimeout: 10000,
    },
  ],
};
