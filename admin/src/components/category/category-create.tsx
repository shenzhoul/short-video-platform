'use client';

import { CategoryForm } from '@components/category/category-form';
import { toast } from '@douyin-clone/shared-toast';
import { Breadcrumb as BreadcrumbComponent, Page } from '@layout/components';
import { categoryService } from '@services/category.service';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

export default function CategoryCreate() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async (values: any) => {
    setSubmitting(true);
    try {
      await categoryService.create(values);
      toast.success('Category created');
      router.push('/content/categories');
    } catch (error: any) {
      // A duplicate key comes back as a 409 with its own message. It is surfaced verbatim rather
      // than retried with a generated suffix, so the admin picks the key themselves.
      toast.error(error?.message || 'Failed to create this category, please try again!');
      setSubmitting(false);
    }
  }, [router]);

  return (
    <Page>
      <BreadcrumbComponent
        breadcrumbs={[
          { title: 'Content' },
          { title: 'Categories', href: '/content/categories' },
          { title: 'Create Category' }
        ]}
      />
      <CategoryForm onSubmit={handleSubmit} submitting={submitting} submitText="Create category" />
    </Page>
  );
}
