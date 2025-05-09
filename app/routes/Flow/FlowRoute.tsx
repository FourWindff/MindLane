import DraggableGridCanvas from "@/app/components/DraggableGridCanvas";
import React, { useCallback, useState } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import { Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Button } from "react-native-paper";
import { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

interface NodeType {
  id: number;
  x: number;
  y: number;
  title: string;
}

export default function FlowRoute() {
  const [nodes, setNodes] = useState<NodeType[]>([]);
  const [scale, setScale] = useState(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const addNode = () => {
    setNodes([...nodes, {
      id: Date.now(),
      x: 100,
      y: 100,
      title: `节点 ${nodes.length + 1}`,
    }]);
  };

  const handleNodeDragEnd = useCallback((id: number, x: number, y: number) => {
    setNodes(prev => prev.map(node =>
      node.id === id ? { ...node, x, y } : node
    ));
  }, []);

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      'worklet';
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      'worklet';
      translateX.value = startX.value + event.translationX;
      translateY.value = startY.value + event.translationY;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale }
    ]
  }));

  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.toolbar}>
        <Button onPress={addNode}>添加节点</Button>
        <Button onPress={() => setScale(s => s + 0.1)}>放大</Button>
        <Button onPress={() => setScale(s => s - 0.1)}>缩小</Button>
      </View>
      <View style={styles.canvasContainer}>
        <DraggableGridCanvas/>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: 10,
    backgroundColor: "#eee",
  },
  canvasContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  canvas: {
    position: 'absolute',
    width: Dimensions.get('window').width * 2,
    height: Dimensions.get('window').height * 2,
    backgroundColor: '#f5f5f5',
    left: -Dimensions.get('window').width / 2,
    top: -Dimensions.get('window').height / 2,
  },
});
