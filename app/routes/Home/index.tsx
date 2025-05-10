import React, { useCallback, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Searchbar, Text } from 'react-native-paper';




const HomeRoute = () => {
  const [text, setText] = useState('');

  const SearchActionRight = useCallback(() => {
    return (
      <View>
        <Button
          mode='contained'
          style={styles.searchButton}
        >搜索</Button>
      </View>
    )
  }, [])

  return (
      <SafeAreaView style={styles.container}>
        <View style={styles.searchContainer}>
          <Searchbar
            style={styles.input}
            placeholder="请输内容"
            value={text}
            onChangeText={setText}
            icon='attachment'
            right={() => <SearchActionRight />}
          />
        </View>
        <View style={styles.garelly}>
          <Text variant='titleLarge' style={{ fontWeight: 'bold' }}> Latest</Text>
          <View style={styles.actionContainer}>
            <Button mode='contained'>流程</Button>
            <Button mode='contained'>路线</Button>
          </View>
          <ScrollView horizontal={true} style={styles.scrollView} contentContainerStyle={{
            marginLeft: 20,
            alignItems: 'center',
            gap: 12,
            paddingBottom: 20,
          }}>
            <Card>
              <Card.Cover source={{ uri: 'https://picsum.photos/700' }} style={styles.image} resizeMode="cover" />
            </Card>
            <Card>
              <Card.Cover source={{ uri: 'https://picsum.photos/600' }} style={styles.image} resizeMode="cover" />
            </Card>
            <Card>
              <Card.Cover source={{ uri: 'https://picsum.photos/500' }} style={styles.image} resizeMode="cover" />
            </Card>
            <Card>
              <Card.Cover source={{ uri: 'https://picsum.photos/400' }} style={styles.image} resizeMode="cover" />
            </Card>
            <Card>
              <Card.Cover source={{ uri: 'https://picsum.photos/300' }} style={styles.image} resizeMode="cover" />
            </Card>
            <Card>
              <Card.Cover source={{ uri: 'https://picsum.photos/200' }} style={styles.image} resizeMode="cover" />
            </Card>
          </ScrollView>
        </View>
      </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 10,
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    marginBottom: 10,
    borderRadius: 20,
    marginHorizontal: 20,
  },
  input: {
    flex: 1
  },
  searchButton: {
    alignSelf: 'center',
  },
  scrollView: {
    width: '100%'
  },
  image: {
    width: 200,
  },
  actionContainer: {
    flexDirection: 'row',
    gap: 12,
    alignSelf: 'flex-end',
    marginBottom: 20,
    marginRight: 20,

  },
  garelly: {
    width: '100%',
    position: 'absolute',
    bottom: 0,
  },
});

export default HomeRoute;
