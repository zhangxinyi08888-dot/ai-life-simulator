export interface DevTestStateFileResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type DevTestStateFileFetcher = (resourcePath: string) => Promise<DevTestStateFileResponse>;

/**
 * Resolves the deliberately narrow local-file reference used by the internal
 * browser-journey checkpoint importer.  The caller remains responsible for
 * exposing this only from the development-only importer UI.
 */
export async function resolveDevTestStateImportText(
  value: string,
  fetchFile: DevTestStateFileFetcher = (resourcePath) => fetch(resourcePath)
): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed.startsWith("@file:")) return value;

  const resourcePath = trimmed.slice("@file:".length);
  if (!resourcePath.startsWith("/@fs/")) {
    throw new Error("本地测试状态仅支持 /@fs/ 文件路径");
  }

  const response = await fetchFile(resourcePath);
  if (!response.ok) {
    throw new Error(`读取本地测试状态失败（${response.status}）`);
  }
  return response.text();
}
