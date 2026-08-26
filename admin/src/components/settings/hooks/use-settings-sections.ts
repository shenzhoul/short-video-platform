'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { ISetting } from 'src/interfaces';

export interface SettingsSection {
  /** Stable id, used in the URL and as the menu key. */
  key: string;
  label: string;
  /** Heading this section is filed under in the rail, e.g. "Images". */
  group: string;
  /** One sentence about what this section covers, shown once above its fields. */
  note: string;
  settings: ISetting[];
}

export interface SettingsSectionGroup {
  label: string;
  sections: SettingsSection[];
}

export interface UseSettingsSectionsReturn {
  /** Empty when the group does not divide into sections; the caller then renders flat. */
  sections: SettingsSection[];
  groups: SettingsSectionGroup[];
  activeSection: SettingsSection | null;
  selectSection: (key: string) => void;
}

/**
 * Split one settings group into sections, driven entirely by `meta.section`.
 *
 * The admin app deliberately knows nothing about upload limits here. A settings
 * group divides itself by tagging its rows, so a new group — or a newly
 * registered upload type — gets its own section without this file changing.
 * Rows without `meta.section` yield no sections at all, which is how every
 * existing group keeps its flat form.
 *
 * Order comes from the settings themselves (the API sorts by `ordering`), so the
 * rail and the fields inside a section follow the order the seed intended
 * rather than an alphabetical one nobody chose.
 */
export const useSettingsSections = (list: ISetting[]): UseSettingsSectionsReturn => {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requestedSection = params?.get('section') || '';

  const sections = useMemo(() => {
    const byKey = new Map<string, SettingsSection>();

    list.forEach((setting) => {
      const key = setting.meta?.section;
      if (!key) return;

      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          label: setting.meta?.sectionLabel || key,
          group: setting.meta?.sectionGroup || 'Other',
          note: setting.meta?.sectionNote || '',
          settings: []
        });
      }
      byKey.get(key)!.settings.push(setting);
    });

    // Only worth a rail if the rows actually cover the whole group; a group that
    // tagged half its settings would otherwise hide the untagged half entirely.
    const tagged = Array.from(byKey.values()).reduce((total, s) => total + s.settings.length, 0);
    if (!byKey.size || tagged !== list.length) return [];

    return Array.from(byKey.values());
  }, [list]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, SettingsSectionGroup>();

    sections.forEach((section) => {
      if (!byGroup.has(section.group)) {
        byGroup.set(section.group, { label: section.group, sections: [] });
      }
      byGroup.get(section.group)!.sections.push(section);
    });

    return Array.from(byGroup.values());
  }, [sections]);

  // A `?section=` naming something that no longer exists — a bookmarked link to
  // a removed upload type — falls back to the first section rather than
  // rendering an empty pane.
  const activeSection = useMemo(() => {
    if (!sections.length) return null;
    return sections.find((section) => section.key === requestedSection) || sections[0];
  }, [sections, requestedSection]);

  const selectSection = useCallback((key: string) => {
    const next = new URLSearchParams(params?.toString() || '');
    next.set('section', key);
    router.push(`${pathname}?${next.toString()}`);
  }, [params, pathname, router]);

  return {
    sections,
    groups,
    activeSection,
    selectSection
  };
};

export default useSettingsSections;
