import { File, Paths } from "expo-file-system/next";

export function isFileExist(filename: string) {
  const file = new File(Paths.document, filename);
  return file.exists;
}

export function ensureFileExist(filename: string) {
  const file = new File(Paths.document, filename);
  if (file.exists) return;
  try {
    file.create();
  } catch (error) {
    console.log(error);
  }
}

export function loadJsonDataSync<T>(filename: string, defaultData: T): T {
  const file = new File(Paths.document, filename);
  try {
    if (!file.exists) {
      file.create();
      file.write(JSON.stringify(defaultData));
      console.log(
        `File ${filename} does not exist. Created a new file with default data.`
      );
      return defaultData;
    }
    const content = file.text();
    console.log(`Loaded data from ${filename}`);
    return JSON.parse(content) as T;
  } catch (error) {
    console.log(`Failed to load data from ${filename}: ${error}`);
    return defaultData;
  }
}

export function saveJsonDataSync<T>(filename: string, data: T): void {
  const file = new File(Paths.document, filename);
  try {
    ensureFileExist(filename);
    file.write(JSON.stringify(data));
    console.log(`Saved data to ${filename}`);
  } catch (error) {
    console.log(`Failed to save data to ${filename}: ${error}`);
  }
}
