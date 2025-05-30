import GeminiClient from '@/features/gemini/mapAI';
import MapDisplayer, {MapAiResponse, MapDisplayerProps} from '@/features/map';
import useDialog from '@/hooks/useDialog';
import {BottomSheetBackdrop, BottomSheetModal, BottomSheetView} from '@gorhom/bottom-sheet';
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {Avatar, Button, Chip, Icon, IconButton, Searchbar, Text} from 'react-native-paper';
import {useStore} from "@/context/store/StoreContext";
import Gallery from "@/components/Gallery";
import {loadJsonDataSync} from "@/utils/filesystem/file";

const HomeRoute = () => {
  const [text, setText] = useState('模拟请求');
  const [isMapMode, setIsMapMode] = useState<boolean>(true);
  const [Dialog, showDialog] = useDialog();
  const bottomMapModalRef = useRef<BottomSheetModal>(null);
  const {saveMap} = useStore();
  const [map, setMap] = useState<MapDisplayerProps | undefined>(undefined);
  const handleSend = useCallback(async () => {
    if (isMapMode) {
      bottomMapModalRef.current?.present();
      try {
        const res = await GeminiClient.sendMessage(text);
        const obj: MapAiResponse = JSON.parse(res.text);
        const base64Data = res.image;
        console.log('---------------------------');
        console.log(obj.nodes);
        console.log(obj.title);
        console.log('---------------------------');
        const map: MapDisplayerProps = {
          imageUri: `data:image/png;base64,${base64Data}`,
          title: obj.title,
          nodes: obj.nodes
        };
        setMap(map);
        await saveMap({...map, imageUri: res.image}, res.mimeType);
      } catch (err) {
        console.error("Error in handleSend:", err);
        showDialog("ERROR", () => <Text>{String(err)}</Text>);
      }
    } else {
      console.log("生成可视化流程", text);
    }
  }, [isMapMode, saveMap, showDialog, text]);
  const handleReviewCard = (cardPath: string) => {
    const data = loadJsonDataSync(cardPath, {} as MapDisplayerProps);
    setMap(data);
    bottomMapModalRef.current?.present();

  }


  //TODO 如果backdrop出现的index似乎只能大于1。如果让它在0出现，背景不会出现
  const snapPoints = useMemo(() => ["65", "70"], []);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        pressBehavior='close'
        appearsOnIndex={1}
        style={{
          backgroundColor: '(0,0,0,0.5)',
        }}
      />
    ),
    []
  );

  const BottomMapModal = () => {
    return (
      <View style={{
        width: '100%',
        height: '100%'
      }}>
        <MapDisplayer title={map?.title} nodes={map?.nodes} imageUri={map?.imageUri}/>
      </View>
    )
  }

  const handleSheetChanges = useCallback((index: number) => {
    if (index === -1) {
      setMap(undefined);
    }
    console.log("handleSheetChanges", index);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.hello}>
        <View style={styles.titleGroup}>
          <Text variant='titleLarge' style={{fontWeight: 'bold', fontStyle: 'italic'}}>Hello,FourWindff</Text>
          <Text variant='bodySmall'
                style={{color: 'gray', fontWeight: 'bold', fontStyle: 'italic'}}>今天想学点什么</Text>
        </View>
        <Avatar.Text size={40} label='Fs'/>
      </View>
      <View style={styles.searchContainer}>
        <Searchbar
          placeholder="请输入内容"
          value={text}
          mode='bar'
          elevation={2}
          onChangeText={setText}
          submitBehavior='blurAndSubmit'
          right={props =>
            <IconButton
              {...props}
              onPress={handleSend}
              icon='send'
            />
          }
        />
        <View style={styles.chipContainer}>
          <Chip
            style={styles.searchChip}
            selected={isMapMode}
            onPress={() => setIsMapMode(true)}
            avatar={<Icon source='map-marker-path' size={20}/>}
          >
            Map
          </Chip>
          <Chip
            style={styles.searchChip}
            selected={!isMapMode}
            onPress={() => setIsMapMode(false)}
            avatar={<Icon source='backburger' size={20}/>}
          >Flow</Chip>
        </View>
      </View>
      <View style={styles.gallery}>
        <Text variant='titleLarge' style={{fontWeight: 'bold', fontStyle: 'italic'}}>Latest</Text>
        <ScrollView
          style={{
            maxHeight: 60,
          }}
          horizontal={true}
          contentContainerStyle={{
            maxHeight:50,
            gap: 8,
            paddingHorizontal: 20,
            marginVertical: 8,
            alignItems: 'center',
          }}>
          <Button mode='contained'>流程</Button>
          <Button mode='contained'>路线1</Button>
          <Button mode='contained'>路线2</Button>
          <Button mode='contained'>路线3</Button>
          <Button mode='contained'
                  onPress={() => showDialog("DialogTItle", () => (
                    <Text>123</Text>
                  ))}>DialogContent</Button>
        </ScrollView>
        <Gallery onPressCard={handleReviewCard}/>
      </View>
      {Dialog}
      <BottomSheetModal
        backdropComponent={renderBackdrop}
        ref={bottomMapModalRef}
        snapPoints={snapPoints}
        index={1}
        onChange={handleSheetChanges}
        enableDynamicSizing={true}
      >
        <BottomSheetView>
          <BottomMapModal/>
        </BottomSheetView>
      </BottomSheetModal>
    </View>
  );
};

const styles = StyleSheet.create({
  hello: {
    width: '100%',
    marginBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  container: {
    flex: 1,
    flexShrink: 0,
    paddingHorizontal: 5,
    paddingTop: 10,
  },
  titleGroup: {
    flexDirection: 'column'
  },
  searchContainer: {
    flexDirection: 'column',
    marginBottom: 10,
    marginHorizontal: 10,
    padding: 5,
    gap: 10,
  },
  searchChip: {
    borderRadius: 20,
  },
  chipContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  gallery: {
    flexDirection:'column',
    alignItems:'flex-start',
    justifyContent:'flex-start',
    width:'100%',
  },

});

export default HomeRoute;
