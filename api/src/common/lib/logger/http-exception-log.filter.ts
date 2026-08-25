import {
  ArgumentsHost, Catch, HttpException, Logger
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

import { getHttpExceptionLogModel } from './logger-mongoose';

@Catch()
export class HttpExceptionLogFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(HttpExceptionLogFilter.name);

  async catch(exception: any, host: ArgumentsHost) {
    try {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<any>();
      const request = ctx.getRequest<any>();
      const status = exception instanceof HttpException ? exception.getStatus() : 500;
      let message = exception instanceof HttpException ? exception.getResponse() : 'Something went wrong, please recheck again!';

      // Handle throttler exceptions (429 status) with user-friendly message
      if (status === 429) {
        message = 'You are making requests too quickly. Please wait a moment and try again.';

        return response
          .status(status)
          .json({
            statusCode: status,
            message
          });
      }

      // Handle non-500 status exceptions with default NestJS behavior
      if (exception instanceof HttpException && exception.getStatus() !== 500) {
        return super.catch(exception, host);
      }

      // An unhandled 500 is an internal fault. Everything useful about it goes
      // to the server, and nothing about it goes to the client.
      //
      // The response used to carry `exception.stack` outside production, which
      // put MongoDB index names and absolute source paths straight into the
      // chat UI when a send failed. Diagnosing from the terminal is no real
      // loss; leaking database internals into a rendered error bubble is.
      this.logger.error(
        `Unhandled ${status} on ${request.method} ${request.path}: ${exception?.message}`,
        exception?.stack
      );

      if (process.env.NODE_ENV === 'production') {
        const HttpExceptionLogModel = getHttpExceptionLogModel();
        // remove await to avoid blocking
        HttpExceptionLogModel.create({
          path: request.path,
          headers: request.headers,
          query: request.query,
          body: request.body,
          error: exception.stack || exception
        });
      }

      return response
        .status(status)
        .json({
          statusCode: status,
          message
        });
    } catch (e) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<any>();
      return response
        .status(500)
        .json({
          statusCode: 500,
          message: 'Something went wrong, please try again later!'
        });
    }
  }
}
