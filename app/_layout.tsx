import { UserProfileProvider } from "@/context/store/UserProfileContext";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from "react-native-paper";
import { AppPreferenceProvider, useAppContextPreference } from "../context/store/AppPreferenceContext";
//TODO 项目使用了react-native-paper的导航，我创建项目用的expo的默认组合，有多余的expo-router的Stack导航，考虑一下删除不必要的包
const App = () => {
  const colorSchema = useColorScheme();
  const { preference } = useAppContextPreference();

  const realTheme = preference.theme === "system" ?
    colorSchema === 'light' ? MD3LightTheme : MD3DarkTheme
    : preference.theme === "light" ? MD3LightTheme : MD3DarkTheme;
  const StatusBarStyle = realTheme.dark ? "light" : "dark";

  return (
    <PaperProvider theme={realTheme}>
      <Stack screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: realTheme.colors.background
        }
      }} />
      <StatusBar style={StatusBarStyle} />
    </PaperProvider >
  )

}
export default function RootLayout() {

  return (
    <GestureHandlerRootView>
      <BottomSheetModalProvider>
        <AppPreferenceProvider>
          <UserProfileProvider>
            <App />
          </UserProfileProvider>
        </AppPreferenceProvider>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  )
}
