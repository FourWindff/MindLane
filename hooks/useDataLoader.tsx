import { useEffect, useState } from 'react';
import {loadJsonDataSync, saveJsonDataSync} from "@/utils/filesystem/file";


function useDataLoader<T>(filePath: string, defaultData: T): [T, (newData: T) => void, boolean] {
  const [data, setData] = useState<T>(defaultData);
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
  }, [filePath]);

  return [data, updateData, loading];
}

export default useDataLoader;
