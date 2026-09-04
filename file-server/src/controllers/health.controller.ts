import {
  Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { accessSync, constants } from 'fs';
import { Connection } from 'mongoose';
import { resolve } from 'path';

import { fileConfig, storageConfig, STORAGE_DRIVERS } from 'src/config';

/**
 * Liveness and readiness for the file server.
 *
 * See the API's `HealthController` for why these are two endpoints rather than
 * one. The file server's readiness has more to check than the API's, because
 * more of what it needs is not a database:
 *
 *  - Mongo, for the file records.
 *  - A **writable temp directory**. Every upload lands here before it is
 *    processed, and a full or read-only processing volume is the classic way
 *    this service fails: it accepts uploads, then fails each one deep in the
 *    pipeline, on a queue, after the client has already been told the transfer
 *    succeeded. Boot checks this once; readiness re-checks it, because a volume
 *    fills up long after boot.
 *  - The configured **storage backend**. On a bucket deploy, unreachable object
 *    storage means every upload will fail, and this container should be taken
 *    out of rotation rather than left accepting them.
 */
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness() {
    const [mongo, storage] = await Promise.all([
      this.checkMongo(),
      this.checkStorage()
    ]);

    const dependencies = {
      mongo,
      tempDir: this.checkTempDirWritable(),
      storage
    };

    if (!Object.values(dependencies).every(Boolean)) {
      throw new ServiceUnavailableException({ status: 'unavailable', dependencies });
    }

    return { status: 'ready', dependencies };
  }

  private async checkMongo(): Promise<boolean> {
    try {
      if (this.mongoConnection.readyState !== 1) return false;
      await this.mongoConnection.db.admin().ping();
      return true;
    } catch {
      return false;
    }
  }

  private checkTempDirWritable(): boolean {
    try {
      accessSync(resolve(process.env.FILE_TEMP_DIR || fileConfig.tempDir), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * On a disk deploy this is the public directory. On a bucket deploy it is
   * whether the configuration is complete — deliberately *not* a network call
   * to the bucket, because readiness is polled every few seconds by the proxy
   * and a HEAD per poll is a request per second, per container, billed, for a
   * question that only changes when the configuration changes.
   *
   * That the bucket is genuinely reachable with these credentials is what
   * `yarn verify:r2` answers, once, at deploy time.
   */
  private async checkStorage(): Promise<boolean> {
    if (storageConfig.driver === STORAGE_DRIVERS.R2) {
      const {
        endpoint, bucket, accessKeyId, secretAccessKey, publicBaseUrl
      } = storageConfig.r2;
      return Boolean(endpoint && bucket && accessKeyId && secretAccessKey && publicBaseUrl);
    }

    try {
      accessSync(resolve(process.env.FILE_PUBLIC_DIR || fileConfig.publicDir), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}
