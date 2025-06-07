import React, {useMemo} from "react";
import { View, StyleSheet} from "react-native";
import FlowRoute from "@/features/flow";
import {HistoryStackProps, HomeStackProps, StorageStackProps} from "@/types/navigationTypes";

type NavigationProps = HomeStackProps | HistoryStackProps | StorageStackProps;


// TODO: 设计样式，返回键的样式，传入的内容
// TODO: 说不定可以使用memo优化性能，目前每次打开都会重新渲染
export default function FlowsDetail({navigation, route} : NavigationProps) {
    const Flow = useMemo(() => (
        !route.params || !route.params.flowData ? <FlowRoute /> :
        <FlowRoute flowData={route.params.flowData}/>), [route.params]);
    return (
        <View style={styles.container}>
            {Flow}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
})