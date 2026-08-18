/**
 * User Status Tag Component
 *
 * Displays user status using the generic status tag component.
 * Migrated to use GenericStatusTag for consistency and maintainability.
 */

'use client';

import { GenericStatusTag } from '@components/common/status-tag';
import { USER_STATUS_CONFIG } from '@constants/status-configs';
import React from 'react';

interface UserStatusTagProps {
  status: string;
  className?: string;
  style?: React.CSSProperties;
}

export const UserStatusTag: React.FC<UserStatusTagProps> = ({
  status,
  className = '',
  style = undefined
}) => {
  return (
    <GenericStatusTag
      status={status}
      statusConfig={USER_STATUS_CONFIG}
      className={className}
      style={style}
    />
  );
};

export default UserStatusTag;
