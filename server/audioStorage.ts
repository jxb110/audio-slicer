import { storagePut } from "./storage";
import { ENV } from "./_core/env";

function sanitizeFileName(name: string): string {
  const normalized = name.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").trim();
  return (normalized || "audio.wav").slice(0, 180);
}

/**
 * 为浏览器生成一次性对象存储直传地址。
 * 文件不会经过应用服务器，从而避免长音频在 Node 或浏览器 API 层被整段复制。
 */
export async function createAudioUploadIntent(input: {
  userId: number;
  audioId: string;
  fileName: string;
}): Promise<{ uploadUrl: string; storageKey: string; storageUrl: string }> {
  const forgeUrl = ENV.forgeApiUrl?.replace(/\/+$/, "");
  const forgeKey = ENV.forgeApiKey;
  if (!forgeUrl || !forgeKey) {
    throw new Error("对象存储配置不可用");
  }

  const storageKey = `audio-slicer/users/${input.userId}/${input.audioId}/${sanitizeFileName(input.fileName)}`;
  const presignUrl = new URL("v1/storage/presign/put", `${forgeUrl}/`);
  presignUrl.searchParams.set("path", storageKey);

  const response = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });
  if (!response.ok) {
    throw new Error(`无法获取音频上传地址（${response.status}）`);
  }

  const payload = (await response.json()) as { url?: string };
  if (!payload.url) throw new Error("上传地址为空");

  return {
    uploadUrl: payload.url,
    storageKey,
    storageUrl: `/manus-storage/${storageKey}`,
  };
}

/**
 * 同源上传代理使用的持久化入口。浏览器只向应用域名上传，避免对象存储桶CORS策略
 * 阻断预签名PUT；服务端再通过已配置凭据写入对象存储。
 */
export async function storeAudioUpload(input: {
  userId: number;
  audioId: string;
  fileName: string;
  contentType: string;
  data: Buffer;
}): Promise<{ storageKey: string; storageUrl: string }> {
  const relKey = `audio-slicer/users/${input.userId}/${input.audioId}/${sanitizeFileName(input.fileName)}`;
  const { key, url } = await storagePut(relKey, input.data, input.contentType || "application/octet-stream");
  return { storageKey: key, storageUrl: url };
}
