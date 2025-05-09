import React from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Card, Text } from 'react-native-paper';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

interface NodeType {
  id: number;
  x: number;
  y: number;
  title: string;
  children?: number[];
}

interface MindMapNodeProps {
  node: NodeType;
  onDragEnd: (id: number, x: number, y: number) => void;
}

export default function MindMapNode({ node, onDragEnd }: MindMapNodeProps) {
  const translateX = useSharedValue(node.x);
  const translateY = useSharedValue(node.y);

  const gesture = Gesture.Pan()
    .onStart(() => {
      translateX.value = node.x;
      translateY.value = node.y;
    })
    .onUpdate((event) => {
      translateX.value = node.x + event.translationX;
      translateY.value = node.y + event.translationY;
    })
    .onEnd(() => {
      runOnJS(onDragEnd)(node.id, translateX.value, translateY.value);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.nodeContainer, animatedStyle]}>
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="bodyLarge">{node.title}</Text>
          </Card.Content>
        </Card>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  nodeContainer: {
    position: 'absolute',
    padding: 8,
  },
  card: {
    minWidth: 120,
    minHeight: 60,
    borderRadius: 8,
    elevation: 4,
  },
});