'use client';

import { appMessage as message } from '@lib/antd-message';
import { getResponseError } from '@lib/utils';
import { authService } from '@services/auth.service';
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  Row
} from 'antd';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useConfig } from 'src/context/config.context';
import { getThemedLogo } from 'src/lib/logo';
import { useTheme } from 'src/providers/theme-provider';

import style from './login.module.scss'

export default function FormForgot() {
  const route = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>();
  const [logoHydrated, setLogoHydrated] = useState(false);
  const config = useConfig();
  const { theme } = useTheme();
  const siteLogo = getThemedLogo(config, logoHydrated ? theme : 'light');

  useEffect(() => {
    setLogoHydrated(true);
  }, []);

  const onFinish = async (email: string) => {
    try {
      setLoading(true);
      await authService.resetPassword({ email });
      message.success('Please check inbox for password reset instructions.');
      setLoading(false);
      route.push('/auth/login');
    } catch (_error) {
      setError(getResponseError(await Promise.resolve(_error)) || 'Account not found, please recheck the email.');
      setLoading(false);
    }
  };

  return (
    <div className={style['login-box']}>
      <div className={style['login-form']}>
        <Row gutter={[0, 0]} justify="space-around">
          <Col
            xs={{ span: 24, offset: 0 }}
            lg={{ span: 6, offset: 2 }}
            md={{ span: 12 }}
            style={{ margin: '70px 0 0 0', maxWidth: '100%' }}
          >
            <Image
              src={siteLogo}
              alt="logo"
              width={300}
              height={120}
              style={{
            objectFit: 'contain',
            display: 'block',
            margin: '0 auto'
          }}
            />
            <h3 className="font-regular text-muted text-center">
              ADMIN PANEL
            </h3>
            <Form
              onFinish={(e) => onFinish(e.email)}
              layout="vertical"
              className="row-col"
            >
              <Form.Item
                className="email"
                label="Email address"
                name="email"
                rules={[
              {
                required: true,
                message: 'Please enter email address.'
              },
              {
                type: 'email',
                message: 'The input is not valid E-mail!'
              }
            ]}
              >
                <Input style={{ height: '50px' }} placeholder="youremail@example.com" />
              </Form.Item>
              {error ? (
                <Form.Item>
                  <Alert showIcon type="error" message={error} />
                </Form.Item>
              )
                : null}
              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  style={{ width: '100%' }}
                  loading={loading}
                >
                  SUBMIT
                </Button>
              </Form.Item>
              <Form.Item>
                <Link href="/auth/login" className="text-dark font-bold" style={{}}>
                  <Button block>Login</Button>
                </Link>
              </Form.Item>
            </Form>
          </Col>
        </Row>
      </div>
    </div>
  );
}
