import GeminiClient from "@/features/gemini/mapAI";
import MapDisplayer, { MapAiResponse, MapDisplayerProps } from '@/features/map/MapDisplayer';
import useDialog from '@/hooks/useDialog';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Avatar, Button, Card, Searchbar, Surface, Switch, Text, useTheme } from 'react-native-paper';

const mock = {
  imageUri: 'https://picsum.photos/700',
  title: '示例',
  node: [
    {
      x: 0,
      y: 0,
      data: {
        label: "大门",
        content: "应用层: 为用户提供应用程序接口",
        lane:
          "想象一个巨大的门，上面刻着各种应用程序的图标，代表着应用层为用户提供各种服务。",
      },
    },

    {
      x: 0,
      y: 700,
      data: {
        label: "大厅",
        content: "表示层: 对数据进行编码和解码",
        lane:
          "想象一个宽敞的大厅，里面摆放着各种编码和解码的机器，代表着表示层对数据进行转换。",
      },
    },
    {
      x: 700,
      y: 0,
      data: {
        label: "图书馆",
        content: "会话层: 管理会话的建立、维护和终止",
        lane:
          "想象一个巨大的图书馆，里面摆放着各种书籍和文件，代表着会话层管理着各种会话。",
      },
    },
    {
      x: 350,
      y: 350,
      data: {
        label: "图书馆",
        content: "会话层: 管理会话的建立、维护和终止",
        lane:
          "想象一个巨大的图书馆，里面摆放着各种书籍和文件，代表着会话层管理着各种会话。",
      },
    },
    {
      x: 700,
      y: 700,
      data: {
        label: "餐厅",
        content: "传输层: 提供可靠的数据传输服务",
        lane:
          "想象一个豪华的餐厅，里面摆放着各种餐桌和椅子，代表着传输层为数据传输提供可靠的通道。",
      },
    },
  ]
}
const HomeRoute = () => {
  const [text, setText] = useState('模拟请求');
  const [isMapMode, setIsMapMode] = useState<boolean>(true);
  const [Dialog, showDialog] = useDialog();
  const bottomMapModalRef = useRef<BottomSheetModal>(null);
  const bottomFlowModalRef = useRef<BottomSheetModal>(null);
  const theme = useTheme();
  const [data, setData] = useState<MapDisplayerProps>(mock);


  const handleSend = useCallback(() => {
    if (isMapMode) {
      GeminiClient.sendMessage(text).then(
        (res) => {
          try {
            const obj: MapAiResponse = JSON.parse(res.text);
            setData({
              imageUri: `data:image/jpeg;base64,${res.image}`,
              title: obj.title,
              node: obj.node
            })

          } catch (err) {
            console.log(err)
            setData({
              imageUri: `data:image/jpeg;base64,${res.image}`,
              title: "error",
              node: []
            });
            showDialog("ERRor", (onClose) => <Text>{err as string}</Text>)
          };

        }
      ).catch((err) => {
        console.error("错误：", err);
      })
        .finally(() => {
          bottomMapModalRef.current?.present();
        })
      console.log("发送地图请求", text);

    } else {
      // 发送流程请求
      console.log("发送流程请求", text);
    }
  }, [isMapMode, showDialog, text])


  const SearchActionRight = useCallback(() => {
    return (
      <View style={{ marginRight: 10 }}>
        <Button
          mode='contained'
          style={styles.searchButton}
          compact={true}
          onPress={handleSend}
        >
          发送
        </Button>
      </View>
    )
  }, [handleSend]);

  const handlePresentMapModal = useCallback(() => {
    bottomFlowModalRef.current?.present();
  }, []);
  const handlePresentFlowModal = useCallback(() => {
    bottomMapModalRef.current?.present();
  }, [])

  //TODO 如果backdrop出现的index似乎只能大于1。如果让它在0出现，背景不会出现
  const snapPoints = useMemo(() => ["65","70"], []);

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
        <MapDisplayer title={data.title} node={data.node} imageUri={data.imageUri} />
      </View>
    )
  }
  const BottomFlowModal = () => {
    return (
      <Text>123</Text>
    )
  }


  const handleSheetChanges = useCallback((index: number) => {
    console.log("handleSheetChanges", index);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.hello}>
        <View style={styles.titleGroup}>
          <Text variant='titleLarge' style={{ fontWeight: 'bold', fontStyle: 'italic' }}>Hello, FourWindff</Text>
          <Text variant='bodySmall' style={{ color: 'gray', fontWeight: 'bold', fontStyle: 'italic' }}>今天想学点什么</Text>
        </View>
        <Avatar.Text size={40} label='Fs' />
      </View>
      <View style={styles.searchContainer}>
        <View style={{
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          <Text>{isMapMode ? 'Map' : 'Flow'}</Text>
          <Switch value={isMapMode} onValueChange={v => setIsMapMode(v)} theme={theme} />
        </View>
        <Searchbar
          style={{ flex: 1 }}
          placeholder="请输入内容"
          value={text}
          mode='bar'
          onChangeText={setText}
          submitBehavior='blurAndSubmit'
          right={props => <SearchActionRight />}
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



        <Button onPress={() => handlePresentMapModal()}>FlowModal</Button>
        <Button onPress={() => handlePresentFlowModal()}>MapModal</Button>

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


        {/* <BottomSheetModal
          backdropComponent={renderBackdrop}
          ref={bottomFlowModalRef}
          snapPoints={snapPoints}
          index={1}
          onChange={handleSheetChanges}
          enableDynamicSizing={true}
        >
          <BottomSheetView >
            <BottomFlowModal />
          </BottomSheetView>
        </BottomSheetModal> */}
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
