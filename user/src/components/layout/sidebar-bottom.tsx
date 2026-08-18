'use client';

import SidebarHelpMenu from './navigation/sidebar-help-menu';
import SidebarPreferencesMenu from './navigation/sidebar-preferences-menu';
import SidebarServicesMenu from './navigation/sidebar-services-menu';

export default function SidebarBottom() {
  return (
    <div className="relative flex items-center justify-center gap-1 py-2">
      <SidebarPreferencesMenu />
      <SidebarServicesMenu />
      <SidebarHelpMenu />
    </div>
  );
}
