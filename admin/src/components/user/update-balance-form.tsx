import { Button, Form, Input, InputNumber, Space, Typography } from 'antd';

const { Text } = Typography;

const layout = {
  labelCol: { span: 6 },
  wrapperCol: { span: 18 }
};

interface IProps {
  // onFinish: Function;
  // currentBalance: number;
  updating: boolean;
  userName?: string;
}

export function UpdateBalanceForm({
  // onFinish,
  // currentBalance,
  updating,
  userName = ''
}: IProps) {
  const [form] = Form.useForm();

  const handleFormSubmit = (values: any) => {
    // Transform the form data to match API expectations
    const payload = {
      amount: values.amount,
      note: values.note,
      reason: values.reason
    };
    // onFinish(payload);
  };

  return (
    <Form
      form={form}
      name="update-balance-form"
      onFinish={handleFormSubmit}
      {...layout}
      initialValues={{
        amount: 0,
        reason: '',
        note: ''
      }}
    >
      {/* Current Balance Display */}
      <Form.Item label="Current Balance">
        <Text strong style={{ fontSize: '16px', color: '#1890ff' }}>
          {/* ${currentBalance?.toFixed(2) || '0.00'} */}
        </Text>
        {userName ? (
          <Text type="secondary" style={{ marginLeft: 8 }}>
            for {userName}
          </Text>
        ) : null}
      </Form.Item>

      {/* Amount Adjustment */}
      <Form.Item
        label="Amount Adjustment"
        extra="Enter positive amount to add balance, negative amount to deduct balance"
      >
        <Form.Item
          name="amount"
          noStyle
          rules={[
            {
              required: true,
              message: 'Please enter the adjustment amount!'
            },
            {
              type: 'number',
              min: -10000,
              message: 'Amount cannot be less than -$10,000!'
            },
            {
              type: 'number',
              max: 10000,
              message: 'Amount cannot exceed $10,000!'
            },
            {
              validator: (_, value) => {
                if (value === 0) {
                  return Promise.reject('Amount cannot be zero!');
                }
                return Promise.resolve();
              }
            }
          ]}
        >
          <InputNumber
            style={{ width: '100%' }}
            placeholder="Enter amount (e.g., 25.00 to add, -25.00 to deduct)"
            min={-10000}
            max={10000}
            precision={2}
            prefix="$"
          />
        </Form.Item>
      </Form.Item>

      {/* Reason */}
      <Form.Item
        name="reason"
        label="Reason"
        rules={[
          {
            max: 100,
            message: 'Reason cannot exceed 100 characters!'
          }
        ]}
        extra="Brief reason for the balance adjustment"
      >
        <Input
          placeholder="e.g., Refund, Bonus, Compensation"
          maxLength={100}
          showCount
        />
      </Form.Item>

      {/* Notes */}
      <Form.Item
        name="note"
        label="Admin Notes"
        rules={[
          {
            max: 500,
            message: 'Notes cannot exceed 500 characters!'
          }
        ]}
        extra="Optional detailed notes for internal record keeping"
      >
        <Input.TextArea
          placeholder="Additional details about this balance adjustment..."
          maxLength={500}
          rows={3}
          showCount
        />
      </Form.Item>

      {/* Submit Button */}
      <Form.Item wrapperCol={{ ...layout.wrapperCol, offset: 6 }}>
        <Space>
          <Button type="primary" htmlType="submit" loading={updating}>
            Adjust Balance
          </Button>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            This action will create a system transaction record
          </Text>
        </Space>
      </Form.Item>
    </Form>
  );
}

export default UpdateBalanceForm;
