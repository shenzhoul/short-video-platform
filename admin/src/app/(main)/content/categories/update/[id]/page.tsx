import { CategoryUpdate } from '@components/category';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Edit Post Category',
  description: 'Rename, describe, reorder or disable a content category.'
};

export default async function CategoryUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CategoryUpdate id={id} />;
}
