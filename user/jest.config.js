const nextJest = require('next/jest');

/**
 * Jest is wired through `next/jest` rather than a hand-built transform.
 *
 * That is the officially supported integration for this Next version: it reuses
 * the same SWC transform the app is compiled with, so JSX, TypeScript and the
 * `next.config.js` settings behave in tests exactly as they do in a build. A
 * separate ts-jest or babel pipeline would be a second, drifting definition of
 * how this code compiles.
 *
 * The api/ project's Jest config is deliberately not reused: it targets a Node
 * runtime for NestJS, while these tests render React against jsdom.
 */
const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/*.{spec,test}.{ts,tsx}'],
  // Mirrors the `paths` in tsconfig.json. Kept explicit so a module resolution
  // failure points at this file rather than at inferred behaviour.
  moduleNameMapper: {
    '^@layouts/(.*)$': '<rootDir>/src/layouts/$1',
    '^@components/(.*)$': '<rootDir>/src/components/$1',
    '^@constants/(.*)$': '<rootDir>/src/constants/$1',
    '^@hooks/(.*)$': '<rootDir>/src/hooks/$1',
    '^@providers/(.*)$': '<rootDir>/src/providers/$1',
    '^@lib/(.*)$': '<rootDir>/src/lib/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@services$': '<rootDir>/src/services',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@interfaces/(.*)$': '<rootDir>/src/interfaces/$1',
    '^src/(.*)$': '<rootDir>/src/$1'
  },
  clearMocks: true
};

module.exports = createJestConfig(config);
