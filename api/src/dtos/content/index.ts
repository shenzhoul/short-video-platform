/**
 * Content Domain DTOs
 *
 * This file exports all Data Transfer Objects (DTOs) related to content management.
 * DTOs are used for API responses and contain the structured data that clients receive.
 *
 * Content Types:
 * - Video: Video content DTOs with metadata, thumbnails, and streaming info
 * - Gallery: Gallery collection DTOs for organizing multiple media items
 * - Photo: Photo content DTOs with image metadata and processing info
 * - Product: Digital product DTOs for marketplace functionality
 *
 * Usage:
 * ```typescript
 * import { ProductDto } from 'src/dtos/content';
 * ```
 */

export * from './post.dto';
export * from './post-video-draft.dto';
export * from './post-photo-draft.dto';
