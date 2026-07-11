import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AttachmentKind, MessageAttachment } from "../../shared/types";
import { getStoragePath } from "./storage-path";

const ATTACHMENTS_DIR = "attachments";
const MAX_TEXT_CHARS = 12000;
const MAX_TEXT_FILE_BYTES = 1024 * 1024 * 2;

export async function prepareAttachments(filePaths: string[]): Promise<MessageAttachment[]> {
  const uniquePaths = Array.from(new Set((filePaths ?? []).map((item) => item.trim()).filter(Boolean)));
  const results: MessageAttachment[] = [];
  for (const filePath of uniquePaths) {
    results.push(await prepareAttachment(filePath));
  }
  return results;
}

async function prepareAttachment(filePath: string): Promise<MessageAttachment> {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`附件不是有效文件: ${filePath}`);
  }

  const parsed = path.parse(filePath);
  const ext = parsed.ext.toLowerCase();
  const mimeType = guessMimeType(ext);
  const kind: AttachmentKind = mimeType.startsWith("image/") ? "image" : "document";
  const id = randomUUID();
  const dateDir = new Date().toISOString().slice(0, 10);
  const targetDir = path.join(getStoragePath(), ATTACHMENTS_DIR, dateDir);
  await fs.promises.mkdir(targetDir, { recursive: true });
  const storedPath = path.join(targetDir, `${id}${ext}`);
  await fs.promises.copyFile(filePath, storedPath);

  const extractedText = kind === "document" ? await tryExtractText(filePath, ext, stat.size) : undefined;
  const previewDataUrl = kind === "image" ? await tryBuildImagePreview(storedPath, mimeType, stat.size) : undefined;
  const note = buildNote(kind, ext, extractedText);

  return {
    id,
    name: parsed.base,
    originalPath: filePath,
    storedPath,
    mimeType,
    size: stat.size,
    kind,
    extractedText,
    previewDataUrl,
    note,
  };
}

function buildNote(kind: AttachmentKind, ext: string, extractedText?: string) {
  if (kind === "image") {
    return "已附加图片";
  }
  if (extractedText) {
    return "已提取文本内容";
  }
  if (isTextLikeExtension(ext)) {
    return "文件较大，未完整提取";
  }
  return "当前版本暂不直接解析此文档格式，将仅附带文件信息";
}

async function tryExtractText(filePath: string, ext: string, size: number) {
  if (!isTextLikeExtension(ext)) {
    return undefined;
  }
  if (size > MAX_TEXT_FILE_BYTES) {
    const text = await fs.promises.readFile(filePath, "utf-8").catch(() => "");
    return text ? text.slice(0, MAX_TEXT_CHARS) : undefined;
  }
  const text = await fs.promises.readFile(filePath, "utf-8").catch(() => "");
  const normalized = text.replace(/\u0000/g, "").trim();
  return normalized ? normalized.slice(0, MAX_TEXT_CHARS) : undefined;
}

async function tryBuildImagePreview(filePath: string, mimeType: string, size: number) {
  if (size > 1024 * 1024 * 3) {
    return undefined;
  }
  const buffer = await fs.promises.readFile(filePath).catch(() => null);
  if (!buffer) {
    return undefined;
  }
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function isTextLikeExtension(ext: string) {
  return new Set([
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".csv",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".java",
    ".go",
    ".rs",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".html",
    ".css",
    ".scss",
    ".less",
    ".xml",
    ".yaml",
    ".yml",
    ".ini",
    ".toml",
    ".sql",
    ".log",
    ".bat",
    ".ps1",
    ".sh",
  ]).has(ext);
}

function guessMimeType(ext: string) {
  const table: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return table[ext] ?? "application/octet-stream";
}

export function formatAttachmentsForPrompt(attachments: MessageAttachment[]) {
  if (!attachments.length) {
    return "";
  }
  return attachments
    .map((attachment, index) => {
      const header = `附件${index + 1}：${attachment.name} (${attachment.kind === "image" ? "图片" : "文档"})`;
      const meta = [`mime=${attachment.mimeType}`, `size=${attachment.size}`];
      const body =
        attachment.kind === "document"
          ? attachment.extractedText
            ? `提取内容：\n${attachment.extractedText}`
            : `说明：${attachment.note ?? "未提取到正文内容"}`
          : `说明：${attachment.note ?? "已上传图片，请结合上下文处理"}`;
      return `${header}\n${meta.join(" | ")}\n${body}`;
    })
    .join("\n\n");
}

export function copyAttachmentDirectory(oldPath: string, newPath: string) {
  const sourceDir = path.join(oldPath, ATTACHMENTS_DIR);
  const targetDir = path.join(newPath, ATTACHMENTS_DIR);
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

export async function imageAttachmentToDataUrl(attachment: MessageAttachment) {
  if (attachment.kind !== "image") {
    return "";
  }
  if (attachment.previewDataUrl) {
    return attachment.previewDataUrl;
  }
  const buffer = await fs.promises.readFile(attachment.storedPath).catch(() => null);
  if (!buffer) {
    return "";
  }
  const mimeType = attachment.mimeType || "image/png";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
