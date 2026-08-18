/**
 * Enumeration representing the possible result statuses for data responses
 */
// eslint-disable-next-line no-shadow
export enum ResultStatus {
  /** Operation completed successfully */
  OK,
  /** Operation failed with recoverable error */
  FAIL,
  /** Operation failed with unrecoverable error */
  ERROR
}

/**
 * Generic data response wrapper that provides a consistent structure for API responses
 * @template D - The type of data being wrapped
 */
export class DataResponse<D> {
  /**
   * Creates a new DataResponse instance
   * @param status - The result status of the operation
   * @param data - Optional data payload
   * @param message - Optional message describing the result
   * @param error - Optional error object for failed operations
   */
  constructor(
    public readonly status: ResultStatus,
    public readonly data?: D,
    public readonly message?: string,
    public readonly error?: Error
  ) {
  }

  /**
   * Creates a successful response with optional data
   * @param data - Optional data to include in the response
   * @returns A new DataResponse with OK status
   */
  // eslint-disable-next-line no-shadow
  static ok<D>(data?: D) {
    return new DataResponse(ResultStatus.OK, data);
  }

  /**
   * Creates a failed response from an error
   * @param error - The error that caused the failure
   * @returns A new DataResponse with FAIL status
   */
  // eslint-disable-next-line no-shadow
  static fail<D>(error: Error) {
    return new DataResponse<D>(ResultStatus.FAIL, (error as any).data, error.message, error);
  }

  /**
   * Creates an error response from an error with optional data
   * @param error - The error that occurred
   * @param data - Optional data to include in the response
   * @returns A new DataResponse with ERROR status
   */
  // eslint-disable-next-line no-shadow
  static error<D>(error: Error, data?: D) {
    return new DataResponse(ResultStatus.ERROR, data, error.message, error);
  }

  /**
   * Checks if the response status is OK
   * @returns True if status is OK, false otherwise
   */
  isOk() {
    return this.status === ResultStatus.OK;
  }

  /**
   * Checks if the response status is FAIL
   * @returns True if status is FAIL, false otherwise
   */
  isFail() {
    return this.status === ResultStatus.FAIL;
  }

  /**
   * Checks if the response status is ERROR
   * @returns True if status is ERROR, false otherwise
   */
  isError() {
    return this.status === ResultStatus.ERROR;
  }
}
