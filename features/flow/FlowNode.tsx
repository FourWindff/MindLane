import React, { useCallback } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';


interface FlowNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  scale: number;
}

export default function FlowNode({ id, initialX, initialY, scale }: FlowNodeProps) {
  // 节点位置状态
  const translateX = useSharedValue(initialX ?? 0);
  const translateY = useSharedValue(initialY ?? 0);
  const lastTranslateX = useSharedValue(0);
  const lastTranslateY = useSharedValue(0);

  // 拖动手势
  const dragGesture = Gesture.Pan()
    .onStart(() => {
      lastTranslateX.value = translateX.value;
      lastTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = lastTranslateX.value + event.translationX / scale;
      translateY.value = lastTranslateY.value + event.translationY / scale;
    });

  // 节点样式
  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
      ],
    };
  });

  return (
    <GestureDetector gesture={dragGesture}>
      <Animated.View style={[styles.node, animatedStyle]}>
        <View style={styles.nodeContent}>
          <Text style={styles.nodeText}>节点 {id}</Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  node: {
    position: 'absolute',
    width: 120,
    height: 60,
    zIndex:99,
    transform: [
      { translateX: -60 },
      { translateY: -30 },
    ],
  },
  nodeContent: {
    flex: 1,
    backgroundColor: 'royalblue',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nodeText: {
    fontSize: 14,
  },
}); 