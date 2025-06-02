import React from 'react';
import { StyleSheet, View } from 'react-native';
import { GRID_SIZE, DRAFT_LENGTH } from '../constants';


export default function GridLines() {
  const gridLines = [];
  const numLines = DRAFT_LENGTH / GRID_SIZE;

  // 绘制网格线
  for (let i = 0; i <= numLines; i++) {
    // 垂直线
    gridLines.push(
      <View
        key={`v${i}`}
        style={[
          styles.gridLine,
          {
            left: i * GRID_SIZE,
            height: DRAFT_LENGTH,
            width: 0,
            borderLeftWidth: 1,
            borderLeftColor: '#e0e0e0',
          },
        ]}
      />
    );

    // 水平线
    gridLines.push(
      <View
        key={`h${i}`}
        style={[
          styles.gridLine,
          {
            top: i * GRID_SIZE,
            width: DRAFT_LENGTH,
            height: 0,
            borderTopWidth: 1,
            borderTopColor: '#e0e0e0',
          },
        ]}
      />
    );
  }

  return <>{gridLines}</>;
}

const styles = StyleSheet.create({
  gridLine: {
    position: 'absolute',
    pointerEvents: 'none',
  },
}); 