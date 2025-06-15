import React, { useState, useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { Text, Card, Searchbar } from "react-native-paper";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import {
  Gesture,
  GestureDetector,
  ScrollView,
} from "react-native-gesture-handler";
import FlowToolbar from "../FlowToolbar";
import {
  EXTRA_SPACE,
  MIN_SCALE,
  MAX_SCALE,
  BOX_LENGTH,
  DRAFT_LENGTH,
  SCREEN_WIDTH,
} from "../constants";
import GridLines from "./GridLines";
import { FlowDisplayerProps } from "../../types";
import FlowGraph from "../FlowGraph";

// TODO: 可能需要标准化传入参数
export default function FlowCanvas({
  flowData,
}: {
  flowData?: FlowDisplayerProps;
}) {
  // 平移相关的状态
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const lastTranslateX = useSharedValue(0);
  const lastTranslateY = useSharedValue(0);

  // 缩放相关的状态
  const scale = useSharedValue(1);
  const lastScale = useSharedValue(1);
  const [saveScale, setSavaScale] = useState(1);

  // 新增状态用于存储选定的节点信息
  const [selectedNode, setSelectedNode] = useState<{
    id: string;
    label: string;
    content: string;
  } | null>(null);

  // 传入实际Flow数据，若无传入的数据则默认 {flowData} : {flowData : FlowDisplayerProps} = FlowExampleData;

  // 平移手势
  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      translateX.value = lastTranslateX.value + event.translationX;
      translateY.value = lastTranslateY.value + event.translationY;
    })
    .onEnd(() => {
      lastTranslateX.value = translateX.value;
      lastTranslateY.value = translateY.value;
    });

  // 缩放手势
  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      const newScale = lastScale.value * event.scale;
      const clampedScale = Math.min(Math.max(newScale, MIN_SCALE), MAX_SCALE);
      scale.value = clampedScale;
      runOnJS(setSavaScale)(scale.value);
    })
    .onEnd(() => {
      lastScale.value = scale.value;
    });

  // 组合手势
  const composed = Gesture.Simultaneous(panGesture, pinchGesture);

  // 动画样式
  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    };
  });

  // 清除所有节点
  const handleClear = useCallback(() => {}, []);

  // 放大画布
  const handleZoomIn = useCallback(() => {
    const newScale = Math.min(scale.value * 1.2, MAX_SCALE);
    scale.value = newScale;
    lastScale.value = newScale;
    setSavaScale(newScale);
  }, [lastScale, scale]);

  // 缩小画布
  const handleZoomOut = useCallback(() => {
    const newScale = Math.max(scale.value / 1.2, MIN_SCALE);
    scale.value = newScale;
    lastScale.value = newScale;
    setSavaScale(newScale);
  }, [lastScale, scale]);

  // 回到画布中心
  //FIXME 实际是偏到不知道哪里去了
  const handleCenter = useCallback(() => {
    // 计算需要平移的距离，使内容居中
    translateX.value = 0;
    translateY.value = 0;
    lastTranslateX.value = 0;
    lastTranslateY.value = 0;
  }, [lastTranslateX, lastTranslateY, translateX, translateY]);

  // 重置缩放
  const handleResetScale = useCallback(() => {
    scale.value = 1;
    lastScale.value = 1;
    setSavaScale(1);
  }, [lastScale, scale]);

  // 处理节点点击事件
  const handleNodePress = useCallback(
    (id: string, label: string, content: string) => {
      setSelectedNode({ id, label, content });
    },
    []
  );
  if (!flowData) return;
  const nodes = flowData.nodes;
  return (
    <View style={styles.container}>
      <View style={styles.toolbarContainer}>
        <FlowToolbar
          onClear={handleClear}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onCenter={handleCenter}
          onResetScale={handleResetScale}
          scale={saveScale}
        />
      </View>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.canvas, animatedStyle]}>
          <View style={styles.graphContainer}>
            {/* <CoordinateSystem /> */}
            <GridLines />
            <FlowGraph
              initalNodes={nodes}
              scale={saveScale}
              onNodePress={handleNodePress}
            />
          </View>
        </Animated.View>
      </GestureDetector>

      {selectedNode && (
        <Card style={styles.nodeInfoCard}>
          <ScrollView>
            <Card.Title title={selectedNode.label} />
            {/*TODO: 以markdown格式渲染 */}
            <Card.Content>
              <Text>{selectedNode.content}</Text>
            </Card.Content>
          </ScrollView>
        </Card>
      )}

      <Card style={{ position: "absolute", bottom: 0 }}>
        <Searchbar value={"12313"} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    overflow: "hidden",
  },
  canvas: {
    width: DRAFT_LENGTH,
    height: DRAFT_LENGTH,
    backgroundColor: "#ffffff",
    position: "absolute",
    left: -EXTRA_SPACE - (BOX_LENGTH - SCREEN_WIDTH) / 2,
    top: -EXTRA_SPACE,
  },
  graphContainer: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  toolbarContainer: {
    position: "absolute",
    right: 10,
    top: 10,
    zIndex: 1000,
  },
  nodeInfoCard: {
    position: "absolute",
    bottom: 30,
    left: 0,
    right: 0,
    margin: 16,
    padding: 8,
    zIndex: 999,
    height: "40%",
  },
});
