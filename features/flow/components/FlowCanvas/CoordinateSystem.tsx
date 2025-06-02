import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { DRAFT_LENGTH, GRID_COUNT, GRID_SIZE } from '../constants';

const AXIS_COLOR = '#666666';
const TEXT_COLOR = '#999999';



export default function CoordinateSystem() {
  // 计算坐标轴的位置
  const originX = DRAFT_LENGTH / 2;
  const originY = DRAFT_LENGTH / 2;

  // 生成刻度标记
  const renderAxisMarks = () => {
    const marks = [];
    const range = GRID_COUNT / 2;


    // X轴刻度
    for (let i = -range; i <= range; i++) {
      const x = originX + i * GRID_SIZE;
      marks.push(
        <View
          key={`x-${i}`}
          style={[
            styles.mark,
            {
              left: x,
              zIndex: 1,
              top: originY,
              backgroundColor: 'rgba(0,0,0,0.2)',
              borderLeftWidth: 1,
              borderLeftColor: 'red',
              transform: [{ translateY: -GRID_SIZE / 2 }]
            }
          ]}
        >
          <Text style={[styles.markText, { marginTop: 2 }]}>{i * GRID_SIZE}</Text>
        </View>
      );
    }

    // Y轴刻度
    for (let i = -range; i <= range; i++) {
      if (i === 0) continue; // 跳过原点
      const y = originY + i * GRID_SIZE;
      marks.push(
        <View
          key={`y-${i}`}
          style={[
            styles.mark,
            {
              left: originX,
              top: y,
              zIndex: 1,
              backgroundColor: 'rgba(0,0,0,0.2)',
              borderTopWidth: 1,
              borderTopColor: 'red',
              transform: [{ translateX: -GRID_SIZE / 2 }]
            }
          ]}
        >
          <Text style={[styles.markText, { marginLeft: 2 }]}>{-i * GRID_SIZE}</Text>
        </View>
      );
    }

    return marks;
  };

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.axis,
          {
            left: 0,
            top: originY,
            width: DRAFT_LENGTH,
            height: 1,
          },
        ]}
      />
      <View
        style={[
          styles.axis,
          {
            top: 0,
            left: originX,
            width: 1,
            height: DRAFT_LENGTH,
          },
        ]}
      />
      <View
        style={[
          styles.origin,
          {
            left: originX,
            top: originY,
          },
        ]}
      >
        <Text style={styles.originText}>O</Text>
      </View>
      {renderAxisMarks()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: DRAFT_LENGTH,
    height: DRAFT_LENGTH,
  },
  axis: {
    position: 'absolute',
    backgroundColor: AXIS_COLOR,
  },
  origin: {
    position: 'absolute',
    width: 20,
    height: 20,
    transform: [
      { translateX: -10 },
      { translateY: -10 },
    ],
    justifyContent: 'center',
    alignItems: 'center',
  },
  originText: {
    color: AXIS_COLOR,
    fontSize: 16,
    fontWeight: 'bold',
  },
  mark: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  markLine: {
    backgroundColor: AXIS_COLOR,
  },
  markText: {
    color: TEXT_COLOR,
    fontSize: 10,
  },
}); 