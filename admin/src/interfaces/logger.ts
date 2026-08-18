export interface IRequestLog {
  _id: string;
  path: string;
  method?: string;
  headers?: Record<string, any> | null;
  query?: Record<string, any> | null;
  body?: Record<string, any> | null;
  authData?: Record<string, any> | null;
  userAgent?: string | null;
  ip?: string | null;
  createdAt?: Date | string | null;
}

export interface IHttpExceptionLog {
  _id: string;
  path: string;
  error: string;
  headers?: Record<string, any> | null;
  query?: Record<string, any> | null;
  body?: Record<string, any> | null;
  statusCode?: number | null;
  createdAt?: Date | string | null;
}

export interface ISystemLog {
  _id: string;
  level: string;
  context: string;
  message: string;
  timestamp?: Date | string | null;
  createdAt?: Date | string | null;
  meta?: Record<string, any> | null;
}

export interface IAuditLog {
  _id: string;
  userId?: string | null;
  type: string;
  action: string;
  data?: Record<string, any> | null;
  createdAt?: Date | string | null;
}
