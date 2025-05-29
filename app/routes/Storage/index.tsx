import {StyleSheet, View} from 'react-native';
import {Text} from 'react-native-paper';


export default function StorageRoute() {

  return (
    <View style={styles.container}>
      <Text variant="titleLarge">Storage</Text>
    </View>
  )
}
const styles = StyleSheet.create({
  container: {
    flex: 1
  }
});