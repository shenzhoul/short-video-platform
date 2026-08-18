type ThemeMode = 'light' | 'dark';

type LogoSettings = {
  'site.identity.logoUrl'?: string;
  'site.identity.whiteLogoUrl'?: string;
};

export function getThemedLogo(config: LogoSettings, theme: ThemeMode = 'light') {
  const logoUrl = config['site.identity.logoUrl'];
  const whiteLogoUrl = config['site.identity.whiteLogoUrl'];

  return theme === 'dark'
    ? whiteLogoUrl || '/logo.png'
    : logoUrl || '/logo.png';
}
