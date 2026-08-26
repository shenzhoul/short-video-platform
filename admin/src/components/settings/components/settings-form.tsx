'use client';

import { Loader } from '@layout/components';
import { Button, Form } from 'antd';
import { FormInstance } from 'antd/lib/form';
import React, { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ISetting } from 'src/interfaces';

import { useFormValidation } from '../hooks/use-form-validation';
import { useSettingsData } from '../hooks/use-settings-data';
import { useSettingsSections } from '../hooks/use-settings-sections';
import { FileUploadRenderer } from './file-upload-renderer';
import { FormItemRenderer } from './form-item-renderer';
import { SettingsMenu } from './settings-menu';
import { SettingsSections } from './settings-sections';

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

  const { groups, activeSection, sections, selectSection } = useSettingsSections(list);

  // `dataChange` is a ref, so the "unsaved changes" notice needs its own state to
  // re-render. It is derived from the ref rather than duplicating it, so the two
  // cannot disagree about what is pending.
  const [pendingCount, setPendingCount] = useState(0);

  const setVal = (field: string, val: any) => {
    dataChange.current[field] = val;
    setPendingCount(Object.keys(dataChange.current).length);
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
    // A refetch clears the pending map in useSettingsData; read it back rather
    // than assuming zero, so a reload that arrives mid-edit stays honest.
    setPendingCount(Object.keys(dataChange.current).length);
  });

  useEffect(() => {
    setFormValues();
  }, [list]);

  if (loadingSettings) {
    return <Loader spinning />;
  }

  const renderSetting = (setting: ISetting) => (
    <div key={setting._id}>
      <FormItemRenderer
        setting={setting}
        onValueChange={setVal}
      />
      <FileUploadRenderer setting={setting} formRef={formRef} onValueChange={setVal} />
    </div>
  );

  // Fields outside the active section stay mounted-in-value but unrendered.
  // antd keeps an unmounted field's value (`Form` preserves by default), and
  // `dataChange` is untouched by the switch, so an edit made in one section is
  // still submitted after moving to another.
  const visibleSettings = activeSection ? activeSection.settings : list;

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
        {sections.length && activeSection ? (
          <SettingsSections
            key="settings-sections"
            groups={groups}
            activeSection={activeSection}
            onSelect={selectSection}
            pendingCount={pendingCount}
          >
            {visibleSettings.map(renderSetting)}
          </SettingsSections>
        ) : (
          <React.Fragment key="settings-fields">
            {visibleSettings.map(renderSetting)}
          </React.Fragment>
        )}

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
