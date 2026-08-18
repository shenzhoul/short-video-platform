import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
// eslint-disable-next-line import/no-extraneous-dependencies
import { Request, Response } from 'express';

import { getRequestLogModel } from './logger-mongoose';

function parseJwt(token: string) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const buff = Buffer.from(base64, 'base64');
    const payloadinit = buff.toString('ascii');
    return JSON.parse(payloadinit);
  } catch {
    return null;
  }
}

/**
 * Enhanced Request Logger Middleware with resilient database connection
 *
 * This middleware logs HTTP requests to a separate logger database using
 * the resilient connection pattern. It continues to function even when
 * the logger database is unavailable.
 *
 * Features:
 * - Resilient database connection via logger-mongoose
 * - Silent error handling to prevent request disruption
 * - JWT token parsing for authentication data
 * - Fire-and-forget logging pattern
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestLoggerMiddleware.name);

  async use(req: Request, _res: Response, next: Function) {
    // Continue with request processing immediately
    next();

    // Log request asynchronously without blocking
    setImmediate(async () => {
      try {
        const requestLogModel = getRequestLogModel();

        const data = {
          path: req.originalUrl,
          method: req.method,
          headers: req.headers,
          query: req.query,
          body: req.body,
          userAgent: req.get('User-Agent'),
          ip: req.ip || req.socket?.remoteAddress
        } as any;

        const authToken = (req.headers.authorization || req.query.token) as string;
        if (authToken) {
          const tokenArr = authToken.split(' ');
          const authData = parseJwt(tokenArr.length > 1 ? tokenArr[1] : tokenArr[0]);
          if (authData) {
            data.authData = authData;
            data.userId = authData.userId || authData.sub;
          }
        }

        await requestLogModel.create(data);
      } catch {
        // Silently ignore logging errors to prevent request disruption
        // The dummy model will handle this gracefully when DB is down
        // this.logger.log('Request logging failed (non-critical)', error);
      }
    });
  }
}
