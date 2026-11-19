/**
 * Imported FIRST by http.spec.ts. ConfigModule.forRoot() reads and validates the environment
 * when app.module is imported, not when the test module compiles — values set in a
 * `beforeAll` arrive too late and the repo's own .env answers instead.
 */
export const TEST_KEY = 'face-service-test-key-0123456789abcdef';
process.env.NODE_ENV = 'production'; // no pino-pretty worker thread in tests
process.env.INTERNAL_SERVICE_KEY = TEST_KEY;
