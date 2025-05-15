import GeminiClient from "@/features/gemini/mindMapAI";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { TextInput } from "react-native-paper";
import MapDisplayer, { MapDisplayerProps, MindMapAiResponse } from "./MapDisplayer";
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
export default function MindMapRoute() {
  const [input, setInput] = useState<string>("如何记忆OSI7层模型");
  const [data, setData] = useState<MapDisplayerProps>(mock);

  const handleSend = useCallback(async (text: string) => {
    console.log("发送内容：", text);
    GeminiClient.sendMessage(text).then(
      (res) => {
        const obj: MindMapAiResponse = JSON.parse(res.text);
        setData({
          imageUri: `data:image/jpeg;base64,${res.image}`,
          title: obj.title,
          node: obj.node
        })
      }
    ).catch((err) => {
      console.error("错误：", err);
    })

  }, []);
  return (
    <View style={{
      flex:1,
      flexDirection:'column'
    }}>
      <TextInput
        mode="flat"
        right={<TextInput.Icon icon="chevron-up" onPress={() => handleSend(input)} />}
        onChangeText={(t) => setInput(t)}
        value={input}
      />
      {data && <MapDisplayer imageUri={data.imageUri} title={data.title} node={data.node} />}
    </View>
  )
}