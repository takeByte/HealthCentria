import mongoose from 'mongoose';
import { env } from '../config/env.js';

/**
 * All-or-nothing database work (MongoDB multi-document transactions).
 *
 * A transaction reads from one consistent snapshot (MVCC) and either commits every
 * write or none of them, so a failure half-way never leaves a patient half
 * anonymized or an account without its visit.
 *
 * Rules that keep this safe:
 *  - The callback may run more than once (MongoDB retries it on transient
 *    errors), so it must only do database work. Emails, Google Calendar and
 *    Drive calls belong AFTER the transaction, because they cannot be undone.
 *  - Keep it short: a handful of writes, no waiting on other services.
 *  - Pass the `session` to every query and write inside the callback.
 *  - USE_TRANSACTIONS=off switches this off. The callback then runs once with no
 *    session, exactly like the code did before transactions were added.
 */

/** Throw this inside the callback to roll everything back and answer the caller yourself. */
export class TransactionAbort extends Error {
  constructor(code = 'ABORT', detail = {}) {
    super(code);
    this.name = 'TransactionAbort';
    this.code = code;
    this.detail = detail;
  }
}

export function transactionsEnabled() {
  return String(env.USE_TRANSACTIONS ?? '').trim().toLowerCase() !== 'off';
}

const TRANSACTION_OPTIONS = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  maxCommitTimeMS: 10_000,
};

/**
 * Runs `work(session)` as one transaction and returns its result.
 * If the database cannot do transactions (a standalone server), it runs the work
 * once without one, so development setups keep working.
 *
 * @template T
 * @param {(session: import('mongoose').ClientSession | null) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function runInTransaction(work) {
  if (!transactionsEnabled()) return work(null);

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    }, TRANSACTION_OPTIONS);
    return result;
  } catch (err) {
    // "Transaction numbers are only allowed on a replica set member or mongos":
    // nothing ran yet, so doing the work without a transaction is safe.
    if (err?.code === 20 || /Transaction numbers are only allowed/i.test(String(err?.message))) {
      console.warn('This MongoDB server does not support transactions; running without one.');
      return work(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
