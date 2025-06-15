import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";

import { useLocalSearchParams } from "expo-router";
import { FlowDisplayerProps } from "@/features/flow/types";
import FlowDisplayer from "@/features/flow";
import useDataLoader from "@/hooks/useDataLoader";

// TODO: 设计样式，返回键的样式，传入的内容
// TODO: 说不定可以使用memo优化性能，目前每次打开都会重新渲染
export default function FlowDetail() {
  const { path } = useLocalSearchParams();
  const [flowData] = useDataLoader<FlowDisplayerProps>(path as string);

  const Flow = useMemo(() => {
    console.log("genxin ");
    return <FlowDisplayer flowData={flowData} />;
  }, [flowData]);
  return <View style={styles.container}>{Flow}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
