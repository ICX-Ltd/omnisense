import Joi from "joi";

export const envSchema = Joi.object({
  OPENAI_API_KEY: Joi.string().required(),

  DATABASE_HOST: Joi.string().default("127.0.0.1"),
  DATABASE_PORT: Joi.number().default(1433),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().default("ai_assist"),

  // ─── auth ──────────────────────────────────────────────────────────────────
  // Optional here so local development still boots, but jwtSecret() in
  // modules/auth/jwt.config.ts THROWS when NODE_ENV=production and this is
  // unset — starting with the committed dev fallback would let anyone forge an
  // admin token. Generate with: openssl rand -base64 48
  JWT_SECRET: Joi.string().min(16).optional(),
  NODE_ENV: Joi.string().valid("development", "production", "test").optional(),

  // ─── data importer ─────────────────────────────────────────────────────────
  // All optional: unset IMPORT_INBOX_DIR disables server-side pickup, and unset
  // IMPORT_UPLOAD_DIR disables browser upload. Declared here as documentation —
  // ConfigModule validates with allowUnknown, so undeclared vars still pass.
  //
  // IMPORT_INBOX_DIR is where the operator drops the monthly export. It is the
  // intended path for the real file; browser upload is for samples.
  IMPORT_INBOX_DIR: Joi.string().optional(),
  // Uploads stream to disk here rather than being buffered in memory.
  IMPORT_UPLOAD_DIR: Joi.string().optional(),
  IMPORT_MAX_UPLOAD_BYTES: Joi.number().default(200 * 1024 * 1024),
  // Rows buffered before each chunked insert into staging.
  IMPORT_STAGE_CHUNK_ROWS: Joi.number().default(200),
  // Staged rows promoted per transaction.
  IMPORT_PROMOTE_BATCH_ROWS: Joi.number().default(2000),
});
