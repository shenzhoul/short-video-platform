import MainThemeLayout from '@components/layout/main';
import { ReactNode } from 'react';

interface Layout {
  children: ReactNode;
}

/**
 * Authenticated pages that are *not* creator management.
 *
 * They belong to the normal browsing experience — same header, same left
 * navigation, same content column — so they use the Home shell rather than the
 * creator sidebar next door in `(creator)`.
 */
export default function PrivateAppLayout({ children }: Layout) {
  return (
    <main>
      <MainThemeLayout>
        {children}
      </MainThemeLayout>
    </main>
  );
}
