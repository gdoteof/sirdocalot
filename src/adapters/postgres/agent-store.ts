import type { Agent } from "../../domain/agent.ts";
import type { AgentId } from "../../domain/ids.ts";
import type { AgentStore, InviteCodes } from "../../application/ports.ts";
import type { Db } from "./pool.ts";

type AgentRow = {
  id: string;
  name: string;
  public_key: string;
  created_at: Date;
  disabled_at: Date | null;
};

const toAgent = (row: AgentRow): Agent => ({
  id: row.id as AgentId,
  name: row.name,
  publicKey: row.public_key,
  createdAt: row.created_at.toISOString(),
  ...(row.disabled_at !== null ? { disabledAt: row.disabled_at.toISOString() } : {}),
});

export function agentStore(db: Db): AgentStore {
  return {
    async register(agent: Agent, inviteCode: string): Promise<boolean> {
      const client = await db.connect();
      try {
        await client.query("begin");
        // Agent first: invite_codes.used_by references it, so claiming the code
        // before the row exists violates the foreign key. Ordering inside one
        // transaction is what makes both statements land or neither.
        await client.query("insert into agents (id, name, public_key, created_at) values ($1, $2, $3, $4)", [
          agent.id,
          agent.name,
          agent.publicKey,
          agent.createdAt,
        ]);
        // `used_by is null` is the whole concurrency argument: Postgres serialises
        // the two updates, the first sets the column, the second matches no row.
        const claimed = await client.query(
          "update invite_codes set used_by = $2, used_at = $3 where code = $1 and used_by is null",
          [inviteCode, agent.id, agent.createdAt],
        );
        if ((claimed.rowCount ?? 0) !== 1) {
          await client.query("rollback");
          return false;
        }
        await client.query("commit");
        return true;
      } catch (error: unknown) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async get(id: AgentId): Promise<Agent | undefined> {
      const { rows } = await db.query<AgentRow>("select * from agents where id = $1", [id]);
      const row = rows[0];
      return row === undefined ? undefined : toAgent(row);
    },
    async byPublicKey(publicKey: string): Promise<Agent | undefined> {
      const { rows } = await db.query<AgentRow>("select * from agents where public_key = $1", [publicKey]);
      const row = rows[0];
      return row === undefined ? undefined : toAgent(row);
    },
    async list(): Promise<Agent[]> {
      const { rows } = await db.query<AgentRow>("select * from agents order by created_at asc");
      return rows.map(toAgent);
    },
    async disable(id: AgentId, at: string): Promise<void> {
      await db.query("update agents set disabled_at = $2 where id = $1 and disabled_at is null", [id, at]);
    },
    async count(): Promise<number> {
      const { rows } = await db.query<{ n: string }>("select count(*)::text as n from agents");
      return Number(rows[0]?.n ?? 0);
    },
  };
}

export function inviteCodes(db: Db): InviteCodes {
  return {
    async create(code: string, note: string | undefined): Promise<void> {
      await db.query("insert into invite_codes (code, note) values ($1, $2)", [code, note ?? null]);
    },

    async list(): Promise<{ code: string; note?: string; usedBy?: string; usedAt?: string }[]> {
      const { rows } = await db.query<{
        code: string;
        note: string | null;
        used_by: string | null;
        used_at: Date | null;
      }>("select code, note, used_by, used_at from invite_codes order by created_at desc");
      return rows.map((r) => ({
        code: r.code,
        ...(r.note !== null ? { note: r.note } : {}),
        ...(r.used_by !== null ? { usedBy: r.used_by } : {}),
        ...(r.used_at !== null ? { usedAt: r.used_at.toISOString() } : {}),
      }));
    },
  };
}
