import { CategoryCreate } from '@components/category';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create Post Category',
  description: 'Add a new content category for creators to file posts under.'
};

export default async function CategoryCreatePage() {
  return <CategoryCreate />;
}
