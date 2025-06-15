import { UserProfileProvider } from "@/context/store/UserProfileContext";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Appbar, useTheme } from "react-native-paper";
import { AppPreferenceProvider } from "@/context/store/AppPreferenceContext";
import { StoreProvider } from "@/context/store/StoreContext";
import ThemeProvider from "@/context/theme/ThemeContext";
import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
//TODO: Appbar组件右上方功能实现
function App() {
  const theme = useTheme();
  const StatusBarStyle = theme.dark ? "light" : "dark";
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack
        screenOptions={{
          header: ({ navigation, route }) => {
            return (
              <Appbar.Header statusBarHeight={0}>
                <Appbar.BackAction onPress={navigation.goBack} />
                <Appbar.Content title={route.name} />
                <Appbar.Action icon="calendar" onPress={() => {}} />
                <Appbar.Action icon="magnify" onPress={() => {}} />
              </Appbar.Header>
            );
          },
          contentStyle:{
            backgroundColor:theme.colors.background
          }
        }}
      >
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="flowDetail"
          options={{
            presentation: "fullScreenModal",
          }}
        />
        <Stack.Screen
          name="mapDetail"
          options={{
            presentation: "fullScreenModal",
          }}
        />
      </Stack>
      <StatusBar style={StatusBarStyle} />
    </SafeAreaView>
  );
}
export default function RootLayout() {
  return (
    <GestureHandlerRootView>
      <BottomSheetModalProvider>
        <AppPreferenceProvider>
          <UserProfileProvider>
            <StoreProvider>
              <ThemeProvider>
                <App />
              </ThemeProvider>
            </StoreProvider>
          </UserProfileProvider>
        </AppPreferenceProvider>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
