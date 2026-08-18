/**
 * Generic Status Tag Component
 *
 * A reusable status tag component that displays status with configurable colors and text.
 * This component replaces all individual status tag components across the application.
 *
 * @description Renders a colored tag based on status configuration
 * @example
 * ```tsx
 * import { GenericStatusTag } from '@components/common/status-tag';
 * import { PRODUCT_STATUS_CONFIG } from '@constants/status-configs';
 *
 * <GenericStatusTag status="active" statusConfig={PRODUCT_STATUS_CONFIG} />
 * ```
 */

'use client';

import { getStatusConfig, StatusConfig } from '@constants/status-configs';
import { Tag } from 'antd';
import React from 'react';

interface GenericStatusTagProps {
  /**
   * The status value to display
   */
  status: string;

  /**
   * Configuration object mapping status values to colors and text
   */
  statusConfig: StatusConfig;

  /**
   * Optional CSS class name
   */
  className?: string;

  /**
   * Optional inline styles
   */
  style?: React.CSSProperties;

  /**
   * Optional font weight (default: 500 for some tags)
   */
  fontWeight?: number | string;

  /**
   * Optional text transform
   */
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
}

/**
 * Generic Status Tag Component
 *
 * Displays a status tag with configurable appearance based on the provided configuration.
 */
export function GenericStatusTag({
  status,
  statusConfig,
  className = '',
  style = {},
  fontWeight = undefined,
  textTransform = undefined
}: GenericStatusTagProps) {
  const config = getStatusConfig(status, statusConfig);

  const tagStyle: React.CSSProperties = {
    ...style
  };

  if (fontWeight !== undefined) {
    tagStyle.fontWeight = fontWeight;
  }

  if (textTransform !== undefined) {
    tagStyle.textTransform = textTransform;
  }

  return (
    <Tag color={config.color} className={className} style={tagStyle}>
      {config.text}
    </Tag>
  );
}

export default GenericStatusTag;
