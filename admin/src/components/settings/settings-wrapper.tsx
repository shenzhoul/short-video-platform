'use client';

import { Page } from '@layout/components';
import { useSearchParams } from 'next/navigation';

import { SettingsForm } from './components/settings-form';

export default function SettingsWrapper() {
  const params = useSearchParams();
  const selectedTab = params?.get('tab') || 'site';

  return (
    <Page>
      <SettingsForm selectedTab={selectedTab} />
    </Page>
  );
}
