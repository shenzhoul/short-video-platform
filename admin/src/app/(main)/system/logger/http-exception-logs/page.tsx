import HttpExceptionLogList from '@components/logger/http-exception-log-list';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'HTTP Exception Logs',
  description: 'Monitor and troubleshoot HTTP errors and exceptions in your application. View detailed error logs, stack traces, and request information to help debug issues.',
  keywords: 'http exceptions, error logs, debugging, system monitoring, application errors, admin dashboard'
};

export default function HttpExceptionLogsPage() {
  return <HttpExceptionLogList />;
}
