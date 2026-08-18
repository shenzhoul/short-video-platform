// Core app controllers
export { AppController } from '../app.controller';

// Identity controllers
export * from './identity/auth';
export * from './identity/user';
export * from './system';

// Content controllers
export * from './content';

// Community controllers
export { NotificationController } from './community/notification.controller';
export { SocialController } from './community/social.controller';
