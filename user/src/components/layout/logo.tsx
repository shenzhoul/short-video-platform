'use client';
import { useMainThemeLayout } from '@providers/main-layout.provider';
import { ThemeContext } from '@providers/ThemeProvider';
import Link from 'next/link';
import { useContext } from 'react';

interface IProps {
  className?: string;
  height?: string;
  white?: boolean;
}

export default function Logo({ className, height, white }: IProps) {
  const themeContext = useContext(ThemeContext);
  const { publicSettings } = useMainThemeLayout();
  const logoUrl = publicSettings?.logoUrl || '';
  const logoWhite = publicSettings?.logoWhite || '';
  const siteName = publicSettings?.siteName || 'Douyin-clone';
  const shouldUseWhiteLogo = white ?? (themeContext?.theme === 'dark');
  const logoSrc = shouldUseWhiteLogo ? (logoWhite || logoUrl) : logoUrl;

  return (
    <Link href="/" className={`flex items-center ${className || ''}`}>
      {logoSrc ? (
        <img
          src={logoSrc}
          alt={siteName}
          title={siteName}
          className={`w-auto object-contain ${height ? height : ''}`}
        />
      ) : (
        <div className="md:text-3xl text-2xl font-bold">{siteName}</div>
      )}
    </Link>
  );
}
