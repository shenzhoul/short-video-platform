/**
 * Interface for uploaded files with all necessary properties
 * This interface includes all properties needed for file processing
 */
export interface IMulterUploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer?: Buffer;
  stream?: any;
  metadata?: Record<string, any>;
  acl?: string;
}