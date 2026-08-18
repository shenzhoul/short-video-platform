import {
  ArgumentsHost, Catch, HttpException
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

import { getHttpExceptionLogModel } from './logger-mongoose';

@Catch()
export class HttpExceptionLogFilter extends BaseExceptionFilter {
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

      // Handle 500 status exceptions with custom logging
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

        return response
          .status(status)
          .json({
            statusCode: status,
            message
          });
      }

      return response
        .status(status)
        .json({
          error: exception,
          statusCode: status,
          message: exception.stack
        });
    } catch (e) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<any>();
      return response
        .status(500)
        .json({
          error: process.env.NODE_ENV === 'development' ? e : null,
          statusCode: 500,
          message: 'Something went wrong, please try again later!'
        });
    }
  }
}
