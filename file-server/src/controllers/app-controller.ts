import {
  // Core app controllers
  AppController,
  // External API controllers
  FileController,
  // Internal API controllers
  FileInternalController
} from './index';

export const appControllers = [
  // Core app controllers
  AppController,
  // Internal API controllers
  FileInternalController,
  // External API controllers
  FileController
];