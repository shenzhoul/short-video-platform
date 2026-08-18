export interface ISetting {
  _id: string;
  key: string;
  value: any;
  name: string;
  description: string;
  group: string;
  public: boolean;
  type: string;
  visible: boolean;
  autoload: boolean;
  meta?: { [key: string]: any };
  createdAt: Date;
  updatedAt: Date;
  extra?: string;
}

export interface IPublicSetting {
  // Legacy support - will be automatically resolved to new structure
  siteName?: string;
  logoUrl?: string;
  favicon?: string;

  // New domain-based structure
  'site.identity.name'?: string;
  'site.identity.logoUrl'?: string;
  'site.identity.whiteLogoUrl'?: string;
  'site.identity.faviconUrl'?: string;
  'site.identity.pageLoadingIconUrl'?: string;
  'site.maintenance.enabled'?: boolean;
  'site.maintenance.imageUrl'?: string;
}
