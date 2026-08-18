import SystemLogList from '@components/logger/system-log-list';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'System Logs',
  description: 'Monitor system events, application logs, and debug information. View log levels, contexts, and detailed system activity to maintain application health.',
  keywords: 'system logs, application monitoring, debug logs, system events, admin dashboard'
};

export default function SystemLogsPage() {
  return <SystemLogList />;
}
