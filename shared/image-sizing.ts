import type { ImageGenerationInput } from "./types";

export const IMAGE_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2"] as const;
export const IMAGE_RESOLUTIONS = ["auto", "1K", "2K", "4K"] as const;
const sizes: Record<string, string> = { "1:1": "1024x1024", "3:4": "768x1024", "4:3": "1024x768", "9:16": "864x1536", "16:9": "1536x864", "2:3": "1024x1536", "3:2": "1536x1024" };

export function resolveImageSizing(input: ImageGenerationInput, reference?: { width: number; height: number }) {
  const resolution = input.aspectRatio === "custom" ? "auto" : input.resolution || "auto";
  if (!IMAGE_RESOLUTIONS.includes(resolution)) throw new Error("清晰度检查：请选择默认、1K、2K 或 4K。");
  if (resolution !== "auto" && resolution !== "1K" && /gpt-image-1(?:\D|$)|dall-e/i.test(input.model || "")) throw new Error("清晰度检查：当前模型未声明支持 2K / 4K，请选择默认或 1K。");
  const sized = (ratio: typeof IMAGE_RATIOS[number]) => {
    if (resolution === "auto") return { size: sizes[ratio], aspectRatio: ratio, label: `${ratio} · ${sizes[ratio]}` };
    const gpt2 = /gpt-image-2\b/i.test(input.model || "");
    const edge = Math.min(resolution === "4K" ? 4096 : resolution === "2K" ? 2048 : 1024, gpt2 ? 3840 : 4096);
    const r = ratioNumber(ratio);
    let width = Math.round((r >= 1 ? edge : edge * r) / 16) * 16;
    let height = Math.round((r >= 1 ? edge / r : edge) / 16) * 16;
    if (gpt2 && width * height > 8294400) {
      const scale = Math.sqrt(8294400 / (width * height));
      width = Math.floor(width * scale / 16) * 16; height = Math.floor(height * scale / 16) * 16;
    }
    if (gpt2 && width * height < 655360) {
      const scale = Math.sqrt(655360 / (width * height));
      width = Math.ceil(width * scale / 16) * 16; height = Math.ceil(height * scale / 16) * 16;
    }
    return { size: `${width}x${height}`, aspectRatio: ratio, label: `${resolution} · ${ratio} · ${width}×${height}` };
  };
  const selection = input.aspectRatio;
  if (selection === "auto") {
    if (!reference) return resolution !== "auto" ? sized("1:1") : { size: "auto", aspectRatio: undefined, label: "自动（模型默认）" };
    const ratio = [...IMAGE_RATIOS].sort((a, b) => Math.abs(Math.log(ratioNumber(a) / (reference.width / reference.height))) - Math.abs(Math.log(ratioNumber(b) / (reference.width / reference.height))))[0];
    return { ...sized(ratio), label: `自动：参考图 ${reference.width}×${reference.height} → ${sized(ratio).label}` };
  }
  if (selection && selection !== "custom") {
    if (!sizes[selection]) throw new Error("尺寸检查：不支持该比例。");
    return sized(selection);
  }
  if (input.size === "auto") return { size: "auto", aspectRatio: undefined, label: "自动（模型默认）" };
  const match = /^(\d{1,5})x(\d{1,5})$/.exec(input.size);
  if (!match || [Number(match[1]), Number(match[2])].some((value) => value < 1 || value > 16384)) throw new Error("尺寸检查：宽高须为 1 至 16384 的整数。");
  const width = Number(match[1]), height = Number(match[2]);
  const ratio = IMAGE_RATIOS.find((value) => Math.abs(ratioNumber(value) - width / height) < 0.002);
  return { size: `${width}x${height}`, aspectRatio: ratio, label: `自定义 ${width}×${height}` };
}

function ratioNumber(value: string) { const [width, height] = value.split(":").map(Number); return width / height; }
