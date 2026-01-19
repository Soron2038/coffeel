module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js', // Exclude server entry point from coverage
  ],
  testMatch: ['**/tests/**/*.test.js'],
  coverageThreshold: {
    global: {
      branches: 25,
      functions: 30,
      lines: 35,
      statements: 35,
    },
  },
};
