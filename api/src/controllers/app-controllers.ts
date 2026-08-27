import { IdentityFileController } from 'src/controllers/identity/identity-file.controller';
import {
  AdminPermissionController,
  AdminUserController,
  AppController,
  AdminAuthController,
  LoginController,
  LogoutController,
  RegisterController,
  AdminSettingController,
  SettingController,
  SettingFileUploadController,
  UserController,
  CreatorPostController,
  UserPostController,
  SearchController,
  AdminCategoryController,
  SocialController,
  NotificationController,
  ConversationController,
  MessageController,
  UserRelationshipController
} from './index';
import { AdminAvatarController } from 'src/controllers/identity/user/admin-avatar.controller';
import { ContentFileController } from 'src/controllers/content/content-file.controller';

export const appControllers = [
  // Core app controllers
  AppController,

  // auth
  LoginController,
  LogoutController,
  RegisterController,
  // Admin password change. Written, guarded and exported, but never listed here
  // until 2026-08-26 — so `PUT /admin/auth/user/password` answered 404 and the
  // only way to reset an administrator's password was a script on the server.
  // A controller that compiles and is exported still does not exist as a route.
  AdminAuthController,

  // users
  UserController,
  AdminUserController,
  AdminPermissionController,
  AdminAvatarController,

  // settings
  SettingController,
  AdminSettingController,
  SettingFileUploadController,

  // post
  CreatorPostController,
  UserPostController,

  // search
  SearchController,

  // post categories
  AdminCategoryController,

  // file
  IdentityFileController,
  ContentFileController,

  // comment & community
  SocialController,
  NotificationController,

  // direct messages
  ConversationController,
  MessageController,

  // block / restrict
  UserRelationshipController
]
