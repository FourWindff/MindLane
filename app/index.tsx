import React from "react";
import { BottomNavigation } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import HistoryRoute from "./routes/History";
import SettingsRoute from "./routes/Settings";
import StorageRoute from "./routes/Storage";
import { HomeStack } from "./navigation/StackNavigator";

export default function Index() {
  const [index, setIndex] = React.useState(0);

  const [routes] = React.useState([
    { key: "home", title: "Home", focusedIcon: "home", unfocusedIcon: "home-outline" },
    { key: "storage", title: "Storage", focusedIcon: "inbox" },
    { key: "history", title: "History", focusedIcon: "history" },
    { key: "settings", title: "Setting", focusedIcon: "tools", unfocusedIcon: "tools" },
  ]);

  const renderScene = BottomNavigation.SceneMap({
    home: HomeStack,
    storage: StorageRoute,
    history: HistoryRoute,
    settings: SettingsRoute,
  });


  return (
      <SafeAreaView style={{ flex: 1 }}>
        <BottomNavigation
          navigationState={{ index, routes }}
          onIndexChange={setIndex}
          renderScene={renderScene}
        />
      </SafeAreaView>
  );
}
