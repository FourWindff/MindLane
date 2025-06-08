import { Asset } from "expo-asset";

const imageSize = 1024;
const placeholderImageURL = `https://picsum.photos/${imageSize}`;

export async function fetchImage2Base64(imagePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fetch(imagePath)
      .then((res) => res.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result as string;
          const base64Data = base64String.split(",")[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      })
      .catch(reject);
  });
}

export async function getStaticBase64Image(): Promise<string> {
  try {
    const data = Asset.fromModule(
      require("../assets/images/ai-test-image.png")
    );
    return await fetchImage2Base64(data.uri);
  } catch (e) {
    console.log(e);
    return await fetchImage2Base64(placeholderImageURL);
  }
}
