import { IdentityFileController } from 'src/controllers/identity/identity-file.controller';
import {
  AdminPermissionController,
  AdminUserController,
  AppController,
  LoginController,
  LogoutController,
  AdminSettingController,
  SettingController,
  SettingFileUploadController,
  UserController,
  CreatorPostController,
  UserPostController,
  SearchController,
  SocialController,
  NotificationController
} from './index';
import { AdminAvatarController } from 'src/controllers/identity/user/admin-avatar.controller';
import { ContentFileController } from 'src/controllers/content/content-file.controller';

export const appControllers = [
  // Core app controllers
  AppController,

  // auth
  LoginController,
  LogoutController,

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

  // file
  IdentityFileController,
  ContentFileController,

  // comment & community
  SocialController,
  NotificationController
]
