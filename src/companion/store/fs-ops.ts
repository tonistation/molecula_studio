import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';

/** Subset of `fs.Stats` the store relies on. */
export interface FsStats {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  size: number;
}

/**
 * Filesystem seam used by the store.
 *
 * Production uses `createNodeFsOps()`. Tests wrap it to inject faults at the
 * exact commit phase (write, file fsync, rename, directory fsync) while still
 * operating on a real temporary directory.
 */
export interface FsOps {
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<FsStats>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** Creates or truncates a file and writes all bytes. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Creates a file exclusively; fails with EEXIST when it already exists. */
  writeFileExclusive(path: string, data: Uint8Array): Promise<void>;
  /** Opens an existing file, flushes it to the OS and closes it. */
  syncFile(path: string): Promise<void>;
  /** Flushes a directory entry list where the platform supports it. */
  syncDir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
}

export function createNodeFsOps(): FsOps {
  return {
    async mkdir(path, options) {
      await mkdir(path, { recursive: options.recursive });
    },
    realpath,
    lstat,
    readdir,
    async readFile(path) {
      return new Uint8Array(await readFile(path));
    },
    async writeFile(path, data) {
      const handle = await open(path, 'w');
      try {
        await handle.writeFile(data);
      } finally {
        await handle.close();
      }
    },
    async writeFileExclusive(path, data) {
      const handle = await open(path, 'wx');
      try {
        await handle.writeFile(data);
      } finally {
        await handle.close();
      }
    },
    async syncFile(path) {
      const handle = await open(path, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    async syncDir(path) {
      const handle = await open(path, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    rename,
    unlink,
    async rm(path, options) {
      await rm(path, options);
    },
    copyFile,
  };
}

export function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}
