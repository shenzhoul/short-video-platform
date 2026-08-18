export class PermissionError extends Error {
  details: any;

  constructor(message, details) {
    super(message);

    this.name = 'PermissionError';
    this.details = details; // Custom property to hold additional details
  }
}
