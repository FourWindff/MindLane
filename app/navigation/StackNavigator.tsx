import React from 'react';
import HomeRoute from '@/app/routes/Home';
import StorageRoute from "@/app/routes/Storage";
import HistoryRoute from "@/app/routes/History";
import FlowsDetail from "@/app/navigation/FlowsDetail";
import {createStackNavigator, StackHeaderProps} from '@react-navigation/stack';
import {RootStackParamList} from "@/types/navigationTypes";
import {getHeaderTitle} from "@react-navigation/elements";
import {Appbar, Menu} from "react-native-paper";



export const Header : React.FC<StackHeaderProps> = ({ navigation, route, options, back }) => {
    const [menuVisible, setMenuVisible] = React.useState(false);

    const title = getHeaderTitle(options, route.name);

    return (
        <Appbar.Header>
            {back && <Appbar.BackAction onPress={navigation.goBack} />}

            <Appbar.Content title={title} />

            {!back && (
                <Menu
                    visible={menuVisible}
                    onDismiss={() => setMenuVisible(false)}
                    anchor={
                        <Appbar.Action
                            icon="dots-vertical"
                            onPress={() => setMenuVisible(true)}
                        />
                    }
                >
                    <Menu.Item
                        title="保存"
                        onPress={() => console.log('保存被点击')}
                    />
                    <Menu.Item
                        title="清空"
                        onPress={() => console.log('清空被点击')}
                    />
                </Menu>
            )}
        </Appbar.Header>
    );
}

const Stack = createStackNavigator<RootStackParamList>();
// TODO: 需要创建其他的堆栈，设计好样式，布置flow内容到FlowsDetail中
export function HomeStack() {
    return (
        <Stack.Navigator initialRouteName="Home">
            <Stack.Screen name="Home" component={HomeRoute} options={{headerShown: false}} />
            <Stack.Screen name="Flows" component={FlowsDetail}
                          options={{

                              header : (props) => (
                                  <Header {...props} />)}} />
        </Stack.Navigator>
    )
}

export function StorageStack() {
    return (
        <Stack.Navigator initialRouteName="Storage">
            <Stack.Screen name="Storage" component={StorageRoute} options={{headerShown: false}} />
            <Stack.Screen name="Flows" component={FlowsDetail}
                          options={{
                              header : (props) => (
                                  <Header {...props} />)}} />
        </Stack.Navigator>
    )
}

export function HistoryStack() {
    return (
        <Stack.Navigator initialRouteName="History">
            <Stack.Screen name="History" component={HistoryRoute} options={{headerShown: false}} />
            <Stack.Screen name="Flows" component={FlowsDetail}
                          options={{
                              header : (props) => (
                                  <Header {...props} />)}} />
        </Stack.Navigator>
    )
}
