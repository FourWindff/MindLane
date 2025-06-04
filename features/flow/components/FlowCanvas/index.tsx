import React, { useState, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Searchbar } from 'react-native-paper'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import FlowToolbar from '../FlowToolbar';
import { EXTRA_SPACE, MIN_SCALE, MAX_SCALE, BOX_LENGTH, DRAFT_LENGTH, SCREEN_WIDTH } from '../constants';
import GridLines from './GridLines';
import flowAI from '@/features/gemini/flowAI';
import { FlowAiResponse } from '../../types';
import FlowGraph from '../FlowGraph';
import { FlowExampleData } from '../../utils/exampleData';



export default function FlowCanvas() {


  // 平移相关的状态
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const lastTranslateX = useSharedValue(0);
  const lastTranslateY = useSharedValue(0);

  // 缩放相关的状态
  const scale = useSharedValue(1);
  const lastScale = useSharedValue(1);
  const [saveScale, setSavaScale] = useState(1);

  const [data, setData] = useState(FlowExampleData);
  const nodes = data.nodes;
  const [input, setInput] = useState('如何造一台火箭');



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
  const handleClear = useCallback(() => {

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
    // 计算需要平移的距离，使内容居中
    const centerX = (SCREEN_WIDTH - DRAFT_LENGTH) / 2;
    const centerY = (SCREEN_WIDTH - DRAFT_LENGTH) / 2;

    translateX.value = centerX;
    translateY.value = centerY;
    lastTranslateX.value = centerX;
    lastTranslateY.value = centerY;
  }, []);

  // 重置缩放
  const handleResetScale = useCallback(() => {
    scale.value = 1;
    lastScale.value = 1;
    setSavaScale(1);
  }, []);

  const handleSend = () => {
    flowAI.sendMessage(input)
      .then(res => {
        if (res.text) {
          const result: FlowAiResponse = JSON.parse(res.text);
          setData(result);
        }
      })
  }

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
        <Searchbar
          style={{ marginHorizontal:10 }}
          value={input}
          right={() => <IconButton onPress={handleSend} icon={'send'} />}
          onChangeText={setInput}
        />
      </View>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.canvas, animatedStyle]}>
          <View style={styles.graphContainer}>
            {/* <CoordinateSystem /> */}
            <GridLines />
            <FlowGraph initalNodes={nodes} scale={saveScale} />
          </View>
        </Animated.View>
      </GestureDetector>

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
  graphContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
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
