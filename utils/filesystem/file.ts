import { File } from "expo-file-system/next";
import { ensureFileExist } from "@/utils/filesystem/path";

export function writeFile(
  filepath: string,
  content: string | Uint8Array
): boolean {
  const file = new File(filepath);
  ensureFileExist(filepath);
  try {
    file.write(content);
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
}

export function unlinkFile(filepath: string): boolean {
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
export function loadJsonDataSync<T>(filepath: string, defaultData: T): T;
export function loadJsonDataSync<T>(
  filepath: string,
  defaultData?: T
): T | undefined;
export function loadJsonDataSync<T>(
  filepath: string,
  defaultData?: T
): T | undefined {
  const file = new File(filepath);
  try {
    if (!file.exists) {
      if (defaultData !== undefined) {
        file.create();
        file.write(JSON.stringify(defaultData));
        console.log(
          `File ${filepath} does not exist. Created a new file with default data.`
        );
        return defaultData;
      } else {
        console.log(
          `File ${filepath} does not exist and no default data was provided.`
        );
        return undefined;
      }
    }
    const content = file.text();
    console.log(`Loaded json data from ${filepath}`);
    return JSON.parse(content) as T;
  } catch (error) {
    console.log(`Failed to load data from ${filepath}: ${error}`);
    return defaultData !== undefined ? defaultData : undefined;
  }
}

export function saveJsonDataSync<T>(filepath: string, data: T): void {
  const file = new File(filepath);
  try {
    ensureFileExist(filepath);
    file.write(JSON.stringify(data));
    console.log(`Saved json data to ${filepath}`);
  } catch (error) {
    console.log(`Failed to save data to ${filepath}: ${error}`);
  }
}
