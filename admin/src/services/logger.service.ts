import { APIRequest } from './api-request';

export class LoggerService extends APIRequest {
  findHttpExceptionLogs = (query: Record<string, any> = {}) => this.get(
    this.buildUrl('/admin/logger/http-exception-logs', query)
  );

  findRequestLogs = (query: Record<string, any> = {}) => this.get(
    this.buildUrl('/admin/logger/request-logs', query)
  );

  findSystemLogs = (query: Record<string, any> = {}) => this.get(
    this.buildUrl('/admin/logger/system-logs', query)
  );

  findAuditLogs = (query: Record<string, any> = {}) => this.get(
    this.buildUrl('/admin/logger/audit-logs', query)
  );

  deleteSystemLogs = (ids: string[]) => this.del(
    '/admin/logger/system-logs',
    { ids }
  );

  deleteHttpExceptionLogs = (ids: string[]) => this.del(
    '/admin/logger/http-exception-logs',
    { ids }
  );

  deleteRequestLogs = (ids: string[]) => this.del(
    '/admin/logger/request-logs',
    { ids }
  );

  deleteAuditLogs = (ids: string[]) => this.del(
    '/admin/logger/audit-logs',
    { ids }
  );
}

export const loggerService = new LoggerService();
