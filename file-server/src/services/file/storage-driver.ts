import { STORAGE_TYPES } from 'src/common/constants/content';
import { storageConfig, STORAGE_DRIVERS } from 'src/config';

/**
 * The `storageType` to stamp on a file record being created.
 *
 * Kept in its own module because both record-creation paths need it —
 * `FileMetadataService.buildFileRecord` for regular uploads and
 * `FileService` for the signed direct-upload flow — and importing
 * `StorageService` from either would close a cycle.
 *
 * This is the *write* answer only. Reading a file back dispatches on the value
 * stored on that record, so changing the driver never restates where existing
 * media lives.
 */
export function configuredStorageType(): string {
  return storageConfig.driver === STORAGE_DRIVERS.R2
    ? STORAGE_TYPES.S3
    : STORAGE_TYPES.DISK_STORAGE;
}
