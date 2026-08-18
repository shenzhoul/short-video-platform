import { SettingsWrapper } from '@components/settings';
import { Metadata } from 'next';

export default async function Settings() {
  return (
    <SettingsWrapper />
  );
}

export const metadata: Metadata = {
  title: 'Site Settings'
};
