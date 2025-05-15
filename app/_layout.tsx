import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

export default function RootLayout() {
  return (
    <GestureHandlerRootView>
      <BottomSheetModalProvider>
        <Stack screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: '#fffbff',
          }
        }} />
        <StatusBar style="auto" translucent={true}/>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  )
}
