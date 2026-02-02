/**
 * Simple async mutex / keyed lock for serializing read-modify-write
 * operations on file-backed resources.
 *
 * Usage:
 *   const release = await fileMutex.acquire("board");
 *   try { ... read, modify, write ... }
 *   finally { release(); }
 *
 * Or with the helper:
 *   await fileMutex.withLock("board", async () => { ... });
 */

const locks = new Map();

function acquire(key) {
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });

  const prev = locks.get(key) ?? Promise.resolve();
  locks.set(key, prev.then(() => next));

  return prev.then(() => release);
}

async function withLock(key, fn) {
  const release = await acquire(key);
  try {
    return await fn();
  } finally {
    release();
  }
}

export const fileMutex = { acquire, withLock };
