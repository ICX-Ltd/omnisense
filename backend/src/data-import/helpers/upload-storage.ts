// Multer storage for import uploads.
//
// Uploads MUST land on disk. Multer's default is memory storage, which buffers
// the entire request body in the worker's heap — a several-hundred-MB export
// would exhaust it.
//
// The destination is resolved PER REQUEST rather than when the module is built.
// Module decorators evaluate as soon as a file is imported, which happens before
// ConfigModule.forRoot() loads .env into process.env, so anything reading an env
// var at decorator time sees it as unset and silently degrades — which is
// exactly how the first version of this ended up back on memory storage.

import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import * as path from 'path';
import { diskStorage } from 'multer';
import { uploadDir } from './file-source';

/** Default upload ceiling when IMPORT_MAX_UPLOAD_BYTES is unset. */
export const DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export function maxUploadBytes(): number {
  const raw = Number(process.env.IMPORT_MAX_UPLOAD_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_UPLOAD_BYTES;
}

/**
 * Disk storage whose destination is looked up on each upload.
 *
 * Safe to call at decorator time: nothing here touches the environment until a
 * request actually arrives.
 */
export function lazyImportDiskStorage() {
  return diskStorage({
    destination: (_req, _file, cb) => {
      const dest = uploadDir();
      if (!dest) {
        cb(
          new Error(
            'IMPORT_UPLOAD_DIR is not configured, so uploads cannot be written to disk. ' +
              'Set it and restart, or use the server import folder instead.',
          ),
          '',
        );
        return;
      }
      try {
        mkdirSync(dest, { recursive: true });
      } catch (e) {
        cb(e as Error, '');
        return;
      }
      cb(null, dest);
    },
    // Keep the original extension: the intake guard checks it, and the sniffer
    // reports it back to the operator.
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `import-${randomUUID()}${ext}`);
    },
  });
}
