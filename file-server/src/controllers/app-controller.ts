import {
  // Core app controllers
  AppController,
  HealthController,
  // External API controllers
  FileController,
  // Internal API controllers
  FileInternalController
} from './index';

export const appControllers = [
  // Core app controllers
  AppController,
  HealthController,
  // Internal API controllers
  FileInternalController,
  // External API controllers
  FileController
];