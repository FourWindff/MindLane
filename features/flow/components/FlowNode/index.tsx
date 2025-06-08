import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Gesture, GestureDetector, Pressable } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated';
import { NODE_HEIGHT, NODE_WIDTH } from '../constants';

interface FlowNodeProps {
  id: string;
  initialX: number;
  initialY: number;
  scale: number;
  label: string;
  content?: string;
  onPositionChange?: (id: string, newX: number, newY: number) => void;
  onPress?: (id: string, label: string, content: string) => void;
}

function FlowNode({
  id,
  initialX,
  initialY,
  scale,
  label,
  content,
  onPositionChange,
  onPress
}: FlowNodeProps) {
  const translateX = useSharedValue(initialX);
  const translateY = useSharedValue(initialY);
  const lastTranslateX = useSharedValue(0);
  const lastTranslateY = useSharedValue(0);

  console.log(`${Date.now()}id:${id}-${label}节点更新`)

  // 拖动手势
  const dragGesture = Gesture.Pan()
    .onStart(() => {
      lastTranslateX.value = translateX.value;
      lastTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = lastTranslateX.value + event.translationX / scale;
      translateY.value = lastTranslateY.value + event.translationY / scale;

      // 使用 runOnJS 在 JS 线程调用回调
      if (onPositionChange) {
        runOnJS(onPositionChange)(id, translateX.value, translateY.value);
      }
    });

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
      <Animated.View style={[styles.container, animatedStyle]}>
        <Pressable onPress={() => onPress && onPress(id, label, content || '')}>
          <View style={styles.node}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.content}
              ellipsizeMode="tail"
              numberOfLines={2}>{content}</Text>
          </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}
export default React.memo(FlowNode);


const styles = StyleSheet.create({
  container: {
    position: 'absolute',
  },
  node: {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  content: {
    fontSize: 14,
    color: '#666',
  },
}); 