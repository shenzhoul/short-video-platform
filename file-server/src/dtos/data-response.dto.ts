/**
 * Standard data response format for all API endpoints
 * Provides consistent response structure across the application
 */
export class DataResponse<T = any> {
  success: boolean;

  data?: T;

  error?: string;

  message?: string;

  /**
   * Create a successful response
   * @param data - Response data
   * @param message - Optional success message
   * @returns DataResponse with success: true
   */
  // eslint-disable-next-line no-shadow
  static ok<T>(data: T, message?: string): DataResponse<T> {
    return {
      success: true,
      data,
      message
    };
  }

  /**
   * Create an error response
   * @param error - Error message
   * @param message - Optional additional message
   * @returns DataResponse with success: false
   */
  static error(error: string, message?: string): DataResponse {
    return {
      success: false,
      error,
      message
    };
  }
}
