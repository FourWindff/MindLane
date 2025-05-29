import {ensureFileExist, IMAGES_DIR} from "@/utils/filesystem/path";
import {File, Paths} from "expo-file-system/next";
import * as FileSystem from 'expo-file-system';


export async function saveImage(base64Data: string, mimeType: string = "image/png"): Promise<string | null> {
  const isImage = mimeType.startsWith('image/');
  const extName = mimeType.split('/')[1];
  if (!isImage || extName.trim() === '') return null;
  const savePath = Paths.join(IMAGES_DIR, `img_${Date.now()}.png`);
  ensureFileExist(savePath);
  try {
    await FileSystem.writeAsStringAsync(savePath, base64Data, {
      encoding: FileSystem.EncodingType.Base64
    });
    console.log(`Saved image to ${savePath}`);
    return savePath;
  } catch (error) {
    console.log(error)
    return null;
  }
}

export async function readImageAsBase64(filepath: string): Promise<string | null> {
  const file = new File(filepath);
  if (!file.exists) {
    console.log(`File ${filepath} does not exist`);
    return null;
  }
  try {
    console.log(`Read image from ${filepath}`);
    return file.base64();
  } catch (error) {
    console.log(error)
    return null;
  }
}
