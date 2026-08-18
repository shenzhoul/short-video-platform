'use client';

import Nl2br from '@components/common/nl2br';
import { Form, Input, InputNumber, Switch } from 'antd';
import React from 'react';
import { ISetting } from 'src/interfaces';

interface FormItemRendererProps {
  setting: ISetting;
  onValueChange: (field: string, val: any) => void;
}

export const FormItemRenderer: React.FC<FormItemRendererProps> = ({
  setting,
  onValueChange
}) => {
  let type = setting.type;

  switch (type) {
    case 'number':
      return (
        <Form.Item
          key={setting._id}
          name={setting.key}
          label={setting.name}
          help={<Nl2br text={setting.description} />}
          extra={setting.extra}
        >
          <InputNumber
            style={{ width: '100%' }}
            onChange={(val) => onValueChange(setting.key, val)}
            min={typeof setting.meta?.min === 'number' ? setting.meta.min : Number.MIN_SAFE_INTEGER}
            max={typeof setting.meta?.max === 'number' ? setting.meta.max : Number.MAX_SAFE_INTEGER}
            step={typeof setting.meta?.step === 'number' ? setting.meta.step : 1}
          />
        </Form.Item>
      );

    case 'boolean':
      return (
        <Form.Item
          key={setting._id}
          name={setting.key}
          label={setting.name}
          help={<Nl2br text={setting.description} />}
          valuePropName="checked"
        >
          <Switch
            onChange={(val) => onValueChange(setting.key, val)}
          />
        </Form.Item>
      );

    default:
      return (
        <Form.Item
          key={setting._id}
          name={setting.key}
          label={setting.name}
          help={<Nl2br text={setting.description} />}
          extra={setting.extra}
        >
          <Input
            onChange={(e) => onValueChange(setting.key, e.target.value)}
          />
        </Form.Item>
      );
  }
};
