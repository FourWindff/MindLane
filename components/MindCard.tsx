import {Button, Card as PPCard, Surface, Text, useTheme} from "react-native-paper";
import {StyleSheet} from "react-native";
import useDataLoader from "@/hooks/useDataLoader";
import {MapDisplayerProps} from "@/features/map";

interface CardProps {
  cardPath: string;
  onPress: (cardPath: string) => void;
}

const newMap = {} as MapDisplayerProps;
export default function MindCard({ cardPath, onPress}: CardProps) {
  const [cardData] = useDataLoader(cardPath, newMap);
  const theme = useTheme();
  return (
    <PPCard>
      <Surface style={styles.surface} elevation={4}>
        <PPCard.Cover
          source={{uri: cardData.imageUri}}
          style={styles.image}
          resizeMode="cover"
        />
        <PPCard.Actions style={styles.cardActions}>
          <Text
            variant="titleLarge"
            ellipsizeMode="tail"
            numberOfLines={1}
            style={{color: theme.colors.onBackground, fontWeight: 'bold'}}
          >
            {cardData.title}
          </Text>
          <Button onPress={()=> onPress(cardPath)} mode={"contained-tonal"}>Review</Button>
        </PPCard.Actions>
      </Surface>
    </PPCard>
  )
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    height: 300,
    width: 300,
  },
  cardActions: {
    position: 'absolute',
    left: 20,
    bottom: 20,
    right: 20,
    gap: 10,
    flexDirection: 'column',
    alignItems: 'flex-start',
  },

})