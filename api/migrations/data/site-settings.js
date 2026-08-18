module.exports = [
  {
    oldKey: 'siteName',
    newData: {
      key: 'site.identity.name',
      value: 'Douyin Clone',
      name: 'Site name',
      description: 'Global name',
      type: 'text',
      public: true,
      autoload: true,
      group: 'site',
      editable: true,
      visible: true,
      ordering: 1
    }
  },
  {
    oldKey: 'logoUrl',
    newData: {
      key: 'site.identity.logoUrl',
      value: '',
      name: 'Logo',
      description: 'Site logo',
      type: 'text',
      public: true,
      autoload: true,
      group: 'site',
      editable: true,
      visible: true,
      meta: { upload: true, image: true },
      ordering: 2
    }
  },
  {
    oldKey: 'whiteLogoUrl',
    newData: {
      key: 'site.identity.whiteLogoUrl',
      value: '',
      name: 'White Logo',
      description: 'Site white logo',
      type: 'text',
      public: true,
      autoload: true,
      group: 'site',
      editable: true,
      visible: true,
      meta: { upload: true, image: true },
      ordering: 3
    }
  },
  {
    oldKey: 'favicon',
    newData: {
      key: 'site.identity.faviconUrl',
      value: '',
      name: 'Favicon',
      description: 'Site Favicon',
      type: 'text',
      public: true,
      autoload: true,
      group: 'site',
      editable: true,
      visible: true,
      meta: { upload: true, image: true },
      ordering: 4
    }
  },
  {
    oldKey: 'pageLoadingIconUrl',
    newData: {
      key: 'site.identity.pageLoadingIconUrl',
      value: '',
      name: 'Page loading icon',
      description: 'Loading icon when navigating',
      type: 'text',
      public: true,
      autoload: true,
      group: 'site',
      editable: true,
      visible: true,
      meta: { upload: true, image: true },
      ordering: 5
    }
  },
  {
    oldKey: 'maintenanceMode',
    newData: {
      key: 'site.maintenance.enabled',
      value: false,
      name: 'Maintenance Mode',
      description: 'If active, website will show up as being under maintenance.',
      type: 'boolean',
      public: true,
      autoload: true,
      group: 'site',
      editable: true,
      visible: true,
      ordering: 6
    }
  },
  {
    oldKey: 'maintenanceImageUrl',
    newData: {
      key: 'site.maintenance.imageUrl',
      value: '',
      name: 'Maintenance Image',
      description: 'Image to display when website is under maintenance.',
      type: 'text',
      public: true,
      autoload: true,
      group: 'site',
      editable: true,
      visible: true,
      meta: { upload: true, image: true },
      ordering: 7
    }
  }
];
