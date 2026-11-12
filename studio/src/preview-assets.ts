import { fetchAssetBlobUrl, type AssetBlobUrl } from './api.ts';

const PREVIEW_ASSET_TIMEOUT_MS = 15_000;

/** Owns both resolved blobs and in-flight requests for one manifest snapshot. */
export function loadPreviewAssets(
  projectId: string,
  assetIds: string[],
  publish: (urls: Record<string, string>, failed: string[]) => void,
  fetchAsset = fetchAssetBlobUrl,
  timeoutMs = PREVIEW_ASSET_TIMEOUT_MS,
): () => void {
  const owned: AssetBlobUrl[] = [];
  const urls: Record<string, string> = {};
  const failed: string[] = [];
  let disposed = false;
  const cancel: (() => void)[] = [];
  void Promise.all(assetIds.map(assetId => new Promise<void>(resolve => {
    const controller = new AbortController();
    let settled = false;
    const finish = (failure: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failure && !disposed) failed.push(assetId);
      resolve();
    };
    const timer = setTimeout(() => { controller.abort(); finish(true); }, timeoutMs);
    cancel.push(() => { controller.abort(); finish(false); });
    void fetchAsset(projectId, assetId, controller.signal).then(blob => {
      if (settled || disposed) { blob.revoke(); return; }
      owned.push(blob);
      urls[assetId] = blob.url;
      finish(false);
    }, () => finish(true));
  }))).then(() => {
    if (!disposed) publish(urls, failed);
  });
  return () => {
    disposed = true;
    for (const stop of cancel) stop();
    for (const blob of owned) blob.revoke();
  };
}
