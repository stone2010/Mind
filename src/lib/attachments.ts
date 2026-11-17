import type { Attachment } from "../types";
import { formatBytes } from "./utils";

const TEXT_EXT =
  /\.(txt|md|markdown|json|jsonl|csv|tsv|log|xml|yaml|yml|html|htm|css|scss|js|jsx|mjs|cjs|ts|tsx|py|java|kt|c|h|cpp|hpp|cs|go|rs|rb|php|sh|bash|ps1|sql|toml|ini|cfg|conf|env|tex|r|lua|swift|dart)$/i;

const MAX_TEXT_CHARS = 200_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsText(file, "utf-8");
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

export async function readAttachment(
  file: File,
): Promise<{ attachment?: Attachment; error?: string }> {
  if (file.size > MAX_FILE_BYTES) {
    return { error: `「${file.name}」超过 12 MB，暂不支持` };
  }

  const isImage = file.type.startsWith("image/");
  if (isImage) {
    if (file.size > MAX_IMAGE_BYTES) {
      return { error: `图片「${file.name}」超过 4 MB` };
    }
    const dataUrl = await readAsDataUrl(file);
    return {
      attachment: {
        name: file.name,
        size: file.size,
        mime: file.type,
        kind: "image",
        dataUrl,
      },
    };
  }

  const isText = TEXT_EXT.test(file.name) || file.type.startsWith("text/") ||
    file.type === "application/json" || file.type === "application/xml";
  if (isText) {
    const raw = await readAsText(file);
    const truncated = raw.length > MAX_TEXT_CHARS;
    return {
      attachment: {
        name: file.name,
        size: file.size,
        mime: file.type || "text/plain",
        kind: "text",
        text: truncated ? raw.slice(0, MAX_TEXT_CHARS) : raw,
        truncated,
      },
    };
  }

  return {
    error: `暂不支持「${file.name}」这种文件类型（${formatBytes(file.size)}）`,
  };
}
