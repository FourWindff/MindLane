import {Directory, File, Paths} from "expo-file-system/next";

const MAP_DIR = "map";
const FLOW_DIR = "flow";


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

export function ensureDirExist(dirname: string) {
  const dir = new Directory(Paths.document, dirname);
  if (dir.exists) return;
  try {
    dir.create();
  } catch (error) {
    console.log(error);
  }
}

export function deleteFile(filepath: string): boolean {
  const file = new File(filepath);
  if (!file.exists) return false;
  try {
    file.delete();
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
}

export function saveFile(filepath: string, content: string | Uint8Array): boolean {
  const file = new File(filepath);
  try {
    file.write(content);
    return true;
  } catch (error) {
    console.log(error);
    return false;
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

export async function saveImage(base64Data: string, filename: string): Promise<string | null> {
  try {
    const dir = new Directory(Paths.document, MAP_DIR, getCurrentYearMonth());
    ensureDirExist(dir.uri);
    const file = new File(dir, filename);
    ensureDirExist(file.uri);

    file.write(base64Data);
    return file.uri;
  } catch (error) {
    console.log(error);
    return null;
  }
}

export function loadImageSync(filepath: string): string | null {
  if (!isFileExist(filepath)) return null;
  const file = new File(filepath);
  return file.text();
}

export function deleteImage(filepath: string): boolean {
  if (!isFileExist(filepath)) return false;
  const file = new File(filepath);
  try {
    file.delete();
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
}


/**
 * 获取当前年月，格式为"YYYY-MM"
 * @returns 返回格式为"YYYY-MM"的字符串，例如"2025-05"
 */
export function getCurrentYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  // getMonth() 返回 0-11，所以需要 +1
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}


