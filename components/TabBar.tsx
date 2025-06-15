import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { CommonActions } from "@react-navigation/native";
import { BottomNavigation } from "react-native-paper";

export default function TabBar(props: BottomTabBarProps) {
  return (
    <BottomNavigation.Bar
      shifting
      navigationState={props.state}
      safeAreaInsets={props.insets}
      keyboardHidesNavigationBar={false}
      onTabPress={({ route, preventDefault }) => {
        const event = props.navigation.emit({
          type: "tabPress",
          target: route.key,
          canPreventDefault: true,
        });

        if (event.defaultPrevented) {
          preventDefault();
        } else {
          props.navigation.dispatch({
            ...CommonActions.navigate(route.name, route.params),
            target: props.state.key,
          });
        }
      }}
      renderIcon={({ route, focused, color }) => {
        const { options } = props.descriptors[route.key];
        if (options.tabBarIcon) {
          return options.tabBarIcon({ focused, color, size: 24 });
        }

        return null;
      }}
      getLabelText={({ route }) => {
        const { options } = props.descriptors[route.key];
        let label: string | undefined;

        if (typeof options.tabBarLabel === "string") {
          label = options.tabBarLabel;
        } else if (options.title !== undefined) {
          label = options.title;
        } else {
          label = route.name;
        }

        return label;
      }}
    />
  );
}
