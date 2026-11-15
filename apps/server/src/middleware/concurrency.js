import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { IdempotencyKey } from '../models/idempotency-key.model.js';

/**
 * API v2 write guards.
 *
 *  - requireVersion: edits must say which version of the record they loaded.
 *  - idempotent: a repeated create (same Idempotency-Key) returns the first
 *    result instead of making a second record.
 */

const PROCESSING_MS = 60 * 1000;
const REMEMBER_MS = 10 * 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

/** Reads `version` from the body into req.expectedVersion (and removes it from the body). */
export function requireVersion(req, res, next) {
  const raw = req.body?.version;
  if (!Number.isInteger(raw) || raw < 0) {
    return res.status(400).json({
      success: false,
      code: 'VERSION_REQUIRED',
      message: 'Send the version of the record you are editing (the "version" field) so changes cannot overwrite each other.',
    });
  }
  req.expectedVersion = raw;
  delete req.body.version;
  return next();
}

function scopeOf(req) {
  // Who is asking, without storing the token: a hash of the Authorization header.
  return createHash('sha256').update(String(req.get('authorization') ?? '')).digest('hex').slice(0, 32);
}

export async function idempotent(req, res, next) {
  const key = String(req.get('Idempotency-Key') ?? '').trim();
  if (!key) return next(); // optional: older clients simply are not protected
  if (!KEY_PATTERN.test(key)) {
    return res.status(400).json({ success: false, message: 'The Idempotency-Key header is not valid.' });
  }
  // Without a database there is nothing to remember; the handler will report that itself.
  if (mongoose.connection.readyState !== 1) return next();

  const scope = scopeOf(req);
  const route = `${req.method} ${req.baseUrl}${req.path}`;
  const filter = { scope, route, key };

  try {
    await IdempotencyKey.create({ ...filter, state: 'processing', expiresAt: new Date(Date.now() + PROCESSING_MS) });
  } catch (err) {
    if (err?.code !== 11000) return next(err);
    const existing = await IdempotencyKey.findOne(filter).lean();
    if (existing && existing.expiresAt > new Date()) {
      if (existing.state === 'done' && existing.bodyJson) {
        res.set('Idempotent-Replay', 'true');
        return res.status(existing.statusCode ?? 200).json(JSON.parse(existing.bodyJson));
      }
      return res.status(409).json({
        success: false,
        code: 'REQUEST_IN_PROGRESS',
        message: 'This request is already being processed. Please wait a moment.',
      });
    }
    // A leftover row that has expired: take it over (only one caller can win).
    const taken = await IdempotencyKey.findOneAndUpdate(
      { ...filter, expiresAt: { $lte: new Date() } },
      { $set: { state: 'processing', statusCode: null, bodyJson: null, expiresAt: new Date(Date.now() + PROCESSING_MS) } },
    );
    if (!taken) {
      return res.status(409).json({
        success: false,
        code: 'REQUEST_IN_PROGRESS',
        message: 'This request is already being processed. Please wait a moment.',
      });
    }
  }

  // Remember the outcome before the response goes out: successes are kept so a repeat
  // gets the same answer; failures are forgotten so a corrected retry can run.
  const send = res.json.bind(res);
  res.json = (payload) => {
    const code = res.statusCode;
    const settle =
      code >= 200 && code < 300
        ? IdempotencyKey.updateOne(filter, {
            $set: {
              state: 'done',
              statusCode: code,
              bodyJson: JSON.stringify(payload),
              expiresAt: new Date(Date.now() + REMEMBER_MS),
            },
          })
        : IdempotencyKey.deleteOne(filter);
    settle.catch(() => {}).finally(() => send(payload));
    return res;
  };
  return next();
}
