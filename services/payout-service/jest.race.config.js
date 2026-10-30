// Real-Postgres race specs. Not part of `npm test`: they need RACE_DATABASE_URL (see test/race/db.ts).
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/test/race'],
  testRegex: '.*\\.race\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testTimeout: 120000,
  testEnvironment: 'node',
};
