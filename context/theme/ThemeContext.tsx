import { useColorScheme } from "react-native";
import { useAppPreference } from "../store/AppPreferenceContext";
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from "react-native-paper";
import { ReactNode } from "react";
interface ThemeProviderProps {
  children: ReactNode;
}
export default function ThemeProvider({ children }: ThemeProviderProps) {
  const colorSchema = useColorScheme();
  const { preference } = useAppPreference();

  const realTheme =
    preference.theme === "system"
      ? colorSchema === "light"
        ? MD3LightTheme
        : MD3DarkTheme
      : preference.theme === "light"
      ? MD3LightTheme
      : MD3DarkTheme;

  return <PaperProvider theme={realTheme}>{children}</PaperProvider>;
}
