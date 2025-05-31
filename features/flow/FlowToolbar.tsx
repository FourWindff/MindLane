import React from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';

interface FlowToolbarProps {
  onClear: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenter: () => void;
  onResetScale: () => void;
  scale: number;
}

export default function FlowToolbar({ 
  onClear, 
  onZoomIn, 
  onZoomOut, 
  onCenter,
  onResetScale,
  scale 
}: FlowToolbarProps) {
  return (
    <View style={styles.container}>
      <IconButton
        icon="delete"
        size={24}
        onPress={onClear}
        mode="contained"
        style={styles.button}
      />
      <IconButton
        icon="magnify-plus"
        size={24}
        onPress={onZoomIn}
        mode="contained"
        style={styles.button}
      />
      <View style={styles.scaleContainer}>
        <Text style={styles.scaleText}>{Math.round(scale * 100)}%</Text>
      </View>
      <IconButton
        icon="magnify-minus"
        size={24}
        onPress={onZoomOut}
        mode="contained"
        style={styles.button}
      />
      <IconButton
        icon="crosshairs"
        size={24}
        onPress={onCenter}
        mode="contained"
        style={styles.button}
      />
      <IconButton
        icon="restore"
        size={24}
        onPress={onResetScale}
        mode="contained"
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    margin: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  button: {
    marginHorizontal: 4,
  },
  scaleContainer: {
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  scaleText: {
    fontSize: 14,
    fontWeight: '500',
  },
}); 