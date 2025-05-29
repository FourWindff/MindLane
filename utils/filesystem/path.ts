import {Directory, File, Paths} from "expo-file-system/next";

export const APP_DIR = Paths.document;
export const CACHE_DIR = Paths.cache;

export const MAP_DIR = Paths.join(APP_DIR, "map");
export const FLOW_DIR = Paths.join(APP_DIR, "flow");
export const IMAGES_DIR = Paths.join(APP_DIR, "images");


/**
 * 获取当前年月，格式为"YYYY-MM"
 * @returns 返回格式为"YYYY-MM"的字符串，例如"2025-05"
 */
export function getCurrentYearMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}


export function getUniqueNameInDir(filename: string, dirpath: string) {
  const dir = new Directory(dirpath);
  if (!dir.exists) throw new Error(`Directory ${dirpath} does not exist.`);

  const lastDotIndex = filename.lastIndexOf('.');
  const hasExtension = lastDotIndex !== -1;
  const name = hasExtension ? filename.substring(0, lastDotIndex) : filename;
  const extension = hasExtension ? filename.substring(lastDotIndex) : '';

  const file = new File(dir, filename);
  if (!file.exists) return filename;

  let counter: number = 1;
  let newFilename: string;
  do {
    newFilename = `${name} (${counter})${extension}`;
    const newFile = new File(dir, newFilename);
    if (!newFile.exists) return newFilename;
    counter++;
  } while (true);
}

export function isFileExist(filepath: string) {
  const file = new File(filepath);
  return file.exists;
}

export function ensureFileExist(filepath: string) {
  const file = new File(filepath);
  if (file.exists) return;
  try {
    file.create({intermediates: true});
  } catch (error) {
    console.log(error);
  }
}

export function ensureDirExist(dirpath: string) {
  const dir = new Directory(dirpath);
  if (dir.exists) return;
  try {
    dir.create({intermediates: true});
  } catch (error) {
    console.log(error);
  }
}
