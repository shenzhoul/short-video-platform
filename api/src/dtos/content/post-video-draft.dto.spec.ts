import { PostVideoDraftDto } from './post-video-draft.dto';
import { FileServerInfoDto } from '../shared/file-server/file-server.dto';

describe('PostVideoDraftDto', () => {
  it('exposes URL-string thumbnails returned by the file server', () => {
    const file = Object.assign(new FileServerInfoDto(), {
      _id: 'video-id',
      name: 'video.mp4',
      size: 10,
      status: 'completed',
      thumbnails: ['https://cdn.test/one.webp', 'https://cdn.test/two.webp'],
      updatedAt: new Date().toISOString()
    });

    expect(PostVideoDraftDto.fromFile(file).thumbnails).toEqual(file.thumbnails);
  });

  it('normalizes legacy thumbnail metadata to URLs', () => {
    const file = Object.assign(new FileServerInfoDto(), {
      _id: 'video-id',
      name: 'video.mp4',
      size: 10,
      status: 'completed',
      thumbnails: [{
        path: 'fallback.webp',
        url: 'https://cdn.test/legacy.webp',
        width: 320,
        height: 180
      }],
      updatedAt: new Date().toISOString()
    });

    expect(PostVideoDraftDto.fromFile(file).thumbnails).toEqual([
      'https://cdn.test/legacy.webp'
    ]);
  });
});
