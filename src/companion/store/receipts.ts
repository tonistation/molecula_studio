/**
 * Receipt returned only after a commit reached its commit point.
 *
 * `sync: 'uncertain'` means the rename happened but the directory flush after
 * it failed. Callers must re-read and compare the digest before treating that
 * revision as durable; the store never claims `confirmed` in that case.
 */
export interface SaveReceipt {
  projectId: string;
  revision: number;
  digest: string;
  operationId: string;
  committedAt: string;
  sync: 'confirmed' | 'uncertain';
}

/** Result of re-reading a receipt's bytes and comparing them. */
export interface ReceiptVerification {
  projectId: string;
  revision: number | null;
  digest: string;
  confirmed: boolean;
}

export function isConfirmedReceipt(receipt: SaveReceipt): boolean {
  return receipt.sync === 'confirmed';
}
