import {
  Controller, Get
} from '@nestjs/common';

import { AppService } from './app.service';

/**
 * Main application controller handling basic app routes and country blocking functionality
 */
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService
  ) { }

  /**
   * Simple health check endpoint returning a greeting message
   * @returns string - Hello world message
   */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
