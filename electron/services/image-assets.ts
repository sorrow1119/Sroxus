import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import bmp from "bmp-js";
import type { ImageAsset, ImageHistoryEntry } from "../../shared/types";
import { getStoragePath } from "./storage-path";
import { isMediaTaskDeleted, markMediaTaskDeleted } from "./media-task-deletions";

const extensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const MAX_BYTES = 20 * 1024 * 1024;
const thumbnails = new Map<string, string>();

export function imageAsset(filePath: string, allowInvalid = false): ImageAsset {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath) || !extensions.has(path.extname(filePath).toLowerCase())) {
    throw new Error("参考图检查：仅支持本地 PNG、JPEG、WebP、GIF、BMP 图片。");
  }
  const real = fs.realpathSync(filePath);
  if (!extensions.has(path.extname(real).toLowerCase())) throw new Error("参考图检查：图片链接目标格式不受支持。");
  const stat = fs.statSync(real);
  if (!stat.isFile()) throw new Error("参考图检查：目标不是图片文件。");
  const error = stat.size === 0 || stat.size > MAX_BYTES ? "单张图片须为 1 字节至 20 MB" : undefined;
  if (error && !allowInvalid) throw new Error(`参考图检查：${error}。`);
  return { path: real, name: path.basename(real), bytes: stat.size, modifiedAt: stat.mtimeMs, ...(error ? { error } : {}) };
}

async function decodeImage(filePath: string) {
  const asset = imageAsset(filePath);
  const buffer = await fs.promises.readFile(asset.path);
  try {
    let image: ReturnType<typeof sharp>;
    if (buffer.toString("ascii", 0, 2) === "BM") {
      if (buffer.length < 54 || buffer.readUInt32LE(14) < 40) throw new Error("不支持该 BMP 编码");
      const width = Math.abs(buffer.readInt32LE(18)), height = Math.abs(buffer.readInt32LE(22));
      if (!width || !height || width * height > 40_000_000) throw new Error("BMP 超过 4000 万像素");
      const decoded = bmp.decode(buffer);
      const rgb = Buffer.alloc(decoded.width * decoded.height * 3);
      for (let i = 0, j = 0; i < decoded.data.length; i += 4, j += 3) { rgb[j] = decoded.data[i + 3]; rgb[j + 1] = decoded.data[i + 2]; rgb[j + 2] = decoded.data[i + 1]; }
      image = sharp(rgb, { raw: { width: decoded.width, height: decoded.height, channels: 3 } });
    } else {
      image = sharp(buffer, { animated: false, page: 0, limitInputPixels: 40_000_000, failOn: "error" });
    }
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) throw new Error("超过 4000 万像素");
    if (!['png','jpeg','webp','gif','raw'].includes(metadata.format || '')) throw new Error("不支持该图片内容格式");
    const swapped = (metadata.orientation || 1) >= 5;
    return { asset, image: image.rotate(), width: swapped ? metadata.height : metadata.width, height: swapped ? metadata.width : metadata.height };
  } catch (error) {
    throw new Error(`图片解码失败：${asset.name} 文件损坏、格式不支持或像素过大。${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function readReference(filePath: string) {
  const decoded = await decodeImage(filePath);
  const buffer = await decoded.image.png().toBuffer();
  if (buffer.length > MAX_BYTES) throw new Error(`参考图转换失败：${decoded.asset.name} 转换后超过 20 MB。`);
  return { asset: decoded.asset, width: decoded.width, height: decoded.height, buffer, mime: "image/png", uploadName: `${path.parse(decoded.asset.name).name}.png`, dataUrl: `data:image/png;base64,${buffer.toString("base64")}` };
}

export async function imageDimensions(buffer: Buffer) {
  const metadata = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
  return { width: metadata.width, height: metadata.height };
}

export async function listGallery(folder: string): Promise<ImageAsset[]> {
  if (typeof folder !== "string" || !path.isAbsolute(folder)) throw new Error("图库读取：请选择有效的本地文件夹。");
  const entries = await fs.promises.readdir(folder, { withFileTypes: true });
  const result: ImageAsset[] = [];
  for (const item of entries) {
    if (!item.isFile() || !extensions.has(path.extname(item.name).toLowerCase())) continue;
    try { result.push(imageAsset(path.join(folder, item.name), true)); } catch { /* Files removed during enumeration are skipped. */ }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export async function thumbnail(filePath: string, variant: "gallery" | "result" = "gallery") {
  const asset = imageAsset(filePath);
  const edge = variant === "result" ? 960 : 240;
  const key = `${asset.path}:${asset.modifiedAt}:${asset.bytes}:${edge}`;
  const cached = thumbnails.get(key);
  if (cached) return cached;
  const { image } = await decodeImage(asset.path);
  const buffer = await image.resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const result = `data:image/png;base64,${buffer.toString("base64")}`;
  while (thumbnails.size && (thumbnails.size >= 96 || [...thumbnails.values()].reduce((sum, value) => sum + value.length, 0) + result.length > 40 * 1024 * 1024)) thumbnails.delete(thumbnails.keys().next().value!);
  thumbnails.set(key, result);
  return result;
}

// Reserve the output atomically; never replace a source or earlier generation.
export function writeGeneratedImage(buffer: Buffer, ext: string, source?: string) {
  const dir = path.join(getStoragePath(), "generated-images", "workspace");
  fs.mkdirSync(dir, { recursive: true });
  const stem = source ? path.parse(source).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100)
    : `sroxus-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  for (let index = 1; index <= 99999; index++) {
    const name = `${stem}-${String(index).padStart(2, "0")}.${ext}`;
    const filePath = path.join(dir, name);
    try {
      fs.writeFileSync(filePath, buffer, { flag: "wx" });
      return { path: filePath, name };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("图片保存：来源名称序号已用完，请更换来源文件名。");
}

function historyPath() { return path.join(getStoragePath(), "generated-images", "workspace-history.json"); }

export function readImageHistory(): ImageHistoryEntry[] {
  const file = historyPath();
  if (!fs.existsSync(file)) return [];
  try {
    const result: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(result)) throw new Error("invalid history");
    return (result as ImageHistoryEntry[]).filter((entry) => !isMediaTaskDeleted("image", entry.id));
  } catch {
    throw new Error("生成记录读取失败：原记录已保留，请检查 workspace-history.json；未覆盖旧记录。");
  }
}

export function writeImageHistory(entries: ImageHistoryEntry[]) {
  const file = historyPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entries.filter((entry) => !isMediaTaskDeleted("image", entry.id)), null, 2), "utf8");
  fs.renameSync(temporary, file);
}

export function updateImageHistory(entry: ImageHistoryEntry) {
  if (isMediaTaskDeleted("image", entry.id)) return;
  const entries = readImageHistory();
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index < 0) entries.unshift(entry); else entries[index] = entry;
  writeImageHistory(entries);
}

export function deleteImageTask(id: string) {
  markMediaTaskDeleted("image", id);
  writeImageHistory(readImageHistory().filter((entry) => entry.id !== id));
}
