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
        size={20}
        onPress={onClear}
        mode="contained"
        style={styles.button}
      />
      <IconButton
        icon="magnify-plus"
        size={20}
        onPress={onZoomIn}
        mode="contained"
        style={styles.button}
      />
      <View style={styles.scaleContainer}>
        <Text style={styles.scaleText}>{Math.round(scale * 100)}%</Text>
      </View>
      <IconButton
        icon="magnify-minus"
        size={20}
        onPress={onZoomOut}
        mode="contained"
        style={styles.button}
      />
      <IconButton
        icon="crosshairs"
        size={20}
        onPress={onCenter}
        mode="contained"
        style={styles.button}
      />
      <IconButton
        icon="restore"
        size={20}
        onPress={onResetScale}
        mode="contained"
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    alignItems: 'center',
    padding: 4,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    margin: 4,
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
    marginVertical: 2,
  },
  scaleContainer: {
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  scaleText: {
    fontSize: 12,
    fontWeight: '500',
  },
}); 