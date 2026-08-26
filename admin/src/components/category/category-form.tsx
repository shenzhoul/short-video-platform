'use client';

import { Button, Form, Input, InputNumber, Select, Space, Tooltip } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { ICategory } from 'src/interfaces';

const KEY_MAX_LENGTH = 50;
const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 500;
const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Derive a key suggestion from a display name.
 *
 * Only ever used to pre-fill the field on create, and only while the admin has not typed a key of
 * their own — the value that gets saved is whatever is in the input when they submit. The server
 * validates it independently, so this is a convenience and never the authority.
 */
export function suggestCategoryKey(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, KEY_MAX_LENGTH);
}

interface CategoryFormProps {
  category?: ICategory;
  onSubmit: (values: any) => void;
  submitting?: boolean;
  submitText?: string;
  cancelHref?: string;
}

export function CategoryForm({
  category = undefined,
  onSubmit,
  submitting = false,
  submitText = 'Save',
  cancelHref = '/content/categories'
}: CategoryFormProps) {
  const [form] = Form.useForm();
  const isEdit = Boolean(category);

  // Once the admin edits the key themselves, the name stops driving it. Otherwise a later change to
  // the name would quietly overwrite the identifier they deliberately chose.
  const [keyTouched, setKeyTouched] = useState(isEdit);

  useEffect(() => {
    if (category) form.setFieldsValue(category);
  }, [category, form]);

  const handleNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (isEdit || keyTouched) return;
    form.setFieldValue('key', suggestCategoryKey(event.target.value));
  }, [form, isEdit, keyTouched]);

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={category || { name: '', description: '', status: 'active', ordering: 0 }}
      onFinish={onSubmit}
    >
      <Form.Item
        name="name"
        label="Name"
        tooltip="Shown to creators in the topic picker and on the home category bar. Safe to change at any time."
        rules={[
          { required: true, message: 'Enter a category name' },
          { max: NAME_MAX_LENGTH, message: `Name cannot exceed ${NAME_MAX_LENGTH} characters` }
        ]}
      >
        <Input
          placeholder="e.g. Street food"
          maxLength={NAME_MAX_LENGTH}
          showCount
          onChange={handleNameChange}
        />
      </Form.Item>

      <Form.Item
        name="key"
        label="Key"
        tooltip={isEdit
          ? 'Posts filed under this category store this key, so it cannot be changed. To retire a key, disable this category and create a new one.'
          : 'The permanent identifier stored on every post filed under this category. Suggested from the name — edit it now if you want something different, because it cannot be changed later.'}
        rules={isEdit ? [] : [
          { required: true, message: 'Enter a category key' },
          { max: KEY_MAX_LENGTH, message: `Key cannot exceed ${KEY_MAX_LENGTH} characters` },
          {
            pattern: KEY_PATTERN,
            message: 'Use lowercase letters, digits and single hyphens (e.g. street-food)'
          }
        ]}
      >
        {isEdit
          ? <Input disabled />
          : (
            <Input
              placeholder="street-food"
              maxLength={KEY_MAX_LENGTH}
              onChange={() => setKeyTouched(true)}
            />
          )}
      </Form.Item>

      <Form.Item
        name="description"
        label="Description"
        tooltip="Internal note about what belongs here. Not shown to creators."
        rules={[{ max: DESCRIPTION_MAX_LENGTH, message: `Description cannot exceed ${DESCRIPTION_MAX_LENGTH} characters` }]}
      >
        <Input.TextArea rows={3} maxLength={DESCRIPTION_MAX_LENGTH} showCount placeholder="Optional" />
      </Form.Item>

      <Form.Item
        name="status"
        label="Status"
        tooltip="Disabled categories disappear from the topic picker and the home category bar. Posts already filed under them are unaffected."
        rules={[{ required: true, message: 'Choose a status' }]}
      >
        <Select
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Disabled' }
          ]}
        />
      </Form.Item>

      <Form.Item
        name="ordering"
        label="Display order"
        tooltip="Lower numbers appear first. The seeded categories are spaced ten apart so a new one can be slotted between two of them."
        rules={[{ type: 'number', min: 0, max: 9999, message: 'Display order must be between 0 and 9999' }]}
      >
        <InputNumber min={0} max={9999} style={{ width: '100%' }} />
      </Form.Item>

      <Space>
        <Button type="primary" htmlType="submit" loading={submitting} disabled={submitting} size="large">
          {submitText}
        </Button>
        <Tooltip title="Discard changes">
          <Button href={cancelHref} disabled={submitting} size="large">Cancel</Button>
        </Tooltip>
      </Space>
    </Form>
  );
}

export default CategoryForm;
