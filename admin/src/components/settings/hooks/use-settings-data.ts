'use client';

import { settingService } from '@services/setting.service';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ISetting } from 'src/interfaces';

export interface UseSettingsDataProps {
  selectedTab: string;
}

export interface UseSettingsDataReturn {
  list: ISetting[];
  dataChange: React.RefObject<Record<string, any>>;
  loadingSettings: boolean;
  errorSettings: any;
  refetchSettings: () => void;
  setList: React.Dispatch<React.SetStateAction<ISetting[]>>;
}

export const useSettingsData = ({ selectedTab }: UseSettingsDataProps): UseSettingsDataReturn => {
  const [list, setList] = useState<ISetting[]>([]);
  const dataChange = useRef<Record<string, any>>({});

  const {
    data: settingsData,
    isLoading: loadingSettings,
    error: errorSettings,
    refetch: refetchSettings
  } = useQuery({
    queryKey: ['settings', selectedTab],
    queryFn: () => settingService.all(selectedTab).then((res) => res.data)
  });

  const processSettingsData = useEffectEvent(() => {
    if (!settingsData) return;
    dataChange.current = {};
    const arr = Array.isArray(settingsData) ? settingsData : [settingsData];

    setList(arr);
  });

  useEffect(() => {
    processSettingsData();
  }, [settingsData, selectedTab]);

  return {
    list,
    dataChange,
    loadingSettings,
    errorSettings,
    refetchSettings,
    setList
  };
};
