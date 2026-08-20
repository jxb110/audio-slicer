import express, { type Express } from "express";
import { sdk } from "./_core/sdk";
import { storeAudioUpload } from "./audioStorage";

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

function sanitizeIncomingFileName(value: string | undefined): string {
  if (!value) return "audio.wav";
  try {
    return decodeURIComponent(value).slice(0, 512);
  } catch {
    return "audio.wav";
  }
}

/**
 * 将音频二进制先发送到同源服务器，再由服务器写入对象存储。
 * 该路由避免浏览器直接PUT至对象存储的CORS限制，并沿用登录会话来隔离用户目录。
 */
export function registerAudioUploadRoute(app: Express): void {
  app.post(
    "/api/audio/upload/:audioId",
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      try {
        const user = await sdk.authenticateRequest(req).catch(() => null);
        if (!user) {
          res.status(401).json({ error: "请先登录后再上传音频" });
          return;
        }
        const audioId = req.params.audioId;
        if (!/^[A-Za-z0-9_-]{6,64}$/.test(audioId)) {
          res.status(400).json({ error: "无效的音频标识" });
          return;
        }
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ error: "未收到音频内容" });
          return;
        }
        const result = await storeAudioUpload({
          userId: user.id,
          audioId,
          fileName: sanitizeIncomingFileName(req.header("x-audio-file-name")),
          contentType: req.header("content-type") || "application/octet-stream",
          data: req.body,
        });
        res.status(201).json(result);
      } catch (error) {
        console.error("[Audio Upload] Failed:", error);
        res.status(500).json({ error: "音频上传失败，请稍后重试" });
      }
    },
  );
}
