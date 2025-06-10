import useDataLoader from '@/hooks/useDataLoader';
import React, {createContext, useContext} from 'react';
import {APP_DIR} from "@/utils/filesystem/path";
import {Paths} from "expo-file-system/next";

export type ThemeType = 'light' | 'dark' | 'system';
const DEFAULT_PREFERENCES = {
  theme: 'system' as ThemeType,
  apiKey: '' as string,
} as const;
export type PreferenceType = typeof DEFAULT_PREFERENCES;
export type PreferenceName = keyof typeof DEFAULT_PREFERENCES;
export type PreferenceValueType = typeof DEFAULT_PREFERENCES[PreferenceName];

interface AppPreferenceContextShape {
  preference: PreferenceType;
  updatePreference: (name: PreferenceName, value: PreferenceValueType) => void;
}

const AppPreferenceContext = createContext<AppPreferenceContextShape | undefined>(undefined);
const FILE_NAME = "appPreference.json";
const FILE_PATH = Paths.join(APP_DIR, FILE_NAME);

export const AppPreferenceProvider = ({children}: { children: React.ReactNode }) => {
  const [data, setData] = useDataLoader(FILE_PATH, DEFAULT_PREFERENCES);

  const updatePreference = (name: PreferenceName, value: PreferenceValueType) => {
    setData({...data, [name]: value});
  };

  return (
    <AppPreferenceContext.Provider value={{preference: data, updatePreference: updatePreference}}>
      {children}
    </AppPreferenceContext.Provider>
  );
};

export const useAppPreference = () => {
  const context = useContext(AppPreferenceContext);
  if (!context) throw new Error("useAppPreference must be used within a AppPreferenceProvider");
  return context;
}
