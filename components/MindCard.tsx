import {
  Button,
  Card as PPCard,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import { StyleSheet } from "react-native";
import useDataLoader from "@/hooks/useDataLoader";
import { FlowDisplayerProps } from "@/features/flow/types";
import { CardType } from "@/types/types";
import { MapDisplayerProps } from "@/features/map/types";

interface CardProps {
  type: CardType;
  path: string;
  onPress: (cardType: CardType, cardPath: string) => void;
}
export default function MindCard({ path, type, onPress }: CardProps) {
  const [cardData] = useDataLoader<MapDisplayerProps | FlowDisplayerProps>(
    path
  );

  const theme = useTheme();
  return (
    <PPCard>
      <Surface style={styles.surface} elevation={4}>
        <PPCard.Cover
          source={{ uri: cardData?.imageUri }}
          style={styles.image}
          resizeMode="cover"
        />
        <PPCard.Actions style={[styles.cardActions]}>
          <Text
            variant="titleLarge"
            ellipsizeMode="tail"
            numberOfLines={1}
            style={{ color: theme.colors.onSurface, fontWeight: "bold" }}
          >
            {cardData?.title}
          </Text>
          <Button onPress={() => onPress(type, path)} mode="contained-tonal">
            Review
          </Button>
        </PPCard.Actions>
      </Surface>
    </PPCard>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    height: 300,
    width: 300,
  },
  cardActions: {
    position: "absolute",
    left: 20,
    bottom: 20,
    right: 20,
    gap: 10,
    flexDirection: "column",
    alignItems: "flex-start",
    borderRadius: 20,
  },
});
