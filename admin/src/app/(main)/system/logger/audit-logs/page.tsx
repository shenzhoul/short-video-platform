import AuditLogList from '@components/logger/audit-log-list';
import { Metadata } from 'next';

// Force dynamic rendering to avoid build-time errors
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Audit Logs',
  description: 'Track user actions, system events, and administrative operations. Monitor payment restrictions, dispute actions, and compliance-related activities.',
  keywords: 'audit logs, user actions, compliance, system events, payment restrictions, dispute management, admin dashboard'
};

/**
 * Audit Logs Page
 *
 * Displays comprehensive audit trail for:
 * - User authentication events
 * - Payment and financial transactions
 * - Payment restrictions and user status changes
 * - Dispute actions and resolutions
 * - Content management activities
 * - Administrative operations
 *
 * Used for compliance, debugging, and security monitoring.
 */
export default function AuditLogsPage() {
  return <AuditLogList />;
}
