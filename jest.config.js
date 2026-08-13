module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/infrastructure/**/__tests__/**/*.test.js',
    '<rootDir>/infrastructure/**/*.test.js',
    '<rootDir>/__tests__/**/*.test.js',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/',
  ],
};

