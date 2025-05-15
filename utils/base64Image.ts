export async function convert2Image64(imagePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fetch(imagePath)
      .then((res) => res.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result as string;
          // const base64Data = base64String.split(',')[1];
          resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      })
      .catch(reject);
  });
}
