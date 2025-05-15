# 技术栈

## [Expo](https://expo.dev/go)

- [入门教程](https://docs.expo.dev/tutorial/overview/)

### 介绍

- Expo是一个React Native框架（用html、js写移动端的框架、和html不同的是，RN不允许使用HTML标签，而是使用RN自己提供的标签，可以使用js，但不是node环境。），里面有许多写好的模块，例如状态栏、摄像头、图片、其他调用手机硬件或信息的库。
- 在学会使用这个框架之前你需要先学会
  - [React](https://react.dev/)（6个函数）
    - **React=JSX+Hooks**。只需要先学会useState和useEffcet两个钩子的用法那么你就已经会React了。React的官方教程是我见过最容易上手的教程建议细看。注意我们的项目使用函数式组件、类组件不用学。
    - 优化 useCallback、useMemo。（避免代价高的重复渲染）
    - 状态管理 useContext、useReducer（全局提供数据）。
  - [React Native](https://reactnative.dev/)（了解）
    - RN你需要了解它的布局和样式，和CSS几乎一样，主要是flex布局需要重点看一下。
    - 我们的应用会结合React Native Paper 组件库写，所以原生的组件知道是做什么的就好了例如（按钮Button，触摸组件TouchableOpacity、Pressable）。原生有的，Paper里也有。
- HTML、RN组件对比

|   HTML   | ReactNative |
| :-------: | :---------: |
|    div    |    View    |
|  button  |   Button   |
|     h     |    Text    |
| textInput |  TextInput  |

### 环境搭建

- 开发使用Expo Go或者构建版本都可以。
- 从Expo Go到开发构建版本可以无缝衔接的，也就是说你使用了Expo Go启动项目后还能转开发构建版本（类似Expo GO模拟器但是自由度更高、支持自定义模块），我们大概率不会自定义模块，所以简单点使用Expo Go就行了，但是最终一定会通过构建版本的Expo来打包发布的。使用Expo Go的缺点就是Expo 更新了你的Expo Go也要更新对版本要求比较高。
- 版本要求
  - SDK53
  - 使用Expo Go（Expo Go）

## [React Native Paper](https://reactnativepaper.com/)

- 一个遵循Material Design设计的UI库

## [React Native Bottom Sheet](https://gorhom.dev/react-native-bottom-sheet/)

- 手机屏幕下方的底部抽屉

## [Gemini](https://ai.google.dev/gemini-api/docs?hl=zh-cn)

- [Google AI for Developers](https://ai.google.dev/gemini-api/docs?hl=zh-cn)
- [Google Gemini CookBook](https://github.com/google-gemini/cookbook)
- [提示工程](https://ai.google.dev/gemini-api/docs/prompting-strategies?hl=zh-cn)
- [开源AI工具系统提示](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools)

### 准备

1. 需要一个好的IP
2. 到[Google Cloud](https://cloud.google.com/))新建一个项目
3. 到[Google AI Studio](https://aistudio.google.com/prompts/new_chat)创建API KEY
   - 每个api key 允许每分钟15分钟的请求
   - gemini-2.0-flash（支持图片输入，不支持图片输出）
   - gemini-2.0-flash-exp（支持图片输出，不支持结构化输出）（部分国家或地区不支持图片生成功能）
4. 安装[Google GenAI SDK](https://github.com/googleapis/js-genai)

### MindLane说明

#### Map

- 单轮对话
- 记忆宫殿功能需要用到两个模型，因为gemini-2-exp结构化输出不稳定，也就是说需要让gemini-2-exp先生成图片然后发给gemini-2-flash分析给出结构化输出（地点的位置、记忆的内容、记忆方法等）(gemini-2.0-flash-preview-image-generation、gemini-2-exp文档说是支持结构化输出的，但是我没成功过。)

#### Flow

- 需要多轮对话
- 该功能需要调用一个模型即可，问题丢给AI然后让ai生成解决问题的步骤，我们需要把这些步骤呈现出来，后续可以针对某个步骤接着对话，如果又生成新的步骤，需要渲染出来。

# 模块

- 优先使用expo自带的模块。

### 文件系统

- `expo-file-system`
- `expo-sqlite`
- 一般结合 `useContext`和 `useReducer`，然后封装成Provider组件去包裹根组件。子组件通过 `useContext`或者自定义hook获取状态，通过dispatch修改状态。
- 该模块用来保存AI对话生成的数据，以及用户发送的图片、AI生成的图片，偏好设置（主题、API Key等）。偏好设置使用json存储，可以自己加载json文件或者使用 React Native Async Storage存储库。

# 开始

1. 新建 `.env`文件
2. ```
   EXPO_PUBLIC_GEMINI_API_KEY=你的密钥
   ```
3. ```
   npx expo start
   ```
