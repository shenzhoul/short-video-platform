'use client';

import { Alert, Col, Menu, Row, Typography } from 'antd';
import React, { useMemo } from 'react';

import type { SettingsSection, SettingsSectionGroup } from '../hooks/use-settings-sections';

interface SettingsSectionsProps {
  groups: SettingsSectionGroup[];
  activeSection: SettingsSection;
  onSelect: (key: string) => void;
  /** Renders the fields of the active section; supplied by the form. */
  children: React.ReactNode;
  /** Keys edited but not yet submitted, so switching sections is not a silent loss. */
  pendingCount?: number;
}

/**
 * Rail-and-pane layout for a settings group that divides into sections.
 *
 * The upload limits were one flat list of fifty-seven numbers, six per upload
 * type, with the type repeated in every label and the same two sentences under
 * every field. Finding "the avatar height limit" meant scrolling and reading.
 * Here the rail names the ten upload types, the pane shows only the chosen one's
 * fields, and the shared sentences are said once at the top.
 */
export const SettingsSections: React.FC<SettingsSectionsProps> = ({
  groups,
  activeSection,
  onSelect,
  children,
  pendingCount = 0
}) => {
  const menuItems = useMemo(() => groups.map((group) => ({
    key: group.label,
    label: group.label,
    type: 'group' as const,
    children: group.sections.map((section) => ({
      key: section.key,
      label: section.label
    }))
  })), [groups]);

  return (
    <Row gutter={[24, 16]}>
      <Col xs={24} md={8} lg={6}>
        <Menu
          mode="inline"
          items={menuItems}
          selectedKeys={[activeSection.key]}
          onClick={({ key }) => onSelect(key)}
          style={{ borderInlineEnd: 'none' }}
        />
      </Col>

      <Col xs={24} md={16} lg={18}>
        <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
          {activeSection.label}
        </Typography.Title>
        {activeSection.note ? (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            {activeSection.note}
          </Typography.Paragraph>
        ) : null}

        {pendingCount > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            title={`${pendingCount} unsaved change${pendingCount === 1 ? '' : 's'}`}
            description="Edits in other sections are kept and will be saved together when you submit."
          />
        ) : null}

        {children}
      </Col>
    </Row>
  );
};

export default SettingsSections;
