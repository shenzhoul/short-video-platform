import { Injectable } from "@nestjs/common";
import { IDeleteFileResponse, IFileUpload, IFileUploadResponse, IGetFileUrlOptions } from "src/common/interfaces/file";
import { appConfig, fileConfig } from "src/config";
import { ObjectId } from 'mongodb';
import { AbstractStorage } from './abstract-storage'
import { fromPosixPath, getFilePath, isUrl, toPosixPath } from "src/kernel/helpers/string.helper";
import * as jwt from 'jsonwebtoken';
import * as mkdirp from 'mkdirp';
import { dirname, join, normalize, resolve } from "path";
import { copyFileSync, cpSync, existsSync, promises as fsPromises, renameSync, unlinkSync, writeFileSync } from "fs";
import { STORAGE_TYPES } from "src/common/constants/content";
import { uniq } from "lodash";

/**
 * JWT use for hash / check auth for file, we can random this value
 * TODO - move to env variable
 */
export const JWT_FILE_SECRET = process.env.JWT_SECRET || 'ClwCF8oSDST5PLMVtjKOed5wNouDJ8JP';

export interface IGetSignedUrlOptions {
  source?: string;
  authenticated?: boolean;
  expiresIn?: number;
  fileId?: string | ObjectId;
  filePath?: string;
  ip?: string;
  excludeHash?: boolean;
}

const encryptJwt = (options: IGetSignedUrlOptions) => {
  const {
    fileId = undefined,
    filePath = '',
    expiresIn = 60 * 60,
    ip = ''
  } = options || {};

  return jwt.sign(
    {
      fileId,
      filePath,
      ip
    },
    JWT_FILE_SECRET,
    { expiresIn }
  );
};

export const generateSignedUrlFromPath = (filePath: string, options?: IGetSignedUrlOptions) => {
  const {
    source = 'local',
    excludeHash = false,
    fileId,
    expiresIn = 60 * 60
  } = options || {};
  const baseUrl = process.env.FILE_BASE_URL || process.env.BASE_URL || appConfig.baseUrl;
  if (source === 'local') {
    const newUrl = isUrl(filePath) ? new URL(filePath) : new URL(filePath, baseUrl);

    if (!excludeHash) {
      const hash = encryptJwt({
        fileId,
        filePath,
        expiresIn,
        ...(options || {})
      });
      newUrl.searchParams.delete('hash');
      newUrl.searchParams.append('hash', hash);
      // Add expiresIn to URL parameters for cache service to read
      newUrl.searchParams.delete('expiresIn');
      newUrl.searchParams.append('expiresIn', expiresIn.toString());
    }

    return {
      url: newUrl.href
    };
  }

  return {
    url: (isUrl(filePath) ? new URL(filePath) : new URL(filePath, baseUrl)).href
  };
};

@Injectable()
export class DiskStorageService implements AbstractStorage {
  public async writeFile({
    fromFile,
    basePath,
    fileName,
    key,
    acl = 'public-read',
    body,
    rename = false,
    deleteOriginalFile = false
  }: IFileUpload): Promise<IFileUploadResponse> {
    const publicDir = this.resolvePublicDir();
    let fromAbsolutePath = fromFile;
    if (!body && !fromFile) fromAbsolutePath = join(basePath, fileName);
    const writeToFile = join(publicDir, key);
    const writeToDir = getFilePath(writeToFile);
    const hasSourceFile = !body && !!fromAbsolutePath;
    const isSameLocation = hasSourceFile
      ? this.pathsReferToSameLocation(fromAbsolutePath, writeToFile)
      : false;
    if (!existsSync(writeToDir)) mkdirp.sync(writeToDir); // create output dir, it is require to write file

    if (!body && !existsSync(fromAbsolutePath)) throw new Error(`File not found ${fromAbsolutePath}`);

    if (body) {
      // Write to a sibling temp file first to avoid overwriting a file that was
      // just read by Sharp/libvips on Windows.
      const tempWriteToFile = `${writeToFile}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(tempWriteToFile, body);
      await this.replaceFileWithRetry(tempWriteToFile, writeToFile);
    } else if (isSameLocation) {
      // Queued processing can hand back the final file path; avoid self-moves
      // because the old rename/unlink flow deleted the media in place.
    } else if (rename) {
      this.moveFileWithCrossDeviceFallback(fromAbsolutePath, writeToFile);
    } else {
      // copy file from original to new path
      cpSync(fromAbsolutePath, writeToFile);
    }

    const shouldDeleteOriginal = (deleteOriginalFile || rename) && hasSourceFile && !isSameLocation;
    if (shouldDeleteOriginal && existsSync(fromAbsolutePath)) unlinkSync(fromAbsolutePath);

    return {
      path: toPosixPath(key),
      absolutePath: toPosixPath(writeToFile),
      acl,
      key,
      storageType: STORAGE_TYPES.DISK_STORAGE
    };
  }

  async getFileUrl(key: string, options?: IGetFileUrlOptions): Promise<string> {
    const {
      authenticated,
      expiresIn,
      ip
    } = options || {};

    const baseUrl = process.env.FILE_BASE_URL || appConfig.baseUrl;
    if (!authenticated) return new URL(key, baseUrl).href;

    // generate jwt and verify url
    return generateSignedUrlFromPath(key, {
      expiresIn,
      ip
    }).url;
  }

  private moveFileWithCrossDeviceFallback(fromAbsolutePath: string, writeToFile: string): void {
    try {
      renameSync(fromAbsolutePath, writeToFile);
    } catch (error) {
      if (!this.isCrossDeviceRenameError(error)) {
        throw error;
      }

      // Docker bind mounts can place temp and public directories on different devices.
      copyFileSync(fromAbsolutePath, writeToFile);
    }
  }

  private async replaceFileWithRetry(fromAbsolutePath: string, writeToFile: string): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        renameSync(fromAbsolutePath, writeToFile);
        return;
      } catch (error) {
        lastError = error;

        if (existsSync(writeToFile)) {
          try {
            unlinkSync(writeToFile);
            renameSync(fromAbsolutePath, writeToFile);
            return;
          } catch (replaceError) {
            lastError = replaceError;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }

    throw lastError;
  }

  /**
   * delete physical file
   * @param key
   * @returns
   */
  async deleteFile(key: string) {
    if (!key) {
      return {
        success: true, // Changed: Don't treat empty key as error
        message: 'No file key provided, nothing to delete'
      };
    }

    const deleteFilePath = this.resolveExistingDeletePath(key);

    if (!deleteFilePath) {
      return {
        success: true, // Changed: Don't treat missing file as error
        message: 'File already deleted or does not exist'
      };
    }

    try {
      // Get parent directory before deleting file
      const parentDir = dirname(deleteFilePath);

      await this.unlinkWithRetry(deleteFilePath);

      // Remove empty parent directory if it exists and is empty
      await this.removeEmptyDirectories([parentDir]);

      return {
        success: true,
        message: 'File deleted successfully'
      };
    } catch (error) {
      console.warn(`Failed to delete file ${deleteFilePath}:`, error.message);
      return {
        success: false,
        message: 'File deletion failed',
        error: error.message
      };
    }
  }

  async deleteFiles(keys: string[]): Promise<IDeleteFileResponse> {
    const foldersToCheck = new Set<string>();
    let deletedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    const deletePaths = new Map<string, string>();
    uniq(keys).forEach((key) => {
      if (!key) {
        skippedCount++;
        return;
      }

      const deleteFilePath = this.resolveExistingDeletePath(key);
      if (!deleteFilePath) {
        skippedCount++;
        return;
      }

      const canonicalPath = normalize(resolve(deleteFilePath));
      const deduplicationKey = process.platform === 'win32'
        ? canonicalPath.toLowerCase()
        : canonicalPath;
      deletePaths.set(deduplicationKey, deleteFilePath);
    });

    for (const deleteFilePath of deletePaths.values()) {
      try {
        const parentDir = dirname(deleteFilePath);
        foldersToCheck.add(parentDir);
        await this.unlinkWithRetry(deleteFilePath);
        deletedCount++;
      } catch (error) {
        // Log error but continue with other files
        console.warn(`Failed to delete file ${deleteFilePath}:`, error.message);
        errors.push(`${deleteFilePath}: ${error.message}`);
        skippedCount++;
      }
    }

    // Remove empty parent directories after all files are deleted
    if (foldersToCheck.size > 0) {
      try {
        await this.removeEmptyDirectories(Array.from(foldersToCheck));
      } catch (error) {
        console.warn('Failed to remove empty directories:', error.message);
      }
    }

    return {
      success: errors.length === 0,
      deletedCount,
      skippedCount,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Remove empty directories recursively
   *
   * @param directories - Array of directory paths to check and remove if empty
   * @private
   */
  private async removeEmptyDirectories(directories: string[]): Promise<void> {
    const fs = await import('node:fs');
    const path = await import('node:path');

    for (const dir of directories) {
      try {
        // Skip if directory doesn't exist
        if (!fs.existsSync(dir)) {
          continue;
        }

        // Check if directory is empty
        const files = fs.readdirSync(dir);
        if (files.length === 0) {
          // Remove empty directory
          fs.rmdirSync(dir);

          // Recursively check parent directory
          const parentDir = path.dirname(dir);
          const publicDir = this.resolvePublicDir();
          const storageDir = this.resolveStorageDir();

          // Don't remove base directories (public, storage, uploads, etc.)
          if (parentDir !== publicDir &&
            parentDir !== storageDir &&
            !parentDir.endsWith('uploads') &&
            !parentDir.endsWith('storage') &&
            parentDir !== path.dirname(publicDir)) {
            await this.removeEmptyDirectories([parentDir]);
          }
        }
      } catch (error) {
        // Log warning but don't fail the operation
        console.warn(`Failed to remove directory ${dir}: ${error.message}`);
      }
    }
  }

  private resolvePublicDir(): string {
    return process.env.FILE_PUBLIC_DIR || fileConfig.publicDir;
  }

  private async unlinkWithRetry(filePath: string): Promise<void> {
    const maxRetries = 10;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        await fsPromises.unlink(filePath);
        return;
      } catch (error) {
        const fileError = error as NodeJS.ErrnoException;
        if (fileError.code === 'ENOENT') return;

        const isRetryable = ['EBUSY', 'EPERM', 'EACCES'].includes(fileError.code || '');
        if (!isRetryable || attempt === maxRetries) throw error;

        await new Promise(resolveRetry => setTimeout(resolveRetry, 50 * (attempt + 1)));
      }
    }
  }

  private resolveExistingDeletePath(key: string): string | null {
    const publicDir = this.resolvePublicDir();
    const platformKey = fromPosixPath(key);
    const relativeKey = key.replace(/^[/\\]+/, '');
    const platformRelativeKey = fromPosixPath(relativeKey);
    const candidates = uniq([
      key,
      platformKey,
      join(publicDir, relativeKey),
      join(publicDir, platformRelativeKey)
    ]);

    return candidates.find((candidate) => existsSync(candidate)) || null;
  }

  private pathsReferToSameLocation(sourcePath: string, targetPath: string): boolean {
    return resolve(sourcePath) === resolve(targetPath);
  }

  private isCrossDeviceRenameError(error: unknown): error is NodeJS.ErrnoException {
    return !!error
      && typeof error === 'object'
      && 'code' in error
      // eslint-disable-next-line no-undef
      && (error as NodeJS.ErrnoException).code === 'EXDEV';
  }

  private resolveStorageDir(): string {
    return dirname(process.env.TUS_UPLOAD_DIR || fileConfig.tus.uploadDir);
  }
}
