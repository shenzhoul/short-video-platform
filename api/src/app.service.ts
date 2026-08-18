import { Injectable } from '@nestjs/common';

/**
 * Main application service providing basic application functionality
 * Currently serves as a simple health check service
 */
@Injectable()
export class AppService {
  text = 'Hello world!';

  /**
   * Returns a simple greeting message for health check purposes
   * @returns string - The greeting message
   */
  getHello(): string {
    return this.text;
  }
}
