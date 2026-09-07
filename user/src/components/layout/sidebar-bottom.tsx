'use client';

import SidebarHelpMenu from './navigation/sidebar-help-menu';
import SidebarPreferencesMenu from './navigation/sidebar-preferences-menu';
import SidebarServicesMenu from './navigation/sidebar-services-menu';

export default function SidebarBottom() {
  return (
    /*
      Three menu triggers side by side need ~120px; the compact rail has 56.
      They stack instead of being dropped — preferences, services and help are
      the only route to theme, language and support from the shell.
    */
    <div className="relative flex items-center justify-center gap-1 py-2 max-lg:flex-col max-lg:gap-0 max-lg:py-1 max-lg:[&_svg]:text-base max-lg:[&_button]:h-6 max-lg:[&_button]:w-6">
      <SidebarPreferencesMenu />
      <SidebarServicesMenu />
      <SidebarHelpMenu />
    </div>
  );
}
