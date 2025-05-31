import React from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import FlowCanvas from "./FlowCanvas";


export default function FlowRoute() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.canvasContainer}>
        <FlowCanvas />
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
  node: {
    position: 'absolute',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2196f3',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});
