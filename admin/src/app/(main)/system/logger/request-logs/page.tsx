import RequestLogList from '@components/logger/request-log-list';
import { Metadata } from 'next';

// Force dynamic rendering to avoid build-time errors
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Request Logs',
  description: 'Monitor HTTP requests, user activity, and API usage across your application. Track request patterns, user agents, and authentication data.',
  keywords: 'request logs, http requests, api monitoring, user activity, traffic analysis, admin dashboard'
};

export default function RequestLogsPage() {
  return <RequestLogList />;
}
