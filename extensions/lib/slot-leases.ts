import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);

interface Lease {
  slotId: number;
  sessionId: string;
  pid: number;
}

interface OwnedLease extends Lease {
  owner: string;
}

// Existing cache paths are trusted; use a private local user cache in one host/PID namespace.
export class SlotLeases {
  private readonly owner = randomUUID();
  private readonly dbPath: string;
  private db: DatabaseSync | undefined;

  constructor(dbPath = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "pi-llama-reasoning", "slots.sqlite")) {
    this.dbPath = dbPath;
  }

  acquire(scope: string, sessionId: string, slotIds: number[], busyIds: number[], explicitSlot?: number): number | undefined {
    const db = this.open();
    return this.transaction(db, () => {
      const leases = db.prepare("SELECT scope, slot_id AS slotId, session_id AS sessionId, pid, owner FROM leases").all() as unknown as (OwnedLease & { scope: string })[];
      const removeOwner = db.prepare("DELETE FROM leases WHERE owner = ?");
      for (const lease of leases) {
        if (isDead(lease.pid)) removeOwner.run(lease.owner);
      }

      const current = leases.find((lease) => lease.owner === this.owner && lease.scope === scope && lease.sessionId === sessionId);
      // Retaining our current slot is safe even while its request is busy.
      const retained = current && slotIds.includes(current.slotId) && (explicitSlot === undefined || explicitSlot === current.slotId)
        ? current.slotId
        : undefined;
      removeOwner.run(this.owner);
      const occupied = new Set((db.prepare("SELECT slot_id AS slotId FROM leases WHERE scope = ?").all(scope) as unknown as { slotId: number }[]).map((lease) => lease.slotId));
      const candidates = explicitSlot === undefined ? slotIds : slotIds.filter((slotId) => slotId === explicitSlot);
      const slotId = retained ?? candidates.find((candidate) => !occupied.has(candidate) && !busyIds.includes(candidate));
      if (slotId !== undefined) {
        db.prepare("INSERT INTO leases (scope, slot_id, session_id, pid, owner) VALUES (?, ?, ?, ?, ?)")
          .run(scope, slotId, sessionId, process.pid, this.owner);
      }
      return slotId;
    });
  }

  list(scope: string): Lease[] {
    const leases = this.open().prepare("SELECT slot_id AS slotId, session_id AS sessionId, pid FROM leases WHERE scope = ? ORDER BY slot_id")
      .all(scope) as unknown as Lease[];
    return leases.filter((lease) => !isDead(lease.pid)).map((lease) => ({ ...lease }));
  }

  release(): void {
    const db = this.db;
    if (!db) return;
    this.transaction(db, () => {
      db.prepare("DELETE FROM leases WHERE owner = ?").run(this.owner);
    });
  }

  close(): void {
    const db = this.db;
    if (!db) return;
    try {
      this.release();
    } finally {
      db.close();
      this.db = undefined;
    }
  }

  private open(): DatabaseSync {
    if (this.db) return this.db;
    mkdirSync(dirname(this.dbPath), { recursive: true, mode: 0o700 });
    try {
      closeSync(openSync(this.dbPath, "wx", 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(this.dbPath);
    try {
      db.exec(`
        PRAGMA busy_timeout = 200;
        CREATE TABLE IF NOT EXISTS leases (
          scope TEXT NOT NULL,
          slot_id INTEGER NOT NULL,
          session_id TEXT NOT NULL,
          pid INTEGER NOT NULL,
          owner TEXT NOT NULL UNIQUE,
          PRIMARY KEY (scope, slot_id)
        );
      `);
    } catch (error) {
      db.close();
      throw error;
    }
    this.db = db;
    return db;
  }

  private transaction<T>(db: DatabaseSync, action: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

// PID reuse is deliberately conservative: a live PID keeps its lease, even if reused.
function isDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
