'use client';

import { Loader } from '@layout/components';
import { Button, Form } from 'antd';
import { FormInstance } from 'antd/lib/form';
import React, { useEffect, useEffectEvent, useRef } from 'react';
import { ISetting } from 'src/interfaces';

import { useFormValidation } from '../hooks/use-form-validation';
import { useSettingsData } from '../hooks/use-settings-data';
import { FileUploadRenderer } from './file-upload-renderer';
import { FormItemRenderer } from './form-item-renderer';
import { SettingsMenu } from './settings-menu';

interface SettingsFormProps {
  selectedTab: string;
}

const layoutConfig = {
  labelCol: { span: 24 },
  wrapperCol: { span: 24 }
};

export const SettingsForm: React.FC<SettingsFormProps> = ({ selectedTab }) => {
  const formRef = useRef<FormInstance>(null);

  const { list, dataChange, loadingSettings, errorSettings, refetchSettings } =
    useSettingsData({ selectedTab });

  const { submit } = useFormValidation({
    dataChange,
    refetchSettings,
    errorSettings
  });

  const setVal = (field: string, val: any) => {
    dataChange.current[field] = val;
  };

  // Update form fields when data is loaded
  const setFormValues = useEffectEvent(() => {
    if (formRef.current && list.length > 0) {
      const formValues: Record<string, any> = {};
      list.forEach(s => {
        formValues[s.key] = s.value;
      });
      formRef.current.setFieldsValue(formValues);
    }
  });

  useEffect(() => {
    setFormValues();
  }, [list]);

  if (loadingSettings) {
    return <Loader spinning />;
  }

  return (
    <>
      <SettingsMenu selectedTab={selectedTab} />

      <Form
        {...layoutConfig}
        key={`${selectedTab}-${list.length}`}
        layout="horizontal"
        initialValues={list.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {})}
        onFinish={submit}
        ref={formRef}
        labelCol={{ span: 24 }}
        wrapperCol={{ span: 24 }}
      >
        {list.map((setting: ISetting) => (
          <div key={setting._id}>
            <FormItemRenderer
              setting={setting}
              onValueChange={setVal}
            />
            <FileUploadRenderer setting={setting} formRef={formRef} onValueChange={setVal} />
          </div>
        ))}

        <div key="submit-button" className="bottom-form">
          <Button
            type="primary"
            htmlType="submit"
            disabled={loadingSettings}
            loading={loadingSettings}
          >
            Submit
          </Button>
        </div>
      </Form>
    </>
  );
};
