import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { ContentFileService } from './content.file.service';

describe('ContentFileService photo drafts', () => {
  const userId = '64b000000000000000000001';
  const firstFileId = '64b000000000000000000011';
  const secondFileId = '64b000000000000000000012';
  const user = { _id: userId, isAdmin: false } as any;
  const createFile = (fileId: string, overrides: Record<string, unknown> = {}) => ({
    _id: fileId,
    type: 'post-photo',
    name: `${fileId}.webp`,
    originalName: 'photo.jpg',
    size: 1024,
    originalFileSize: 2048,
    status: 'completed',
    processingStatus: 'completed',
    url: `https://files.test/${fileId}.webp`,
    updatedAt: '2026-08-03T00:00:00.000Z',
    metadata: {
      processingOptions: {
        mediaType: 'image',
        referenceType: 'post-photo'
      },
      uploadMethod: 'normal'
    },
    createdBy: userId,
    refItems: [],
    ...overrides
  });

  it('restores owned unreferenced photo drafts in requested order', async () => {
    const fileServerService = {
      findByIds: jest.fn().mockResolvedValue([
        createFile(secondFileId),
        createFile(firstFileId)
      ])
    };
    const service = new ContentFileService(fileServerService as any);

    const result = await service.getPostPhotoDrafts([firstFileId, secondFileId], user);

    expect(result.map(item => item.fileId)).toEqual([firstFileId, secondFileId]);
    expect(result[0].url).toBe(`https://files.test/${firstFileId}.webp`);
  });

  it('rejects a photo draft owned by another creator', async () => {
    const fileServerService = {
      findByIds: jest.fn().mockResolvedValue([
        createFile(firstFileId, { createdBy: '64b000000000000000000099' })
      ])
    };
    const service = new ContentFileService(fileServerService as any);

    await expect(service.getPostPhotoDrafts([firstFileId], user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an owned file that is not a post photo', async () => {
    const fileServerService = {
      findByIds: jest.fn().mockResolvedValue([
        createFile(firstFileId, { type: 'post-video' })
      ])
    };
    const service = new ContentFileService(fileServerService as any);

    await expect(service.getPostPhotoDrafts([firstFileId], user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a photo that is already attached to a post', async () => {
    const fileServerService = {
      findByIds: jest.fn().mockResolvedValue([
        createFile(firstFileId, { refItems: ['64b000000000000000000099'] })
      ])
    };
    const service = new ContentFileService(fileServerService as any);

    await expect(service.getPostPhotoDrafts([firstFileId], user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('discards existing drafts and treats missing records idempotently', async () => {
    const fileServerService = {
      findByIds: jest.fn().mockResolvedValue([createFile(firstFileId)]),
      deleteManyByIds: jest.fn().mockResolvedValue({ deleted: 1, errors: [] })
    };
    const service = new ContentFileService(fileServerService as any);

    const result = await service.discardPostPhotoDrafts([firstFileId, secondFileId], user);

    expect(fileServerService.deleteManyByIds).toHaveBeenCalledWith([firstFileId]);
    expect(result.discardedFileIds).toEqual([firstFileId]);
    expect(result.missingFileIds).toEqual([secondFileId]);
  });

  it('fails discard when physical cleanup is incomplete', async () => {
    const fileServerService = {
      findByIds: jest.fn().mockResolvedValue([createFile(firstFileId)]),
      deleteManyByIds: jest.fn().mockResolvedValue({ deleted: 0, errors: [{ fileId: firstFileId }] })
    };
    const service = new ContentFileService(fileServerService as any);

    await expect(service.discardPostPhotoDrafts([firstFileId], user)).rejects.toBeInstanceOf(BadRequestException);
  });
});
