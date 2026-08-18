import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { AppConfigService } from "src/config";
import { FileDocument } from "src/schemas";
import { ObjectId } from 'mongodb';
import { parse } from 'path';
import * as jwt from 'jsonwebtoken';
import { FILE_STATUS, PROCESSING_STATUS } from "src/common/constants/content";

export interface ITusUploadRequest {
  filename: string;
  mediaType: string;
  type: string;
  size: number;
  acl?: string;
  processingOptions?: any;
  metadata?: Record<string, any>;
  createdBy?: string;
  updatedBy?: string;
}

export interface ITusUploadResponse {
  tusUploadUrl: string;
  tusToken: string;
  fileId: string;
  expiresAt: Date;
  uploadType: 'tus';
  httpMethod: 'POST';
}

/**
 * TUS Authentication Service
 *
 * Handles authentication and authorization for TUS uploads.
 * Generates secure TUS upload URLs with embedded authentication tokens.
 */
@Injectable()
export class TusAuthService {
  private readonly logger = new Logger(TusAuthService.name);

  constructor(
    private readonly configService: AppConfigService,
    @InjectModel(File.name) private readonly FileModel: Model<FileDocument>
  ) { }

  /**
   * Extract TUS token from request headers
   */
  public extractTusToken(req: any): string | null {
    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Check custom TUS-Token header
    const tusTokenHeader = req.headers['tus-token'];
    if (tusTokenHeader) {
      return tusTokenHeader;
    }

    // Check query parameter
    const queryToken = req.query?.token;
    if (queryToken) {
      return queryToken;
    }

    return null;
  }

  /**
 * Validate TUS authentication token
 */
  public validateTusToken(token: string): any {
    try {
      const secret = this.configService.auth.jwtSecret;
      const payload = jwt.verify(token, secret) as any;

      if (payload.tokenType !== 'tus-upload') {
        throw new Error('Invalid token type');
      }

      return payload;
    } catch (error) {
      this.logger.error(`TUS token validation failed: ${error.message}`);
      throw new Error('Invalid or expired TUS token');
    }
  }

  /**
   * Validate TUS upload request
   */
  public validateTusUploadRequest(req: any): any {
    const token = this.extractTusToken(req);

    if (!token) {
      throw new Error('TUS authentication token required');
    }

    return this.validateTusToken(token);
  }

  /**
   * Generate TUS authentication token
   */
  private generateTusToken(payload: any): string {
    const secret = this.configService.auth.jwtSecret;
    const expiresIn = '2h'; // 2 hour

    return jwt.sign(
      {
        ...payload,
        tokenType: 'tus-upload', // Use tokenType instead of type to avoid conflict
        iat: Math.floor(Date.now() / 1000)
      },
      secret,
      { expiresIn }
    );
  }

  /**
   * Generate secure TUS upload URL with authentication token
   * Creates a pending file record in the database similar to regular uploads
   */
  public async generateTusUploadUrl(request: ITusUploadRequest): Promise<ITusUploadResponse> {
    // Check if TUS upload is supported in config
    const supportedMethods = this.configService.app.supportedUploadMethods;
    if (!supportedMethods.includes('tus')) {
      throw new Error(`TUS upload method is not supported. Supported methods: ${supportedMethods.join(', ')}`);
    }

    // Create a pending file record similar to generateSignedUploadUrl
    const fileId = new ObjectId();
    const {
      mediaType, type, filename, acl, processingOptions, metadata, createdBy, updatedBy
    } = request;

    // Create pending file record for TUS upload
    const fileData = {
      _id: fileId,
      type,
      mediaType, // Add the missing mediaType field
      name: parse(filename).name,
      originalName: filename,
      fileExtension: parse(filename).ext || '',
      description: '',
      mimeType: this.getMimeTypeFromExtension(filename),
      storageType: 'diskStorage', // Using disk storage for TUS uploads
      path: null, // fileKey,
      absolutePath: null, // join(this.configService.file.publicDir, fileKey),
      processingStatus: PROCESSING_STATUS.PENDING,
      status: FILE_STATUS.PENDING,
      uploadMethod: 'tus', // Mark as TUS upload
      acl: acl || 'private',
      isProtected: (acl || 'private') !== 'public-read',
      fileSize: 0,
      originalFileSize: 0,
      uploadedAt: new Date(),
      metadata: {
        ...metadata,
        processingOptions,
        originalFilename: filename
      },
      createdBy: createdBy || null,
      updatedBy: updatedBy || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Save the file record to database
    await this.FileModel.create(fileData);

    // Generate TUS authentication token
    const tusToken = this.generateTusToken({
      fileId: fileId.toString(),
      filename: request.filename,
      mediaType: request.mediaType,
      type: request.type,
      size: request.size,
      acl: request.acl || 'private'
      // Note: processingOptions and metadata are stored in the file record
      // and don't need to be included in the JWT token for security reasons
    });

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 2); // 2 hour expiry

    return {
      tusUploadUrl: `${this.getBaseUrl()}/tus-upload`,
      tusToken,
      fileId: fileId.toString(),
      expiresAt,
      uploadType: 'tus',
      httpMethod: 'POST'
    };
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeTypeFromExtension(filename: string): string {
    const ext = parse(filename).ext.toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.webm': 'video/webm',
      '.wmv': 'video/x-ms-wmv',
      '.ogg': 'video/ogg',
      '.flv': 'video/x-flv',
      '.mkv': 'video/x-matroska',
      '.hevc': 'video/hevc'
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Get base URL for TUS uploads
   */
  private getBaseUrl(): string {
    // In production, this should come from configuration
    return process.env.BASE_URL || 'http://localhost:8000';
  }
}
