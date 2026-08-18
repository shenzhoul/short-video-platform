import MainThemeLayout from '@components/layout/main';

interface Layout {
  children: React.ReactNode;
}
export default async function MainLayout({ children }: Layout) {
  return (
    <main>
      <MainThemeLayout>
        {children}
      </MainThemeLayout>
    </main>
  );
}
