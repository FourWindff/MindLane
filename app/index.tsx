import React from "react";
import { BottomNavigation, MD3LightTheme, PaperProvider } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import FlowRoute from "./routes/Flow";
import HomeRoute from "./routes/Home";
import MindMapRoute from "./routes/MindMap";
import SettingsRoute from "./routes/Settings";



export default function Index() {
  const [index, setIndex] = React.useState(0);
  const [routes] = React.useState([
    { key: 'home', title: 'Home', focusedIcon: 'home', unfocusedIcon: 'home-outline' },
    { key: 'flow', title: 'Flow', focusedIcon: 'album' },

    { key: 'mindMap', title: 'MindMap', focusedIcon: 'map' },
    { key: 'settings', title: 'Setting', focusedIcon: 'tools', unfocusedIcon: 'tools' },
  ]);

  const renderScene = BottomNavigation.SceneMap({
    home: HomeRoute,
    flow: FlowRoute,
    mindMap: MindMapRoute,
    settings: SettingsRoute,
  });

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <PaperProvider theme={MD3LightTheme}>
        <BottomNavigation
          navigationState={{ index, routes }}
          onIndexChange={setIndex}
          renderScene={renderScene}
        />
      </PaperProvider>
    </SafeAreaView>
  );
}