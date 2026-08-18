import {
  IDeleteFileResponse, IFileUpload, IFileUploadResponse, IGetFileUrlOptions
} from 'src/common/interfaces/file';

export abstract class AbstractStorage {
  abstract writeFile(options: IFileUpload): Promise<IFileUploadResponse>;

  abstract deleteFile(key: string): Promise<IDeleteFileResponse>;

  abstract deleteFiles(keys: string[]): Promise<IDeleteFileResponse>;

  abstract getFileUrl(key: string, options: IGetFileUrlOptions): Promise<string>;
}
