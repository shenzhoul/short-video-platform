'use client';

import { AvatarUploader } from '@components/user/avatar-uploader';
import { appMessage as message } from '@lib/antd-message';
import { hashPassword } from '@lib/crypto';
import { userService } from '@services/user.service';
import { Button, Col, Form, Input, InputNumber, Row, Select, Switch } from 'antd';
import { IUser } from 'src/interfaces';

const layout = {
  labelCol: { span: 24 },
  wrapperCol: { span: 24 }
};

const validateMessages = {
  required: 'This field is required!',
  types: {
    email: 'Not a valid email!',
    number: 'Not a valid number!'
  },
  number: {
    range: 'Must be between ${min} and ${max}'
  }
};

interface IProps {
  onFinish: Function;
  user?: IUser;
  updating?: boolean;
  options?: {
    onAvatarUploaded?: Function;
    beforeUpload?: Function;
    avatarUrl?: string;
  };
}

export function AccountForm({
  onFinish,
  user = undefined,
  updating = false,
  options = {}
}: IProps) {
  const { beforeUpload, onAvatarUploaded } = options;
  const MAX_SIZE_IMAGE = Number(process.env.NEXT_PUBLIC_MAX_SIZE_IMAGE) || 5;

  /**
   * Handle form submission with password hashing
   * Hash passwords with SHA256 before sending to server to match API expectations
   */
  const handleFormSubmit = async (values: any) => {
    try {
      // If password is provided (for new users), hash it with SHA256
      if (values.password) {
        values.password = await hashPassword(values.password);
      }

      // Call the original onFinish handler with processed values
      onFinish(values);
    } catch (error) {
      message.error('Failed to process form data');
      console.error('Form submission error:', error);
    }
  };

  return (
    <Form
      {...layout}
      name="nest-messages"
      onFinish={handleFormSubmit}
      validateMessages={validateMessages}
      initialValues={
        user || {
          country: 'US',
          status: 'active',
          gender: 'male',
          balance: 0
        }
      }
    >
      <Row gutter={[16, 0]}>
        <Col xs={12} md={12}>
          <Form.Item
            name="firstName"
            label="First Name"
            rules={[
              { required: true, message: 'Please input your first name!' },
              {
                pattern: /^[a-zA-ZàáâäãåąčćęèéêëėįìíîïłńòóôöõøùúûüųūÿýżźñçčšžÀÁÂÄÃÅĄĆČĖĘÈÉÊËÌÍÎÏĮŁŃÒÓÔÖÕØÙÚÛÜŲŪŸÝŻŹÑßÇŒÆČŠŽ∂ð ,.'-]+$/,
                message: 'First name cannot contain numbers or special characters'
              }
            ]}
          >
            <Input />
          </Form.Item>
        </Col>
        <Col xs={12} md={12}>
          <Form.Item
            name="lastName"
            label="Last Name"
            validateTrigger={['onChange', 'onBlur']}
            rules={[
              { required: true, message: 'Please input your last name!' },
              {
                pattern: /^[a-zA-ZàáâäãåąčćęèéêëėįìíîïłńòóôöõøùúûüųūÿýżźñçčšžÀÁÂÄÃÅĄĆČĖĘÈÉÊËÌÍÎÏĮŁŃÒÓÔÖÕØÙÚÛÜŲŪŸÝŻŹÑßÇŒÆČŠŽ∂ð ,.'-]+$/,
                message: 'Last name cannot contain numbers or special characters'
              }
            ]}
          >
            <Input />
          </Form.Item>
        </Col>
        <Col xs={12} md={12}>
          <Form.Item
            name="username"
            label="Username"
            rules={[
              { required: true, message: 'Username is required' },
              {
                pattern: /^[a-zA-Z0-9]+$/g,
                message: 'Username must contain only alphanumeric characters'
              },
              { min: 3, message: 'Username must have at least 3 characters' }
            ]}
          >
            <Input placeholder="Unique, lowercase alphanumeric characters" />
          </Form.Item>
        </Col>
        <Col xs={12} md={12}>
          <Form.Item
            name="name"
            label="Display Name"
            validateTrigger={['onChange', 'onBlur']}
            rules={[
              { required: true, message: 'Please input your display name!' },
              {
                pattern: /^(?=.*\S).+$/g,
                message: 'Display name cannot be empty or whitespace'
              },
              { min: 3, message: 'Display name must have at least 3 characters' },
              { max: 16, message: 'Display name must be at most 16 characters' }
            ]}
          >
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={24}>
          <Form.Item name="email" label="Email" rules={[{ type: 'email', required: true }]}>
            <Input />
          </Form.Item>
        </Col>
        <Col xs={12} md={12}>
          <Form.Item name="gender" label="Gender" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="male">Male</Select.Option>
              <Select.Option value="female">Female</Select.Option>
            </Select>
          </Form.Item>
        </Col>
        <Col xs={12} md={12}>
          <Form.Item
            name="balance"
            label="Balance"
            help="Balance cannot be edited directly. Use the Balance Management feature to adjust user balance."
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              disabled
              placeholder="Use Balance Management to adjust"
            />
          </Form.Item>
        </Col>
        {!user && (
          <>
            <Col xs={12} md={12}>
              <Form.Item
                name="password"
                label="Password"
                rules={[
                  { required: true, message: 'Please input your password!' },
                  { min: 8, message: 'Password must have at least 8 characters' }
                ]}
              >
                <Input.Password placeholder="Password" />
              </Form.Item>
            </Col>
            <Col xs={12} md={12}>
              <Form.Item
                name="confirmPassword"
                label="Confirm Password"
                validateTrigger={['onChange', 'onBlur']}

                dependencies={['password']}
                hasFeedback

                rules={[
                  { required: true, message: 'Please confirm your password!' },
                  ({ getFieldValue }) => ({
                    validator(_rule, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject('Passwords do not match!');
                    }
                  })
                ]}
              >
                <Input.Password placeholder="Confirm Password" />
              </Form.Item>
            </Col>
          </>
        )}
        <Col xs={12} md={12}>
          <Form.Item name="status" label="Status">
            <Select>
              <Select.Option value="active" key="active">
                <span style={{ color: '#52c41a' }}>✅ Active</span>
                {/* <div style={{ fontSize: '11px', color: 'var(--color-main)' }}>Full access to all features</div> */}
              </Select.Option>
              <Select.Option value="inactive" key="inactive">
                <span style={{ color: '#d9d9d9' }}>⚪ Inactive</span>
                {/* <div style={{ fontSize: '11px', color: 'var(--color-main)' }}>Account disabled</div> */}
              </Select.Option>
              <Select.Option value="under-review" key="under-review">
                <span style={{ color: '#1890ff' }}>🔍 Under Review</span>
                {/* <div style={{ fontSize: '11px', color: 'var(--color-main)' }}>Account flagged for manual investigation</div> */}
              </Select.Option>
            </Select>
          </Form.Item>
        </Col>
        <Col xs={12} md={12}>
          <Form.Item
            name="verifiedEmail"
            label="Verified Email"
            valuePropName="checked"
            help="Turn on if email account verified"
          >
            <Switch />
          </Form.Item>
        </Col>
        <Col xs={12} md={12}>
          <Form.Item label="Avatar" help={`Avatar must be smaller than ${MAX_SIZE_IMAGE}MB!`}>
            <AvatarUploader
              onFileRead={beforeUpload}
              imageUrl={user?.avatar}
              onUploaded={async (file: File) => {
                try {
                  const result = await userService.uploadAvatarUser(file);
                  onAvatarUploaded && onAvatarUploaded({ response: result });
                } catch {
                  message.error('Avatar upload failed');
                }
              }}
            />
          </Form.Item>
        </Col>
      </Row>
      <div className='bottom-form'>
        <Button type="primary" htmlType="submit" loading={updating}>
          Submit
        </Button>
      </div>
    </Form>
  );
}
