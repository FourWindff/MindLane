import useDataLoader from '@/hooks/useDataLoder';
import React, { createContext, useContext } from 'react';

const DEFAULT_USER_PROFILE = {
  username: '' as string,
  email: '' as string,
} as const;

export type UserProfileType = typeof DEFAULT_USER_PROFILE;
export type ProfileName = keyof UserProfileType;
export type ProfileValueType = UserProfileType[ProfileName];

interface UserProfileContextProps {
  profile: UserProfileType;
  updateProfile: (name: ProfileName, value: ProfileValueType) => void;
}

const UserProfileContext = createContext<UserProfileContextProps | undefined>(undefined);
const FILE_NAME = "userProfile.json";

export const UserProfileProvider = ({ children }: { children: React.ReactNode }) => {
  const [data, originalUpdateData] = useDataLoader(FILE_NAME, DEFAULT_USER_PROFILE);

  const updateProfile = (name: ProfileName, value: ProfileValueType) => {
    originalUpdateData({ ...data, [name]: value });
  };

  return (
    <UserProfileContext.Provider value={{ profile: data, updateProfile: updateProfile }}>
      {children}
    </UserProfileContext.Provider>
  );
};

export const useAppContextProfile = () => {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error('useAppContextProfile must be used within a UserProfileProvider');
  }
  return context;
};
