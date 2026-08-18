import { STORAGE_TYPES } from "src/common/constants/content";

export interface IFileUploadResponse {
  /**
   * path or location (full url of s3)
   */
  path: string;

  /**
   * absolute path to the file or s3 key file
   */
  absolutePath: string;

  key?: string;

  acl?: string;

  storageType: typeof STORAGE_TYPES[keyof typeof STORAGE_TYPES];

  metadata?: Record<string, any>;
}

export interface IDeleteFileResponse {
  success: boolean;

  message?: string;

  error?: any;

  // Additional fields for batch operations
  deletedCount?: number;

  skippedCount?: number;

  errors?: string[];
}

export interface IDeleteFilesOptions {
  keys: string[];
  storageType: typeof STORAGE_TYPES[keyof typeof STORAGE_TYPES];
}

export interface IFileUpload {
  /**
   * absolute path to write
   */
  fromFile?: string;

  /**
   * base url path such as avatars, images, etc...
   */
  basePath?: string;

  /**
   * provide file name to be saved, if key is not provided, default path is base path + fileName
   */
  fileName?: string;

  /**
   * path to the file without public folder or s3 key
   */
  key: string;

  /**
   * original path
   */
  filePath?: string;

  /**
   * body if path is not provided
   */
  body?: Buffer | any;

  contentType?: string;

  acl?: string;

  /**
   * rename/move file option, apply to disk storage
   */
  rename?: boolean;

  deleteOriginalFile?: boolean;

  storageType?: typeof STORAGE_TYPES[keyof typeof STORAGE_TYPES];
}

export interface IGetFileUrlOptions {
  authenticated?: boolean;
  expiresIn?: number;
  bucket?: string;
  storageType?: typeof STORAGE_TYPES[keyof typeof STORAGE_TYPES] | string;
  /**
   * option to force download
   */
  download?: boolean;
  // ip to compare and verify
  ip?: string;
}