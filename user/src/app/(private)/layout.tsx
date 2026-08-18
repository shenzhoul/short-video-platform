import CreatorThemeLayout from '@components/layout/creator/creator-theme-layout';
import { ReactNode } from 'react';

interface Layout {
  children: ReactNode;
}

/**
 * Every route in this group is Creator Management — publishing and managing your own content — so
 * the whole group gets the creator sidebar rather than the Home one.
 *
 * If a protected page that is *not* creator management is ever added here, move this layout down to
 * a nested `(creator)` group instead of widening what it wraps.
 */
export default function PrivateLayout({ children }: Layout) {
  return (
    <main>
      <CreatorThemeLayout>
        {children}
      </CreatorThemeLayout>
    </main>
  );
}
