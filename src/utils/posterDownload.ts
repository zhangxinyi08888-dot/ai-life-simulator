import { toPng } from "html-to-image";

export type PosterExporter = (
  element: HTMLElement,
  options: { pixelRatio: number; cacheBust: boolean; backgroundColor?: string }
) => Promise<string>;

export interface DownloadPosterInput {
  element: HTMLElement | null;
  fileName: string;
  pixelRatio?: number;
  exporter?: PosterExporter;
}

function sanitizeDownloadName(value: string): string {
  const clean = value.replace(/[\\/:*?"<>|.]+/g, "").replace(/\s+/g, "").replace(/png$/i, "");
  return `${clean || "人生终章"}.png`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload = ""] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);base64/)?.[1] || "image/png";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

export async function downloadPoster(input: DownloadPosterInput): Promise<void> {
  if (!input.element) {
    throw new Error("海报节点不存在，无法下载图片。");
  }

  const exporter = input.exporter || toPng;
  const dataUrl = await exporter(input.element, {
    pixelRatio: input.pixelRatio || 2,
    cacheBust: true,
    backgroundColor: "#0f172a"
  });
  const blob = dataUrlToBlob(dataUrl);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = sanitizeDownloadName(input.fileName);
  link.click();
  URL.revokeObjectURL(url);
}
