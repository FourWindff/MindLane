import useDialog from '@/hooks/useDialog';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Avatar, Button, Card, Surface, Text, TextInput } from 'react-native-paper';




const HomeRoute = () => {
  const [text, setText] = useState('');
  const [Dialog, showDialog] = useDialog();
  const bottomSheetModalRef = useRef<BottomSheetModal>(null);

  const SearchActionRight = useCallback(() => {
    return (
      <View>
        <Button
          mode='contained'
          style={styles.searchButton}
        >搜索</Button>
      </View>
    )
  }, []);

  const handlePresentModalPress = useCallback(() => {
    bottomSheetModalRef.current?.present();
  }, []);
  const snapPoints = useMemo(() => ["25%", "50%"], []);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        pressBehavior='close'
        style={{
          backgroundColor: '(0,0,0,0.5)',
        }}
      />
    ),
    []
  );
  const handleSheetChanges = useCallback((index: number) => {
    console.log("handleSheetChanges", index);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.hello}>
        <View style={styles.titleGroup}>
          <Text variant='titleLarge' style={{ fontWeight: 'bold', fontStyle: 'italic' }}>Hello FourWindff</Text>
          <Text variant='bodySmall' style={{ color: 'gray', fontWeight: 'bold', fontStyle: 'italic' }}>今天想学点什么</Text>
        </View>
        <Avatar.Text size={40} label='Fs' />
      </View>
      <View style={styles.searchContainer}>
        <TextInput
          style={{ flex: 1 }}
          placeholder="请输入内容"
          value={text}
          onChangeText={setText}
          right={<TextInput.Icon icon="chevron-up" onPress={() => console.log(123)} />}
        />
      </View>
      <View style={styles.garelly}>
        <Text variant='titleLarge' style={{ fontWeight: 'bold' }}> Latest</Text>

        <ScrollView
          horizontal={true}
          contentContainerStyle={{
            gap: 8,
            paddingHorizontal: 20,
            marginVertical: 8,
            alignItems: 'center',
          }}>
          <Button mode='contained'>流程</Button>
          <Button mode='contained'>路线</Button>
          <Button mode='contained'>路线</Button>
          <Button mode='contained'
            onPress={() => showDialog("DialogTItle", (onClose) => (
              <Text>123</Text>
            ))}>DialogConent</Button>
        </ScrollView>



        <Button onPress={() => handlePresentModalPress()}>ActinoSheet</Button>
        <ScrollView
          horizontal={true}
          style={styles.scrollView}
          contentContainerStyle={{
            marginLeft: 20,
            alignItems: 'center',
            gap: 12,
            padding: 20,
          }}>
          <Card>
            <Surface style={styles.surface} elevation={4}>
              <Card.Cover source={{ uri: 'https://picsum.photos/700' }} style={styles.image} resizeMode="cover" />
            </Surface>
          </Card>
          <Card>
            <Surface style={styles.surface} elevation={4}>
              <Card.Cover source={{ uri: 'https://picsum.photos/600' }} style={styles.image} resizeMode="cover" />
            </Surface>
          </Card>
          <Card>
            <Surface style={styles.surface} elevation={4}>
              <Card.Cover source={{ uri: 'https://picsum.photos/500' }} style={styles.image} resizeMode="cover" />
            </Surface>
          </Card>
          <Card>
            <Surface style={styles.surface} elevation={4}>
              <Card.Cover source={{ uri: 'https://picsum.photos/400' }} style={styles.image} resizeMode="cover" />
            </Surface>
          </Card>
          <Card>
            <Surface style={styles.surface} elevation={4}>
              <Card.Cover source={{ uri: 'https://picsum.photos/300' }} style={styles.image} resizeMode="cover" />
            </Surface>
          </Card>
          <Card>
            <Surface style={styles.surface} elevation={4}>
              <Card.Cover source={{ uri: 'https://picsum.photos/200' }} style={styles.image} resizeMode="cover" />
            </Surface>
          </Card>
        </ScrollView>
        <BottomSheetModal
          backdropComponent={renderBackdrop}
          ref={bottomSheetModalRef}
          snapPoints={snapPoints}
          index={1}
          onChange={handleSheetChanges}
          enableDynamicSizing={true}
        >
          <BottomSheetView >
            <Text>123</Text>
            <Text>123</Text>
            <Text>123</Text>
            <Text>123</Text>
            <Text>123</Text>
            <Text>123</Text>
            <Text>123</Text>
            <Text>123</Text>
            <Text>123</Text>
            <Text>123</Text>
            <Text>123</Text>
            <Text>123</Text>
          </BottomSheetView>
        </BottomSheetModal>
      </View>
      {Dialog}
    </View>
  );
};

const styles = StyleSheet.create({
  hello: {
    width: '100%',
    paddingHorizontal: 20,
    marginBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  container: {
    flex: 1,
    paddingTop: 10,
  },
  titleGroup: {
    flexDirection: 'column'
  },
  searchContainer: {
    flexDirection: 'row',
    marginBottom: 10,
    borderRadius: 20,
    marginHorizontal: 20,
  },
  searchButton: {
    alignSelf: 'center',
  },
  scrollView: {
    width: '100%'
  },
  image: {
    height: 300,
    width: 300,
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
  },
  surface: {
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default HomeRoute;
