import HomeLandingWrapper from '@components/landing/home-landing-wrapper';
import MainThemeLayout from '@components/layout/main';
import { getSettingsByKeys } from '@services/setting.service';
import { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const meta = await getSettingsByKeys([
    'site.seo.homeMetaKeywords',
    'site.seo.homeMetaDescription',
    'site.seo.homeTitle',
    'site.seo.homeCanonicalUrl'
  ]);

  return {
    title: meta['site.seo.homeTitle'] || 'Home',
    description: meta['site.seo.homeMetaDescription'] || '',
    keywords: meta['site.seo.homeMetaKeywords'] || '',
    alternates: {
      canonical: meta['site.seo.homeCanonicalUrl'] || process.env.BASE_URL || ''
    }
  };
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ viewport: string }> }) {
  return (
    <main>
      <MainThemeLayout>
        <HomeLandingWrapper searchParams={searchParams} />
      </MainThemeLayout>
    </main>
  );
}
