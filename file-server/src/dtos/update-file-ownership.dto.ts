import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf
} from "class-validator";

/**
 * DTO for updating file ownership (createdBy and updatedBy fields)
 * Used for internal API calls to update file ownership after account creation
 */
export class UpdateFileOwnershipDto {
  /**
   * Single file ID to update
   * Either fileId or fileIds must be provided, but not both
   */
  @IsOptional()
  @IsString()
  @IsMongoId()
  @ValidateIf((o) => !o.fileIds || o.fileIds.length === 0)
  fileId?: string;

  /**
   * Array of file IDs to update in batch
   * Either fileId or fileIds must be provided, but not both
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsMongoId({ each: true })
  @ArrayMinSize(1, { message: 'At least one file ID is required' })
  @ArrayMaxSize(100, { message: 'Maximum 100 files can be updated at once' })
  @ValidateIf((o) => !o.fileId)
  fileIds?: string[];

  /**
   * New createdBy value
   * Can be user ID, 'admin', or other system identifier
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  createdBy?: string;

  /**
   * New updatedBy value
   * Can be user ID, 'admin', or other system identifier
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  updatedBy?: string;

  /**
   * Filter to match files before updating
   * Used for additional security to ensure only intended files are updated
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currentCreatedBy?: string;

  /**
   * Optional reference to add to updated files
   * Allows adding file references while updating ownership in a single request
   */
  @IsOptional()
  ref?: {
    itemId: string;
    itemType: string;
  };
}

/**
 * Response DTO for file ownership update operations
 */
export class UpdateFileOwnershipResponseDto {
  /**
   * Number of files successfully updated
   */
  updated: number;

  /**
   * Array of file IDs that were updated
   */
  updatedFileIds: string[];

  /**
   * Array of errors encountered during update
   */
  errors: Array<{
    fileId: string;
    error: string;
  }>;

  /**
   * Success message
   */
  message: string;
}