'use client';

import { Tag } from 'antd';
import React from 'react';

interface UserRoleTagsProps {
  isAdmin?: boolean;
  username?: string;
  className?: string;
}

export const UserRoleTags: React.FC<UserRoleTagsProps> = ({
  isAdmin,
  username,
  className = ''
}) => {
  const tags: React.ReactElement[] = [];

  // Check for superadmin
  if (username === 'superadmin') {
    tags.push(
      <Tag key="superadmin" color="gold" className={className}>
        Superadmin
      </Tag>
    );
  } else if (isAdmin) {
    tags.push(
      <Tag key="admin" color="red" className={className}>
        Admin
      </Tag>
    );
  }

  // If no special roles, show User tag
  if (!isAdmin) {
    tags.push(
      <Tag key="user" color="blue" className={className}>
        User
      </Tag>
    );
  }

  return tags;
};

export default UserRoleTags;
