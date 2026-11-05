import { fetchAssetBlobUrl, type AssetBlobUrl } from './api.ts';

/** Owns both resolved blobs and in-flight requests for one manifest snapshot. */
export function loadPreviewAssets(
  projectId: string,
  assetIds: string[],
  publish: (urls: Record<string, string>, failed: string[]) => void,
  fetchAsset = fetchAssetBlobUrl,
): () => void {
  const controller = new AbortController();
  const owned: AssetBlobUrl[] = [];
  const urls: Record<string, string> = {};
  const failed: string[] = [];
  void Promise.all(assetIds.map(async assetId => {
    try {
      const blob = await fetchAsset(projectId, assetId, controller.signal);
      if (controller.signal.aborted) { blob.revoke(); return; }
      owned.push(blob);
      urls[assetId] = blob.url;
    } catch {
      if (!controller.signal.aborted) failed.push(assetId);
    }
  })).then(() => {
    if (!controller.signal.aborted) publish(urls, failed);
  });
  return () => {
    controller.abort();
    for (const blob of owned) blob.revoke();
  };
}
