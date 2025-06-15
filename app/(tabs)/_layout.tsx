import TabBar from "@/components/TabBar";
import { Tabs } from "expo-router";
import { Icon, useTheme } from "react-native-paper";

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        sceneStyle: {
          backgroundColor: theme.colors.background,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerShown: false,
          tabBarIcon: (props) => <Icon source="home" {...props} />,
        }}
      />
      <Tabs.Screen
        name="storage"
        options={{
          title: "Stotage",
          headerShown: false,
          tabBarIcon: (props) => <Icon source="inbox" {...props} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          headerShown: false,
          tabBarIcon: (props) => <Icon source="history" {...props} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          headerShown: false,
          tabBarIcon: (props) => <Icon source="tools" {...props} />,
        }}
      />
    </Tabs>
  );
}
