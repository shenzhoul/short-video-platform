import { ForbiddenException, Injectable } from "@nestjs/common";
import { AuthUserDto } from "src/dtos/identity/auth-user.dto";
import { UserDto } from "src/dtos/identity/user";
import { FileServerService } from "src/services/shared/file-server";
import { ObjectId } from 'mongodb';
import { __t } from "src/utils/translation";

/**
 * Identity File Service
 *
 * Specialized service for validating and managing files used in identity verification
 * and creator document management. Provides security controls, ownership validation,
 * and file processing coordination for identity-related file operations.
 *
 * Key Features:
 * - File ownership validation for identity documents
 * - KYC document file security controls
 * - Identity verification file processing coordination
 * - Batch file validation for document updates
 * - Integration with creator identity workflows
 *
 * Security Model:
 * - Admin users can use any file for identity verification
 * - Creators can only use files they uploaded for their own identity
 * - Creators can use files uploaded by administrators
 * - Creators can use files uploaded during registration
 * - Cross-creator file usage is prohibited for identity documents
 *
 * Document Types Supported:
 * - ID verification documents (passport, driver's license)
 * - Document verification files (utility bills, bank statements)
 * - Address verification documents
 * - Age verification documents (18+ compliance)
 *
 * @example Validate identity document files
 * ```typescript
 * const files = await identityFileService.validateIdentityDocumentOwnership(
 *   [idDocumentId, addressDocumentId],
 *   currentUser,
 *   'update'
 * );
 * ```
 *
 * @example Validate and process identity files
 * ```typescript
 * const { validatedFiles } = await identityFileService.validateAndRetrieveIdentityFiles(
 *   { idVerificationId: idFile, documentVerificationId: docFile },
 *   user
 * );
 * ```
 */
@Injectable()
export class IdentityFileService {
  constructor(
    private readonly fileServerService: FileServerService
  ) { }
  /**
   * Validates file ownership for identity document operations
   *
   * Security Rules for Identity Documents:
   * 1. Admin users can use any file for identity verification
   * 2. Creators can use files they created for their own identity
   * 3. Creators can use files created by admin (createdBy is null or admin user)
   * 4. Creators can use files uploaded during registration (createdBy is 'new-register-creator')
   * 5. Creators cannot use files created by other creators for identity
   * 6. Identity documents require stricter validation than general content
   *
   * @param fileIds Array of file IDs to validate for identity use
   * @param user Current user performing the identity operation
   * @param operation Operation type for error messages ('create' | 'update')
   * @throws ForbiddenException if user doesn't have permission to use any file for identity
   * @returns Promise resolving to true if all files are owned by the user
   */
  public async validateIdentityDocumentOwnership(
    fileIds: Array<string | ObjectId>,
    user: UserDto | AuthUserDto,
    operation: 'create' | 'update' = 'update'
  ): Promise<boolean> {
    // Admin users can use any file for identity verification
    if (user.isAdmin) return true;

    const checkIds = fileIds.filter((id) => !!id);
    if (!checkIds.length) return true;

    // Get file details to check ownership
    const files = await this.fileServerService.findByIds(checkIds as any);

    // Check if any files are missing
    if (files.length !== checkIds.length) {
      throw new ForbiddenException(
        __t('errors.files_missing_for_operation', { operation })
      );
    }

    // Check ownership for each file with stricter rules for identity documents
    const unauthorizedFiles = files.filter((file) => {
      // Allow files created by the current user
      if (file.createdBy && file.createdBy.toString() === user._id.toString()) {
        return false;
      }

      // Allow files created by admin (createdBy is null or equal 'admin')
      // Admin files typically have createdBy as null when uploaded via admin interface
      // or have createdBy set to 'admin'
      if (!file.createdBy || file.createdBy === 'admin') {
        return false;
      }

      // Allow files uploaded during creator registration
      // These files have createdBy set to 'new-register-creator' but should be usable
      // by the creator for their identity verification
      if (file.createdBy === 'new-register-creator') {
        return false;
      }

      // This file was created by another user (not admin, not current user, not registration)
      // This is strictly prohibited for identity documents
      return true;
    });

    if (unauthorizedFiles.length > 0) {
      throw new ForbiddenException(
        __t('errors.no_permission_to_use_files', { operation, count: unauthorizedFiles.length })
      );
    }

    return true;
  }
}