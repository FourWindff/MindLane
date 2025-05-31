import React, { useState, useCallback, useRef } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { FAB } from 'react-native-paper';
import CoordinateSystem from './CoordinateSystem';
import FlowNode from './FlowNode';
import FlowToolbar from './FlowToolbar';
import { EXTRA_SPACE, MIN_SCALE, MAX_SCALE, BOX_LENGTH, DRAFT_LENGTH, DRAFT_ORIGIN_X, DRAFT_ORIGIN_Y, SCREEN_WIDTH } from './constants';
import GridLines from './GridLines';

interface FlowCanvasProps {
  children?: React.ReactNode;
}

interface Node {
  id: string;
  x: number;
  y: number;
}
//TODO 缩放会往原点处靠近
export default function FlowCanvas({ children }: FlowCanvasProps) {
  // 节点列表状态
  const [nodes, setNodes] = useState<Node[]>([]);

  // 平移相关的状态
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const lastTranslateX = useSharedValue(0);
  const lastTranslateY = useSharedValue(0);

  // 缩放相关的状态
  const scale = useSharedValue(1);
  const lastScale = useSharedValue(1);

  const [saveScale, setSavaScale] = useState(1);



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

  // 添加节点
  const addNode = useCallback(() => {
    // 计算画布中心点
    const centerX = DRAFT_ORIGIN_X;
    const centerY = DRAFT_ORIGIN_Y;

    const currentTranslateX = translateX.value;
    const currentTranslateY = translateY.value
    // 考虑当前平移和缩放，计算实际位置
    const actualX = (centerX - currentTranslateX / scale.value);
    const actualY = (centerY - currentTranslateY / scale.value);

    const newNode: Node = {
      id: `node-${nodes.length + 1}`,
      x: actualX,
      y: actualY,
    };

    setNodes(prevNodes => [...prevNodes, newNode]);
  }, [nodes.length]);

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
  const handleClear = useCallback(() => {
    setNodes([]);
  }, []);

  // 放大画布
  const handleZoomIn = useCallback(() => {
    const newScale = Math.min(scale.value * 1.2, MAX_SCALE);
    scale.value = newScale;
    lastScale.value = newScale;
    setSavaScale(newScale);
  }, []);

  // 缩小画布
  const handleZoomOut = useCallback(() => {
    const newScale = Math.max(scale.value / 1.2, MIN_SCALE);
    scale.value = newScale;
    lastScale.value = newScale;
    setSavaScale(newScale);
  }, []);

  // 回到画布中心
  const handleCenter = useCallback(() => {
    translateX.value = 0;
    translateY.value = 0;
    lastTranslateX.value = 0;
    lastTranslateY.value = 0;
  }, []);

  // 重置缩放
  const handleResetScale = useCallback(() => {
    scale.value = 1;
    lastScale.value = 1;
    setSavaScale(1);
  }, []);

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
          <CoordinateSystem />
          <GridLines />
          {nodes.map((node) => (
            <FlowNode
              key={node.id}
              id={node.id}
              initialX={node.x}
              initialY={node.y}
              scale={saveScale}
            />
          ))}
          {children}
        </Animated.View>
      </GestureDetector>
      <FAB
        icon="plus"
        style={styles.fab}
        onPress={addNode}
      />
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    overflow: 'hidden',
  },
  canvas: {
    width: DRAFT_LENGTH,
    height: DRAFT_LENGTH,
    backgroundColor: '#ffffff',
    position: 'absolute',
    left: -EXTRA_SPACE - (BOX_LENGTH - SCREEN_WIDTH) / 2,
    top: -EXTRA_SPACE,
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  },
  toolbarContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
});
