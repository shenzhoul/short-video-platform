'use client';

import { CategoryForm } from '@components/category/category-form';
import { toast } from '@douyin-clone/shared-toast';
import { Breadcrumb as BreadcrumbComponent, Page } from '@layout/components';
import { categoryService } from '@services/category.service';
import { Spin } from 'antd';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ICategory } from 'src/interfaces';

export default function CategoryUpdate({ id }: { id: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<ICategory | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await categoryService.findById(id);
        if (!cancelled) setCategory(response.data);
      } catch (error: any) {
        if (!cancelled) toast.error(error?.message || 'Failed to load this category');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
 cancelled = true;
};
  }, [id]);

  const handleSubmit = useCallback(async (values: any) => {
    setSubmitting(true);
    try {
      // `key` is disabled in the form and ignored by the API; sending the rest keeps the payload
      // honest about what an update can actually change.
      const { key, ...updatable } = values;
      await categoryService.update(id, updatable);
      toast.success('Category updated');
      router.push('/content/categories');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update this category, please try again!');
      setSubmitting(false);
    }
  }, [id, router]);

  return (
    <Page>
      <BreadcrumbComponent
        breadcrumbs={[
          { title: 'Content' },
          { title: 'Categories', href: '/content/categories' },
          { title: category?.name || 'Edit Category' }
        ]}
      />
      {loading || !category
        ? <Spin />
        : (
          <CategoryForm
            category={category}
            onSubmit={handleSubmit}
            submitting={submitting}
            submitText="Save changes"
          />
        )}
    </Page>
  );
}
