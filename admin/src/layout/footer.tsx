'use client';

import { Layout } from '@lib/antd';

function Footer() {
  const { Footer: AntFooter } = Layout;

  return (
    <AntFooter>
      <p className="copyright text-center">
        Copyright ©
        {new Date().getFullYear()}
        {' '}
        - Version 1.0.0
      </p>
    </AntFooter>
  );
}

export default Footer;
