'use client';

import { EyeInvisibleOutlined, EyeTwoTone } from '@ant-design/icons';
import { hashPassword } from '@lib/crypto';
import { getRedirectUrl, removeRedirectUrl, setRedirectUrl } from '@lib/local-storage';
import { getResponseError } from '@lib/utils';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input
} from 'antd';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useEffect, useEffectEvent, useState } from 'react';
import { useConfig } from 'src/context/config.context';
import { getThemedLogo } from 'src/lib/logo';
import { useTheme } from 'src/providers/theme-provider';

import style from './login.module.scss';

const passwordIconRender = (visible: boolean) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />);

export default function FormLogin() {
  const searchParams = useSearchParams();
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>();
  const [logoHydrated, setLogoHydrated] = useState(false);
  const config = useConfig();
  const { theme } = useTheme();
  const siteLogo = getThemedLogo(config, logoHydrated ? theme : 'light');

  useEffect(() => {
    setLogoHydrated(true);
  }, []);

  const doSearch = useEffectEvent(() => {
    if (searchParams) {
      const redirectUrl = searchParams.get('redirectUrl');
      if (redirectUrl) {
        setRedirectUrl(redirectUrl);
      }
    }
  });

  useEffect(() => {
    if (searchParams) doSearch();
  }, [searchParams]);

  const onSubmit = async (data: any) => {
    try {
      setLoading(true);
      setError(null);

      // Hash password on client-side before sending
      const hashedPassword = await hashPassword(data.password);

      const result = await signIn('credentials', {
        username: data.username,
        password: hashedPassword,
        redirect: false
      });

      if (result?.error) {
        setError('Your username/email or password is incorrect. Please recheck.');
      } else if (result?.ok) {
        // Force a small delay to ensure session/cookie is set
        await new Promise(resolve => setTimeout(resolve, 100));

        const redirectUrl = getRedirectUrl();
        if (redirectUrl) {
          window.location.href = redirectUrl;
          removeRedirectUrl();
        } else {
          window.location.href = '/dashboard';
        }
      }
    } catch (e) {
      setError(getResponseError(await Promise.resolve(e)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={style['login-box']}>
      <div className={style['login-form']}>
        <Image src={siteLogo} alt="logo" unoptimized width={300} height={120} className={style['logo']} />
        <h3 className="font-regular text-muted text-center">ADMIN PANEL</h3>
        <Form
          onFinish={onSubmit}
          layout="vertical"
          className="row-col"
          style={{
            padding: 25
          }}
        >
          <Form.Item
            className="username"
            label="Email address or Username"
            name="username"
            rules={[
              {
                required: true,
                message: 'Please input your email address or username!'
              }
            ]}
          >
            <Input style={{ height: '40px' }} placeholder="Email or username" />
          </Form.Item>

          <Form.Item
            className="password"
            label="Password"
            name="password"
            rules={[
              {
                required: true,
                message: 'Please input your password!'
              }
            ]}
          >
            <Input.Password placeholder="Password" iconRender={passwordIconRender} style={{ height: '40px' }} />
          </Form.Item>

          <Form.Item name="remember" className="align-center a" valuePropName="checked">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Checkbox onChange={() => setRemember(!remember)}>Remember me</Checkbox>

              <Link href="/auth/forgot" className="font-bold">
                Forgot Password?
              </Link>
            </div>
          </Form.Item>
          {error ? (
            <Form.Item>
              <Alert showIcon type="error" title={error} />
            </Form.Item>
          )
            : null}
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              style={{ width: '100%', height: '40px' }}
              loading={loading}
              disabled={loading}
            >
              SIGN IN
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
}
