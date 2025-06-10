import useDataLoader from '@/hooks/useDataLoader';
import React, {createContext, useContext} from 'react';
import {APP_DIR} from "@/utils/filesystem/path";
import {Paths} from "expo-file-system/next";

const DEFAULT_USER_PROFILE = {
  username: '' as string,
  email: '' as string,
} as const;

export type UserProfileType = typeof DEFAULT_USER_PROFILE;
export type ProfileName = keyof UserProfileType;
export type ProfileValueType = UserProfileType[ProfileName];

interface UserProfileContextShape {
  profile: UserProfileType;
  updateProfile: (name: ProfileName, value: ProfileValueType) => void;
}

const UserProfileContext = createContext<UserProfileContextShape | undefined>(undefined);
const FILE_NAME = "userProfile.json";
const FILE_PATH = Paths.join(APP_DIR, FILE_NAME);

export const UserProfileProvider = ({children}: { children: React.ReactNode }) => {
  const [data, setData] = useDataLoader(FILE_PATH, DEFAULT_USER_PROFILE);

  const updateProfile = (name: ProfileName, value: ProfileValueType) => {
    setData({...data, [name]: value});
  };

  return (
    <UserProfileContext.Provider value={{profile: data, updateProfile: updateProfile}}>
      {children}
    </UserProfileContext.Provider>
  );
};

export const useUserProfile = () => {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error('useUserProfile must be used within a UserProfileProvider');
  }
  return context;
};
