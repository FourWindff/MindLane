import Constants from 'expo-constants';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { List, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { useAppContextPreference } from '../../../context/store/AppPreferenceContext';

export default function SettingsRoute() {
  const { preference: { apiKey, theme }, updatePreference } = useAppContextPreference();

  const [apiKeyInput, setApiKeyInput] = useState<string>(apiKey);

  const handleSaveApiKey = () => {
    updatePreference('apiKey', apiKeyInput);
    console.log('API 密钥已保存：', apiKey);
  };

  return (
    <View style={styles.container}>
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
        />
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

      <List.Section title="应用信息">
        <List.Item
          title="版本"
          description={Constants.expoConfig?.version || '未知'}
        />
        <List.Item
          title="构建号"
          description={Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || '未知'}
        />
      </List.Section>
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
});
