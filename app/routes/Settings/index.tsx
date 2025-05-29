import Constants from 'expo-constants';
import React, {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {Button, List, SegmentedButtons, Text, TextInput, useTheme} from 'react-native-paper';
import {useAppContextPreference} from '@/context/store/AppPreferenceContext';
import useDialog from "@/hooks/useDialog";
import {useStore} from "@/context/store/StoreContext";

export default function SettingsRoute() {
  const {preference: {apiKey, theme}, updatePreference} = useAppContextPreference();
  const globalTheme = useTheme();
  const [apiKeyInput, setApiKeyInput] = useState<string>(apiKey);
  const [dialog, showDialog] = useDialog();
  const {removeHistory} = useStore();
  const handleSaveApiKey = () => {
    updatePreference('apiKey', apiKeyInput);
    console.log('API 密钥已保存：', apiKey);
  };
  const handleClearHistory = () => {
    removeHistory();
    console.log('清理历史记录');
  };
  const handleCancelClearHistory = () => {
    console.log('取消清理历史记录');
  };


  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text variant="titleLarge">Settings</Text>
        <List.Section title="主题">
          <SegmentedButtons
            value={theme}
            onValueChange={(value) => updatePreference('theme', value)}
            buttons={[
              {
                value: 'light',
                label: '浅色',
                icon: 'lightbulb-outline',
              },
              {
                value: 'dark',
                label: '深色',
                icon: 'weather-night',
              },
              {
                value: 'system',
                label: '跟随系统',
                icon: 'brightness-auto',
              },
            ]}
            multiSelect={false}/>
        </List.Section>

        <List.Section title="API 密钥">
          <TextInput
            label="Gemini API 密钥"
            value={apiKeyInput}
            onChangeText={(text) => setApiKeyInput(text)}
            style={styles.input}
            secureTextEntry={true}
            submitBehavior='blurAndSubmit'
            onSubmitEditing={handleSaveApiKey}
          />
        </List.Section>
        <List.Section title="存储">
          <View style={styles.storeSection}>
            <Button mode="contained" onPress={
              () => showDialog(
                "确定清理所有历史数据?",
                () => (<Text>注意：该操作不可逆！</Text>),
                [
                  {
                    label: '确定', onPress: handleClearHistory
                  },
                  {
                    label: '取消', onPress: handleCancelClearHistory
                  },
                ],
              )
            }
            >清理应用数据</Button>
          </View>
        </List.Section>

        <List.Section title="应用信息" style={styles.listSection}>
          <List.Item
            title="版本"
            description={Constants.expoConfig?.version || '未知'}
            style={[
              styles.listItem,
              {
                backgroundColor: globalTheme.colors.surfaceVariant,
                borderTopEndRadius: 15,
                borderTopStartRadius: 15,
              }
            ]}
          />
          <List.Item
            title="构建号"
            description={Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || '未知'}
            style={[styles.listItem, {
              backgroundColor: globalTheme.colors.surfaceVariant,
              borderBottomEndRadius: 15,
              borderBottomStartRadius: 15
            }]}
          />
        </List.Section>
      </ScrollView>
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  input: {
    marginBottom: 16,
  },
  storeSection: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },


  listSection: {
    gap: 3
  },
  listItem: {}
});
