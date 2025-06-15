import { useEffect, useState } from "react";
import { loadJsonDataSync, saveJsonDataSync } from "@/utils/filesystem/file";

/*
 * 自定义Hook用于加载和更新JSON数据
 * @param filePath - 文件路径
 * @param defaultData - 默认数据，当文件不存在时使用
 * @returns [data, updateData, loading] - 返回数据、更新函数和加载状态
 *
 * @example
 * const [data, updateData, loading] = useDataLoader<MyDataType>('path/to/file.json', defaultData);
 */

// 重载签名1：如果提供了 defaultData (类型为 T)，则返回的 data 确定为 T
export default function useDataLoader<T>(
  filePath: string,
  defaultData: T
): [T, (newData: T) => void, boolean];

// 重载签名2：如果 defaultData 是可选的或未提供，则返回的 data 可能为 T | undefined
export default function useDataLoader<T>(
  filePath: string,
  defaultData?: T
): [T | undefined, (newData: T) => void, boolean];

// 实现签名：实际的函数实现，内部仍处理 T | undefined
export default function useDataLoader<T>(
  filePath: string,
  defaultData?: T
): [T | undefined, (newData: T) => void, boolean] {
  const [data, setData] = useState<T | undefined>(defaultData);
  const [loading, setLoading] = useState<boolean>(true);

  const updateData = (newData: T) => {
    setData(newData);
    saveJsonDataSync(filePath, newData);
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const loadedData = await loadJsonDataSync(filePath, defaultData);
        setData(loadedData);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [defaultData, filePath]);

  return [data, updateData, loading];
}
