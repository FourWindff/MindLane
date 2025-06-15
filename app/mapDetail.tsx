import MapDisplayer from "@/features/map";
import { MapDisplayerProps } from "@/features/map/types";
import useDataLoader from "@/hooks/useDataLoader";
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { View, StyleSheet } from "react-native";

export default function MapDetail() {
  const { path } = useLocalSearchParams();
  const [mapData] = useDataLoader<MapDisplayerProps>(path as string);

  return (
    <View style={styles.container}>
      <MapDisplayer mapData={mapData ?? null} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
