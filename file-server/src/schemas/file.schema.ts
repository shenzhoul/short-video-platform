import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import {
  FILE_STATUS,
  PROCESSING_STATUS,
  S3_ACCESS_CONTROL,
  STORAGE_TYPES,
  UPLOAD_METHODS
} from 'src/common/constants/content';

@Schema({
  _id: false
})
export class FileRefItem {
  @Prop({
    type: MongooseSchema.Types.ObjectId
  })
  itemId: ObjectId;

  @Prop()
  itemType: string;
}

const FileRefItemSchema = SchemaFactory.createForClass(FileRefItem);
@Schema({
  collection: 'files'
})
export class File {
  @Prop({
    required: true,
    index: true
  })
  type: string;

  @Prop({
    required: true
  })
  name: string;

  @Prop()
  originalName: string;

  @Prop()
  fileExtension: string;

  @Prop()
  description: string;

  @Prop({
    required: true
  })
  mimeType: string;

  @Prop({
    required: true,
    index: true
  })
  mediaType: string;

  @Prop({
    default: STORAGE_TYPES.DISK_STORAGE
  })
  storageType: string;

  @Prop({
    index: true,
    sparse: true
  })
  path: string; // can be relative path or S3 key, can be null for pending files

  @Prop()
  absolutePath: string;

  @Prop()
  width: number;

  @Prop()
  height: number;

  @Prop()
  duration: number;

  @Prop({
    required: true
  })
  fileSize: number;

  @Prop()
  originalFileSize: number;

  @Prop({
    default: PROCESSING_STATUS.PENDING,
    index: true
  })
  processingStatus: string;

  @Prop({
    default: FILE_STATUS.PENDING
  })
  status: string;

  @Prop()
  encoding: string;

  @Prop({
    default: UPLOAD_METHODS.REGULAR
  })
  uploadMethod: string;

  // store array of thumbnail files with specific structure
  @Prop({
    type: [{
      size: String,
      path: String,
      absolutePath: String,
      width: Number,
      height: Number,
      fileSize: Number,
      _id: false
    }],
    default: []
  })
  thumbnails: Array<{
    size: string;
    path: string;
    absolutePath?: string;
    width: number;
    height: number;
    fileSize: number;
  }>;

  @Prop()
  blurImagePath: string;

  @Prop({
    type: [FileRefItemSchema],
    _id: false,
    index: true
  })
  refItems: Array<FileRefItem>;

  @Prop({
    required: true,
    default: S3_ACCESS_CONTROL.PUBLIC_READ
  })
  acl: string;

  @Prop({
    default: false,
    index: true
  })
  isProtected: boolean;

  @Prop({
    type: MongooseSchema.Types.Mixed
  })
  metadata: Record<string, any>;

  @Prop({
    type: MongooseSchema.Types.Mixed
  })
  processingError: any;

  @Prop()
  uploadedAt: Date;

  @Prop()
  processedAt: Date;

  @Prop({
    index: true,
    sparse: true
  })
  tusId: string;

  @Prop({
    type: String,
    default: null
  })
  createdBy: string;

  @Prop({
    type: String,
    default: null
  })
  updatedBy: string;

  @Prop({
    type: Date,
    default: Date.now,
    index: true
  })
  createdAt: Date;

  @Prop({
    type: Date,
    default: Date.now
  })
  updatedAt: Date;
}

export type FileDocument = HydratedDocument<File>;

export const FileSchema = SchemaFactory.createForClass(File);

// ===== DATABASE INDEXES FOR OPTIMAL QUERY PERFORMANCE =====

/**
 * Compound index for cleanup operations
 * Optimizes the removeUnusedFilesByTypes query:
 * - type: { $in: types }
 * - createdAt: { $lt: thresholdTime }
 * - refItems: { $size: 0 } or { $exists: false }
 */
FileSchema.index({
  type: 1,
  createdAt: 1
}, {
  name: 'idx_type_createdAt_cleanup',
  background: true
});

/**
 * Compound index for reference-based queries
 * Optimizes queries that filter by refItems content:
 * - refItems.itemId: ObjectId
 * - refItems.itemType: string
 */
FileSchema.index({
  'refItems.itemId': 1,
  'refItems.itemType': 1
}, {
  name: 'idx_refItems_itemId_itemType',
  background: true,
  sparse: true
});

/**
 * Compound index for orphaned file detection
 * Optimizes queries that find files without references:
 * - Supports queries with empty or non-existent refItems
 * - Combined with type filtering for targeted cleanup
 */
FileSchema.index({
  type: 1,
  refItems: 1,
  createdAt: 1
}, {
  name: 'idx_type_refItems_createdAt_orphan_detection',
  background: true,
  sparse: true
});
