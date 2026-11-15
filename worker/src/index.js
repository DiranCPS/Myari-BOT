import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand,
  CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
  ListObjectsV2Command, DeleteObjectsCommand, GetObjectCommand,
  HeadObjectCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MAX_SIZE = 10 * 1024 * 1024 * 1024;
const PART_SIZE = 32 * 1024 * 1024;
const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const ORIGIN = "https://myaribot.mcv.kr";

function json(request, body, status = 200) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (request.headers.get("Origin") === ORIGIN) {
    headers["Access-Control-Allow-Origin"] = ORIGIN;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
    headers.Vary = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function s3(env) {
  return new S3Client({
    region: "auto",
    endpoint: "https://" + env.R2_ACCOUNT_ID + ".r2.cloudflarestorage.com",
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
}

async function editor(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization, "Content-Type": "application/json" };
  const userResponse = await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers });
  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  const roleResponse = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/is_site_editor", {
    method: "POST", headers, body: "{}",
  });
  if (!roleResponse.ok || await roleResponse.json() !== true) return null;
  return user;
}

function owns(key, user) {
  return typeof key === "string" && key.startsWith("uploads/" + user.id + "/") && key.length <= 1024;
}

async function handle(request, env) {
  if (request.method === "OPTIONS") return json(request, {});
  if (request.method !== "POST") return json(request, { error: "method_not_allowed" }, 405);
  if (request.headers.get("Origin") !== ORIGIN) return json(request, { error: "origin_not_allowed" }, 403);

  const user = await editor(request, env);
  if (!user) return json(request, { error: "Discord 로그인 권한을 확인해주세요." }, 401);
  let body;
  try { body = await request.json(); } catch { return json(request, { error: "invalid_json" }, 400); }

  const client = s3(env);
  const bucket = env.R2_BUCKET_NAME;

  if (body.action === "start") {
    const filename = String(body.filename || "").split(/[\\/]/).pop().replace(/[\r\n]/g, "").slice(0, 200);
    const size = Number(body.size);
    const channelId = String(body.channel_id || "");
    if (!filename || !/^\d{17,20}$/.test(channelId) || !Number.isSafeInteger(size) || size < 1 || size > MAX_SIZE) {
      return json(request, { error: "파일 이름, 채널 ID 또는 크기가 올바르지 않습니다." }, 400);
    }
    const safeName = filename.replace(/[^\p{L}\p{N}._() -]/gu, "_");
    const key = "uploads/" + user.id + "/" + crypto.randomUUID() + "/" + safeName;
    try {
      const created = await client.send(new CreateMultipartUploadCommand({
        Bucket: bucket, Key: key, ContentType: "application/octet-stream",
        ContentDisposition: "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
        Metadata: { "uploader-id": String(user.id), "channel-id": channelId },
      }));
      return json(request, { key, uploadId: created.UploadId, partSize: PART_SIZE });
    } catch (error) {
      console.error("multipart start failed", error);
      return json(request, { error: "업로드를 시작하지 못했습니다." }, 502);
    }
  }

  if (body.action === "sign-part") {
    const key = String(body.key || "");
    const uploadId = String(body.upload_id || "");
    const partNumber = Number(body.part_number);
    if (!owns(key, user) || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      return json(request, { error: "invalid_upload_part" }, 400);
    }
    try {
      const url = await getSignedUrl(client, new UploadPartCommand({
        Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber,
      }), { expiresIn: 3600 });
      return json(request, { url });
    } catch (error) {
      console.error("part signing failed", error);
      return json(request, { error: "업로드 주소를 만들지 못했습니다." }, 502);
    }
  }

  if (body.action === "abort") {
    const key = String(body.key || "");
    const uploadId = String(body.upload_id || "");
    if (!owns(key, user) || !uploadId) return json(request, { error: "invalid_upload" }, 400);
    try {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
      return json(request, { ok: true });
    } catch (error) {
      console.error("multipart abort failed", error);
      return json(request, { error: "업로드를 취소하지 못했습니다." }, 502);
    }
  }

  if (body.action === "complete") {
    const key = String(body.key || "");
    const uploadId = String(body.upload_id || "");
    const channelId = String(body.channel_id || "");
    const size = Number(body.size);
    const filename = String(body.filename || "").slice(0, 200);
    const parts = Array.isArray(body.parts) ? body.parts : [];
    const expectedParts = Math.ceil(size / PART_SIZE);
    if (!owns(key, user) || !uploadId || !/^\d{17,20}$/.test(channelId)
      || !Number.isSafeInteger(size) || size < 1 || size > MAX_SIZE
      || !filename || parts.length !== expectedParts || parts.length > 10000) {
      return json(request, { error: "invalid_upload_completion" }, 400);
    }
    try {
      const completedParts = parts.map((part, index) => ({
        PartNumber: index + 1,
        ETag: String(part.etag || ""),
      }));
      if (completedParts.some((part) => !part.ETag)) throw new Error("missing etag");
      await client.send(new CompleteMultipartUploadCommand({
        Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: completedParts },
      }));
      const stored = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      if (Number(stored.ContentLength) !== size) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return json(request, { error: "저장된 파일 크기가 요청과 달라 업로드를 취소했습니다." }, 400);
      }
      const downloadUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: 72 * 60 * 60,
      });
      const notify = await fetch(env.BOT_API_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + env.BOT_API_SECRET, "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId, filename, key, size, download_url: downloadUrl }),
      });
      if (!notify.ok) return json(request, { error: "파일은 저장됐지만 Discord 알림에 실패했습니다. 봇 API 설정을 확인해주세요." }, 502);
      return json(request, { ok: true });
    } catch (error) {
      console.error("multipart completion failed", error);
      return json(request, { error: "업로드 완료 처리에 실패했습니다." }, 502);
    }
  }

  return json(request, { error: "unknown_action" }, 400);
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (error) {
      console.error("upload worker error", error);
      return json(request, { error: "요청 처리 중 오류가 발생했습니다." }, 500);
    }
  },

  async scheduled(_controller, env) {
    const client = s3(env);
    const cutoff = new Date(Date.now() - RETENTION_MS);
    let continuationToken;
    do {
      const page = await client.send(new ListObjectsV2Command({
        Bucket: env.R2_BUCKET_NAME, Prefix: "uploads/", ContinuationToken: continuationToken, MaxKeys: 1000,
      }));
      const expired = (page.Contents || [])
        .filter((item) => item.Key && item.LastModified && item.LastModified <= cutoff)
        .map((item) => ({ Key: item.Key }));
      if (expired.length) {
        await client.send(new DeleteObjectsCommand({
          Bucket: env.R2_BUCKET_NAME, Delete: { Objects: expired, Quiet: true },
        }));
        console.log("deleted expired uploads", expired.length);
      }
      continuationToken = page.NextContinuationToken;
    } while (continuationToken);
  },
};
