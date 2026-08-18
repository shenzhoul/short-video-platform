import SearchResults from '@components/search/search-results';

export const dynamic = 'force-dynamic';

interface SearchPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const query = typeof q === 'string' ? q : '';

  if (!query.trim()) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center text-sm text-(--text-muted)">
        Type something in the search bar to get started.
      </div>
    );
  }

  return <SearchResults query={query} />;
}

export async function generateMetadata({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const query = typeof q === 'string' ? q : '';
  return { title: query ? `${query} - Search` : 'Search' };
}
