/**
 * Recordings kept on this device until the server has them.
 *
 * While a note is being recorded, every second of audio is written here as it
 * arrives, so a closed tab, a crashed browser or a phone that locks mid-sentence
 * loses at most a second. When recording stops, the pieces become one file,
 * which waits here until it uploads (right away with a signal, or whenever
 * LESS is next open with one). After a successful upload it is deleted: the
 * copy on the server is the one every device plays.
 *
 * IndexedDB can be missing (some private windows) or refuse (storage full).
 * Every function here fails soft: recording still works, it just is not
 * crash-proof on that device.
 */

export interface StoredRecording {
  id: string;
  blob: Blob;
  mime: string;
  durationMs: number;
  createdAt: string;
}

const DB_NAME = "less-voice";
const VERSION = 1;

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("chunks")) {
          db.createObjectStore("chunks", { keyPath: ["id", "seq"] });
        }
        if (!db.objectStoreNames.contains("recordings")) {
          db.createObjectStore("recordings", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

function all<T>(req: IDBRequest): Promise<T[]> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => resolve([]);
  });
}

/** One second of a recording in progress. */
export async function saveChunk(id: string, seq: number, blob: Blob, mime: string): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction("chunks", "readwrite");
    tx.objectStore("chunks").put({ id, seq, blob, mime, at: Date.now() });
    await done(tx);
  } catch {
    /* fail soft */
  }
}

/** The finished recording, waiting to upload. Its pieces are dropped. */
export async function keepRecording(rec: StoredRecording): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  try {
    const tx = db.transaction(["recordings", "chunks"], "readwrite");
    tx.objectStore("recordings").put(rec);
    tx.objectStore("chunks").delete(IDBKeyRange.bound([rec.id, -Infinity], [rec.id, Infinity]));
    return await done(tx);
  } catch {
    return false;
  }
}

export async function getRecording(id: string): Promise<StoredRecording | null> {
  const db = await open();
  if (!db) return null;
  try {
    const tx = db.transaction("recordings", "readonly");
    const req = tx.objectStore("recordings").get(id);
    return await new Promise((resolve) => {
      req.onsuccess = () => resolve((req.result as StoredRecording | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Every finished recording still waiting for the server. */
export async function waitingRecordings(): Promise<StoredRecording[]> {
  const db = await open();
  if (!db) return [];
  try {
    const tx = db.transaction("recordings", "readonly");
    return await all<StoredRecording>(tx.objectStore("recordings").getAll());
  } catch {
    return [];
  }
}

export async function forgetRecording(id: string): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(["recordings", "chunks"], "readwrite");
    tx.objectStore("recordings").delete(id);
    tx.objectStore("chunks").delete(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
    await done(tx);
  } catch {
    /* fail soft */
  }
}

/**
 * Recordings that never finished (the tab closed mid-note), rebuilt from their
 * pieces. The caller keeps them like any other recording.
 */
export async function interruptedRecordings(
  skip: ReadonlySet<string>
): Promise<{ id: string; blob: Blob; mime: string; durationMs: number; lastAt: number }[]> {
  const db = await open();
  if (!db) return [];
  try {
    const tx = db.transaction("chunks", "readonly");
    const chunks = await all<{ id: string; seq: number; blob: Blob; mime: string; at: number }>(
      tx.objectStore("chunks").getAll()
    );
    const byId = new Map<string, { seq: number; blob: Blob; mime: string; at: number }[]>();
    for (const c of chunks) {
      if (skip.has(c.id)) continue;
      const list = byId.get(c.id) ?? [];
      list.push(c);
      byId.set(c.id, list);
    }
    return [...byId.entries()].map(([id, list]) => {
      list.sort((a, b) => a.seq - b.seq);
      const mime = list[0]?.mime || "audio/webm";
      return {
        id,
        blob: new Blob(list.map((c) => c.blob), { type: mime }),
        mime,
        // Each piece is one second (the recorder's timeslice).
        durationMs: list.length * 1000,
        lastAt: Math.max(...list.map((c) => c.at || 0)),
      };
    });
  } catch {
    return [];
  }
}
