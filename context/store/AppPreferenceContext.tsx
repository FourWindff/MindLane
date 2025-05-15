import useDataLoader from '@/hooks/useDataLoder';
import React, { createContext, useContext } from 'react';

export type ThemeType = 'light' | 'dark' | 'system';
const DEFAULT_PREFERENCES = {
  theme: 'system' as ThemeType,
  apiKey: '' as string,
} as const;
export type PreferenceType = typeof DEFAULT_PREFERENCES;
export type PreferenceName = keyof typeof DEFAULT_PREFERENCES;
export type PreferenceValueType = typeof DEFAULT_PREFERENCES[PreferenceName];

interface AppPreferenceContextProps {
  preference: PreferenceType;
  updatePreference: (name: PreferenceName, value: PreferenceValueType) => void;
}
const AppPreferenceContext = createContext<AppPreferenceContextProps | undefined>(undefined);
const FILE_NAME = "appPreference.json";
export const AppPreferenceProvider = ({ children }: { children: React.ReactNode }) => {
  const [data, originalUpdateData] = useDataLoader(FILE_NAME, DEFAULT_PREFERENCES);

  const updatePreference = (name: PreferenceName, value: PreferenceValueType) => {
    originalUpdateData({ ...data, [name]: value });
  };

  return (
    <AppPreferenceContext.Provider value={{ preference: data, updatePreference: updatePreference }}>
      {children}
    </AppPreferenceContext.Provider>
  );
};

export const useAppContextPreference = () => {
  const context = useContext(AppPreferenceContext);
  if (!context) throw new Error("useAppContextPreference must be used within a AppPreferenceProvider");
  return context;
}
