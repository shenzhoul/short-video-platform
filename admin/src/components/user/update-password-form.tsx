'use client'
import { appMessage as message } from '@lib/antd-message';
import { hashPassword } from '@lib/crypto';
import { Button, Form, Input } from 'antd';

const layout = {
  labelCol: { span: 24 },
  wrapperCol: { span: 24 }
};

interface IProps {
  onFinish: Function;
  updating: boolean;
}

export function UpdatePasswordForm({ onFinish, updating }: IProps) {
  /**
   * Handle password form submission with SHA256 hashing
   * Hash password before sending to server to match API expectations
   */
  const handlePasswordSubmit = async (values: any) => {
    try {
      // Hash the password with SHA256 before sending to server
      if (values.password) {
        values.password = await hashPassword(values.password);
      }

      // Call the original onFinish handler with hashed password
      onFinish(values);
    } catch {
      message.error('Failed to process password');
    }
  };

  return (
    <Form name="password-messages" onFinish={handlePasswordSubmit} {...layout}>
      <Form.Item
        name="password"
        label="Password"
        rules={[
          { required: true, message: 'Please input your password!' },
          { min: 8, message: 'Enter password of at least 8 characters' },
          {
            pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/,
            message: 'Password must have at least 1 number, 1 uppercase, 1 lowercase, 1 special character'
          }
        ]}
      >

        <Input.Password placeholder="Password must have at least 1 number, 1 uppercase, 1 lowercase, 1 special character" />
      </Form.Item>
      <Form.Item
        name="passwordConfirm"
        label="Confirm Password"
        rules={[
          { required: true, message: 'Please input your confirm password!' },
          { min: 8, message: 'Enter password of at least 8 characters' },
          ({ getFieldValue }) => ({
            validator(rule, value) {
              if (!value || getFieldValue('password') === value) {
                return Promise.resolve();
              }

              return Promise.reject('Passwords do not match!');
            }
          })
        ]}
      >
        <Input.Password placeholder="Confirm your password" />
      </Form.Item>

      <Form.Item className="text-center">
        <Button type="primary" htmlType="submit" loading={updating}>
          Update
        </Button>
      </Form.Item>
    </Form>
  );
}
