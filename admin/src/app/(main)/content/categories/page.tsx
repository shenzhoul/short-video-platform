import { CategoryList } from '@components/category';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Post Categories',
  description: 'Manage the content categories creators can file posts under.'
};

export default async function CategoriesPage() {
  return <CategoryList />;
}
