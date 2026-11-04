import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';

import { LIMITS } from '../../shared/schema/limits.ts';
import { ProjectStore, type WorkspaceOptions } from '../store/project-store.ts';
import {
  ConflictError,
  InvalidProjectError,
  StoreError,
  UnsafePathError,
} from '../store/errors.ts';

/**
 * Loopback companion boundary (architecture.md, "Seguridad local").
 *
 * - Binds loopback only and rejects any other `Host` header (DNS rebinding).
 * - Requires an ephemeral bearer token on every `/api` request. The token is
 *   never persisted, never placed in URLs and never logged.
 * - Rejects foreign `Origin` values; state-changing methods require an
 *   explicit allowed `Origin` (CSRF protection). No CORS headers are emitted.
 * - Endpoints take opaque project handles, never filesystem paths.
 */
export interface CompanionServerOptions {
  /** Authorized workspace directory (the only tree the API can touch). */
  workspaceRoot: string;
  /** 0 (default) picks an ephemeral port; useful for tests. */
  port?: number;
  /** Loopback host; only 127.0.0.1 is accepted. */
  host?: '127.0.0.1';
  /** Explicit token for tests; otherwise generated per start. */
  token?: string;
  /** Built studio directory served at `/`; missing directory reports 503. */
  studioDir?: string;
  /** Extra origins explicitly authorized (Vite dev), exact match only. */
  extraOrigins?: string[];
  /** Reclaim a stale workspace lock (dead owner) on start. */
  forceUnlock?: boolean;
  /** Reuse an initialized store (tests). */
  store?: ProjectStore;
  /** Injectable clock passed to the store when created here. */
  now?: () => Date;
}

export interface CompanionServer {
  readonly server: Server;
  readonly store: ProjectStore;
  readonly token: string;
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
}

const BODY_LIMIT = LIMITS.maxJsonBytes + 64 * 1024;
const TOKEN_HEADER = 'x-companion-token';

export async function startCompanionServer(options: CompanionServerOptions): Promise<CompanionServer> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1') {
    throw new Error('companion must bind loopback (127.0.0.1)');
  }
  if (typeof options.workspaceRoot !== 'string' || options.workspaceRoot.length === 0) {
    throw new Error('workspaceRoot must be a non-empty string');
  }

  const store = options.store ?? new ProjectStore({
    workspaceRoot: options.workspaceRoot,
    now: options.now,
  } satisfies WorkspaceOptions);
  if (options.store === undefined) {
    await store.init({ forceUnlock: options.forceUnlock === true });
  }

  const token = options.token ?? randomBytes(32).toString('hex');
  const state = { port: 0, origin: '' };

  const server = createServer((req, res) => {
    void handleRequest(req, res, { store, token, state, studioDir: options.studioDir, extraOrigins: options.extraOrigins });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('companion failed to bind a loopback port');
  }
  state.port = address.port;
  state.origin = `http://${host}:${address.port}`;

  return {
    server,
    store,
    token,
    origin: state.origin,
    port: state.port,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.close();
    },
  };
}

//#region request handling

interface HandlerContext {
  store: ProjectStore;
  token: string;
  state: { port: number; origin: string };
  studioDir: string | undefined;
  extraOrigins: string[] | undefined;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, context: HandlerContext): Promise<void> {
  try {
    assertHost(req, context);
    const url = new URL(req.url ?? '/', context.state.origin);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      assertOrigin(req, context);
      assertToken(req, context.token);
      await handleApi(req, res, pathname, context);
      return;
    }

    assertOrigin(req, context);
    await handleStatic(req, res, pathname, context);
  } catch (error) {
    const mapped = mapError(error);
    if (!res.headersSent) {
      if (error instanceof HttpError && error.allow !== undefined) {
        res.setHeader('allow', error.allow);
      }
      sendJson(res, mapped.status, mapped.body);
    } else {
      res.end();
    }
  }
}

function assertHost(req: IncomingMessage, context: HandlerContext): void {
  const hostHeader = req.headers.host;
  const allowed = new Set([`127.0.0.1:${context.state.port}`, `localhost:${context.state.port}`]);
  if (typeof hostHeader !== 'string' || !allowed.has(hostHeader)) {
    throw new HttpError(403, 'host-not-allowed', 'request Host is not the companion origin');
  }
}

function assertOrigin(req: IncomingMessage, context: HandlerContext): void {
  const allowed = new Set([
    `http://127.0.0.1:${context.state.port}`,
    `http://localhost:${context.state.port}`,
    ...(context.extraOrigins ?? []),
  ]);
  const origin = req.headers.origin;
  if (origin === undefined) {
    // Same-origin navigations and non-browser clients may omit Origin; any
    // state-changing request without one is rejected as a CSRF risk.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(403, 'origin-required', 'state-changing requests require an allowed Origin');
    }
    return;
  }
  if (!allowed.has(origin)) {
    throw new HttpError(403, 'origin-not-allowed', 'request Origin is not authorized');
  }
}

function assertToken(req: IncomingMessage, token: string): void {
  const authorization = req.headers.authorization;
  const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined;
  const headerToken = req.headers[TOKEN_HEADER];
  const provided = bearer ?? (typeof headerToken === 'string' ? headerToken : undefined);
  if (provided === undefined || !tokensMatch(provided, token)) {
    throw new HttpError(401, 'unauthorized', 'missing or invalid companion token');
  }
}

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

//#endregion request handling

//#region api

const PROJECT_ROUTE = /^\/api\/projects\/([a-z][a-z0-9_-]{0,63})(\/copy)?$/;

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, context: HandlerContext): Promise<void> {
  const { store } = context;
  const method = req.method ?? 'GET';

  if (pathname === '/api/health') {
    if (method !== 'GET') throw methodNotAllowed('GET');
    sendJson(res, 200, { ok: true, name: 'molecula-companion', workspace: 'authorized' });
    return;
  }

  if (pathname === '/api/projects') {
    if (method === 'GET') {
      const projects = await store.listProjects();
      sendJson(res, 200, { projects });
      return;
    }
    if (method === 'POST') {
      const body = await readJsonBody(req);
      const record = requireObject(body);
      const title = record.title;
      if (title !== undefined && typeof title !== 'string') {
        throw new HttpError(400, 'invalid-argument', 'title must be a string');
      }
      const created = await store.createProject(title === undefined ? {} : { title });
      sendJson(res, 201, created);
      return;
    }
    throw methodNotAllowed('GET, POST');
  }

  const match = PROJECT_ROUTE.exec(pathname);
  if (match === null) {
    throw new HttpError(404, 'not-found', 'unknown endpoint');
  }
  const projectId = match[1] as string;
  const isCopy = match[2] !== undefined;

  if (isCopy) {
    if (method !== 'POST') throw methodNotAllowed('POST');
    const body = await readJsonBody(req);
    const record = body === undefined ? {} : requireObject(body);
    const newProjectId = record.newProjectId;
    if (newProjectId !== undefined && typeof newProjectId !== 'string') {
      throw new HttpError(400, 'invalid-argument', 'newProjectId must be a string');
    }
    const copied = await store.saveCopy(newProjectId === undefined ? { projectId } : { projectId, newProjectId });
    sendJson(res, 201, copied);
    return;
  }

  if (method === 'GET') {
    const read = await store.readProject(projectId);
    sendJson(res, 200, read);
    return;
  }

  if (method === 'PUT') {
    const body = requireObject(await readJsonBody(req));
    const expectedRevision = body.expectedRevision;
    const operationId = body.operationId;
    if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new HttpError(400, 'invalid-argument', 'expectedRevision must be a non-negative safe integer');
    }
    if (typeof operationId !== 'string') {
      throw new HttpError(400, 'invalid-argument', 'operationId must be a string');
    }
    const project = body.project;
    if (project === null || typeof project !== 'object' || Array.isArray(project)) {
      throw new HttpError(400, 'invalid-argument', 'project must be an object');
    }
    const saved = await store.saveProject({
      projectId,
      project: project as never,
      expectedRevision,
      operationId,
    });
    sendJson(res, 200, saved);
    return;
  }

  throw methodNotAllowed('GET, PUT');
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported-media-type', 'Content-Type must be application/json');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    total += buffer.length;
    if (total > BODY_LIMIT) {
      throw new HttpError(413, 'body-too-large', `request body exceeds ${LIMITS.maxJsonBytes} bytes of JSON`);
    }
    chunks.push(buffer);
  }
  if (total === 0) {
    throw new HttpError(400, 'empty-body', 'request body is required');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'invalid-json', 'request body is not valid JSON');
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid-argument', 'request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function methodNotAllowed(allow: string): HttpError {
  return new HttpError(405, 'method-not-allowed', `method not allowed; use ${allow}`, allow);
}

//#endregion api

//#region static studio

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

async function handleStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: HandlerContext,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed('GET, HEAD');
  const studioDir = context.studioDir;
  if (studioDir === undefined) {
    throw new HttpError(503, 'studio-missing', 'studio build is not configured');
  }

  let root: string;
  try {
    root = await realpath(studioDir);
  } catch {
    throw new HttpError(503, 'studio-missing', 'studio build directory does not exist');
  }

  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const segments = relative.split('/');
  for (const segment of segments) {
    if (segment.length === 0 || segment.startsWith('.') || segment.includes('\\') || segment.includes('%')) {
      throw new HttpError(404, 'not-found', 'file not found');
    }
  }

  const candidate = join(root, ...segments);
  if (!candidate.startsWith(root + sep)) {
    throw new HttpError(404, 'not-found', 'file not found');
  }

  let stats;
  try {
    stats = await lstat(candidate);
  } catch {
    throw new HttpError(404, 'not-found', 'file not found');
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new HttpError(404, 'not-found', 'file not found');
  }
  const resolved = await realpath(candidate);
  if (!resolved.startsWith(root + sep)) {
    throw new HttpError(404, 'not-found', 'file not found');
  }

  const extension = segments[segments.length - 1]?.includes('.')
    ? `.${segments[segments.length - 1]!.split('.').pop()!.toLowerCase()}`
    : '';
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined) {
    throw new HttpError(404, 'not-found', 'file not found');
  }

  const bytes = await readFile(resolved);
  res.statusCode = 200;
  res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  if (extension === '.html') {
    res.setHeader('content-security-policy', CSP);
    const html = new TextDecoder().decode(bytes).replace(
      /<head>/i,
      `<head><meta name="companion-token" content="${context.token}">`,
    );
    res.setHeader('content-length', String(Buffer.byteLength(html)));
    res.end(req.method === 'HEAD' ? undefined : html);
    return;
  }
  res.setHeader('content-length', String(bytes.byteLength));
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

//#endregion static studio

//#region errors

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly allow: string | undefined;

  constructor(status: number, code: string, message: string, allow?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.allow = allow;
  }
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    [key: string]: unknown;
  };
}

function mapError(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  if (error instanceof ConflictError) {
    return {
      status: 409,
      body: {
        error: {
          code: error.code,
          reason: error.reason,
          message: 'the on-disk snapshot changed; reload or save as a copy',
        },
      },
    };
  }
  if (error instanceof InvalidProjectError) {
    return {
      status: 422,
      body: {
        error: {
          code: error.code,
          failure: error.failure,
          issues: error.issues,
          message: 'document is not a valid schema-1 project',
        },
      },
    };
  }
  if (error instanceof UnsafePathError) {
    // Never echo filesystem paths from the boundary.
    return {
      status: 400,
      body: { error: { code: error.code, message: 'path rejected by the workspace boundary' } },
    };
  }
  if (error instanceof StoreError) {
    const status = statusForStoreCode(error.code);
    return { status, body: { error: { code: error.code, message: error.message } } };
  }
  return {
    status: 500,
    body: { error: { code: 'internal-error', message: 'unexpected companion failure' } },
  };
}

function statusForStoreCode(code: string): number {
  switch (code) {
    case 'invalid-argument':
    case 'invalid-operation-id':
    case 'invalid-project-id':
      return 400;
    case 'project-not-found':
      return 404;
    case 'project-exists':
    case 'read-only-project':
    case 'workspace-locked':
      return 409;
    case 'invalid-project':
      return 422;
    case 'commit-failed':
    case 'commit-verification-failed':
      return 500;
    default:
      return 500;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(payload);
}

//#endregion errors
