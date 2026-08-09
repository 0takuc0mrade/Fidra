import { createHash, randomUUID } from "node:crypto";

const TERMINAL_STATES = new Set(["complete", "cancelled"]);
const STATE_ORDER = [
  "wallet_ready", "gas_ready", "task_complete", "claim_created", "claim_certified",
  "awaiting_approval", "arc_pending", "advance_confirmed", "complete",
];
const OPERATION_TERMINAL = new Set(["transaction_confirmed", "transaction_failed", "transaction_timed_out", "cancelled"]);
const OPERATION_ORDER = ["creating_challenge", "challenge_required", "transaction_pending", "transaction_confirmed"];

function cleanJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function workflowFromRow(row) {
  if (!row) return null;
  return {
    ...row.payload,
    id: row.id,
    userRef: row.user_ref,
    worker: row.worker_address,
    platformId: Number(row.platform_id),
    state: row.state,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function operationFromRow(row) {
  if (!row) return null;
  return {
    ...row.payload,
    id: row.id,
    ownerRef: row.user_ref,
    workflowId: row.workflow_id,
    operationType: row.operation_type,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    challengeId: row.challenge_id,
    transactionId: row.transaction_id,
    txHash: row.tx_hash,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
  };
}

function validTransition(from, to) {
  if (!to || from === to) return true;
  if (TERMINAL_STATES.has(from)) return false;
  if (to === "cancelled") return true;
  if (["awaiting_approval", "arc_pending"].includes(from) && to === "claim_certified") return true;
  return STATE_ORDER.indexOf(to) >= STATE_ORDER.indexOf(from) && STATE_ORDER.includes(to);
}

function validOperationTransition(from, to) {
  if (!to || from === to) return true;
  if (OPERATION_TERMINAL.has(from)) return false;
  if (["transaction_failed", "transaction_timed_out", "cancelled"].includes(to)) return true;
  return OPERATION_ORDER.indexOf(to) >= OPERATION_ORDER.indexOf(from) && OPERATION_ORDER.includes(to);
}

async function reserveBudget(client, { budgetType, periodStart, reservationKey, amountUnits, limitUnits }) {
  const existing = await client.query(
    "SELECT status FROM budget_reservations WHERE budget_type=$1 AND period_start=$2 AND reservation_key=$3",
    [budgetType, periodStart, reservationKey],
  );
  if (existing.rowCount) return { reserved: existing.rows[0].status !== "released", existing: true };
  await client.query(
    `INSERT INTO budget_usage (budget_type, period_start, amount_units, reservation_count)
     VALUES ($1, $2, 0, 0) ON CONFLICT (budget_type, period_start) DO NOTHING`,
    [budgetType, periodStart],
  );
  const usage = await client.query(
    `UPDATE budget_usage SET amount_units=amount_units+$3, reservation_count=reservation_count+1, updated_at=now()
     WHERE budget_type=$1 AND period_start=$2 AND amount_units+$3 <= $4
     RETURNING amount_units`,
    [budgetType, periodStart, String(amountUnits), String(limitUnits)],
  );
  if (!usage.rowCount) return { reserved: false, existing: false };
  await client.query(
    `INSERT INTO budget_reservations (budget_type, period_start, reservation_key, amount_units)
     VALUES ($1, $2, $3, $4)`,
    [budgetType, periodStart, reservationKey, String(amountUnits)],
  );
  return { reserved: true, existing: false, totalUnits: usage.rows[0].amount_units };
}

export class PostgresWorkflowStore {
  constructor(pool) { this.pool = pool; }

  async createOrGet({ userRef, worker, platformId }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`fidra:workflow:${userRef}`]);
      let result = await client.query(
        "SELECT * FROM workflows WHERE user_ref=$1 AND state NOT IN ('complete','cancelled') ORDER BY updated_at DESC LIMIT 1",
        [userRef],
      );
      if (!result.rowCount) {
        const id = randomUUID();
        const payload = { error: null, task: null, gasFunding: null, claim: null, advance: null, settlement: null };
        result = await client.query(
          `INSERT INTO workflows (id,user_ref,worker_address,platform_id,state,payload)
           VALUES ($1,$2,$3,$4,'wallet_ready',$5::jsonb) RETURNING *`,
          [id, userRef, worker, platformId, JSON.stringify(payload)],
        );
      }
      await client.query("COMMIT");
      return workflowFromRow(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async get(id) {
    const result = await this.pool.query("SELECT * FROM workflows WHERE id=$1", [id]);
    return workflowFromRow(result.rows[0]);
  }

  async findForUser(userRef) {
    const result = await this.pool.query("SELECT * FROM workflows WHERE user_ref=$1 ORDER BY updated_at DESC LIMIT 1", [userRef]);
    return workflowFromRow(result.rows[0]);
  }

  async findByOperationId(operationId) {
    const result = await this.pool.query("SELECT * FROM workflows WHERE circle_operation_id=$1", [operationId]);
    return workflowFromRow(result.rows[0]);
  }

  async dailyCertifiedFaceTotal(date = new Date().toISOString().slice(0, 10)) {
    const result = await this.pool.query(
      "SELECT COALESCE(amount_units,0)::text AS total FROM budget_usage WHERE budget_type='demo_claim' AND period_start=$1",
      [date],
    );
    return BigInt(result.rows[0]?.total ?? 0);
  }

  async reserveBudget({ budgetType, reservationKey, amountUnits, limitUnits, date = new Date().toISOString().slice(0, 10) }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await reserveBudget(client, { budgetType, periodStart: date, reservationKey, amountUnits, limitUnits });
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async markBudgetReservation({ budgetType, reservationKey, status, date = new Date().toISOString().slice(0, 10) }) {
    if (!["submitted", "confirmed", "failed"].includes(status)) throw new Error("Invalid budget reservation status.");
    const result = await this.pool.query(
      `UPDATE budget_reservations SET status=$4,updated_at=now()
       WHERE budget_type=$1 AND period_start=$2 AND reservation_key=$3 RETURNING status`,
      [budgetType, date, reservationKey, status],
    );
    return result.rows[0] ?? null;
  }

  async update(id, values) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT * FROM workflows WHERE id=$1 FOR UPDATE", [id]);
      if (!selected.rowCount) { await client.query("ROLLBACK"); return null; }
      const current = workflowFromRow(selected.rows[0]);
      const nextState = values.state ?? current.state;
      if (!validTransition(current.state, nextState)) throw new Error(`Invalid workflow transition: ${current.state} -> ${nextState}`);
      const merged = cleanJson({ ...current, ...values });
      delete merged.id; delete merged.userRef; delete merged.worker; delete merged.platformId;
      delete merged.state; delete merged.createdAt; delete merged.updatedAt;
      const claimId = merged.claim?.id ?? null;
      const operationId = merged.advance?.operationId ?? null;
      const result = await client.query(
        `UPDATE workflows SET state=$2, claim_id=$3, circle_operation_id=$4, payload=$5::jsonb, updated_at=now()
         WHERE id=$1 RETURNING *`,
        [id, nextState, claimId, operationId, JSON.stringify(merged)],
      );
      await client.query("COMMIT");
      return workflowFromRow(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async withLock(id, callback) {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [`fidra:lock:${id}`]);
      return await callback();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`fidra:lock:${id}`]).catch(() => {});
      client.release();
    }
  }
}

export class PostgresWalletStore {
  constructor(pool) { this.pool = pool; }

  async upsert(wallet, userRef) {
    const metadata = cleanJson({ state: wallet.state ?? null });
    const result = await this.pool.query(
      `INSERT INTO wallets (wallet_id,address,blockchain,account_type,circle_user_ref,public_metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (wallet_id) DO UPDATE SET address=EXCLUDED.address, blockchain=EXCLUDED.blockchain,
       account_type=EXCLUDED.account_type, circle_user_ref=EXCLUDED.circle_user_ref,
       public_metadata=EXCLUDED.public_metadata, updated_at=now() RETURNING *`,
      [wallet.id, wallet.address, wallet.blockchain, wallet.accountType, userRef, JSON.stringify(metadata)],
    );
    return this.fromRow(result.rows[0]);
  }

  fromRow(row) {
    if (!row) return null;
    return {
      walletId: row.wallet_id, address: row.address, blockchain: row.blockchain,
      accountType: row.account_type, circleUserRef: row.circle_user_ref,
      recordedAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      gasSeed: row.gas_seed ?? null,
    };
  }

  async get(walletId) {
    const result = await this.pool.query(
      `SELECT w.*, CASE WHEN g.wallet_id IS NULL THEN NULL ELSE
       g.public_receipt || jsonb_build_object('status',g.status,'transactionHash',g.transaction_hash) END AS gas_seed
       FROM wallets w LEFT JOIN gas_seeds g ON g.wallet_id=w.wallet_id WHERE w.wallet_id=$1`,
      [walletId],
    );
    return this.fromRow(result.rows[0]);
  }

  async reserveSeed(wallet, { requestKeyHash, amountUnits, dailyLimitUnits, budgetType = "gas_seed", date = new Date().toISOString().slice(0, 10) }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`fidra:seed:${wallet.id}`]);
      const existing = await client.query("SELECT * FROM gas_seeds WHERE wallet_id=$1", [wallet.id]);
      if (existing.rowCount) { await client.query("COMMIT"); return { reserved: false, existing: existing.rows[0] }; }
      const budget = await reserveBudget(client, {
        budgetType, periodStart: date, reservationKey: wallet.id,
        amountUnits, limitUnits: dailyLimitUnits,
      });
      if (!budget.reserved) { await client.query("ROLLBACK"); return { reserved: false, budgetExceeded: true }; }
      const inserted = await client.query(
        `INSERT INTO gas_seeds (wallet_id,worker_address,request_key_hash,amount_units,status)
         VALUES ($1,$2,$3,$4,'reserved') RETURNING *`,
        [wallet.id, wallet.address, requestKeyHash ?? null, String(amountUnits)],
      );
      await client.query("COMMIT");
      return { reserved: true, record: inserted.rows[0] };
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async recordSeed(walletId, seed) {
    const status = seed.status === "already_seeded" ? "confirmed" : seed.status;
    const amountUnits = seed.amountUnits ?? 0;
    const result = await this.pool.query(
      `INSERT INTO gas_seeds (wallet_id,worker_address,request_key_hash,amount_units,status,transaction_hash,public_receipt)
       SELECT wallet_id,address,$2,$3,$4,$5,$6::jsonb FROM wallets WHERE wallet_id=$1
       ON CONFLICT (wallet_id) DO UPDATE SET status=EXCLUDED.status,
       transaction_hash=COALESCE(EXCLUDED.transaction_hash,gas_seeds.transaction_hash),
       public_receipt=EXCLUDED.public_receipt, updated_at=now() RETURNING *`,
      [walletId, seed.requestKeyHash ?? null, String(amountUnits), status, seed.transactionHash ?? null, JSON.stringify(cleanJson(seed))],
    );
    if (!result.rowCount) throw new Error("Wallet metadata is missing.");
    if (["submitted", "confirmed", "failed"].includes(status)) {
      await this.pool.query(
        `UPDATE budget_reservations b SET status=$2,updated_at=now()
         FROM gas_seeds g WHERE g.wallet_id=$1 AND b.budget_type='gas_seed'
         AND b.reservation_key=g.wallet_id AND b.period_start=g.created_at::date`,
        [walletId, status],
      );
    }
    return this.get(walletId);
  }

  async dailyConfirmedSeedTotal(date = new Date().toISOString().slice(0, 10)) {
    const result = await this.pool.query(
      "SELECT COALESCE(amount_units,0)::text AS total FROM budget_usage WHERE budget_type='gas_seed' AND period_start=$1",
      [date],
    );
    return Number(BigInt(result.rows[0]?.total ?? 0)) / 1e18;
  }
}

export class PostgresOperationStore {
  constructor(pool, { ttlMs = 15 * 60_000 } = {}) { this.pool = pool; this.ttlMs = ttlMs; }

  async create(values, requestedId = null) {
    const id = requestedId ?? randomUUID();
    const idempotencyKey = values.idempotencyKey ?? randomUUID();
    const ownerRef = values.ownerRef;
    if (!ownerRef) throw new Error("Operation ownerRef is required.");
    const payload = cleanJson(values);
    for (const key of ["ownerRef", "workflowId", "operationType", "idempotencyKey", "status", "challengeId", "transactionId", "txHash"]) delete payload[key];
    try {
      const result = await this.pool.query(
        `INSERT INTO operations (id,user_ref,workflow_id,operation_type,idempotency_key,status,challenge_id,transaction_id,tx_hash,payload,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now()+($11::bigint * interval '1 millisecond'))
         ON CONFLICT (idempotency_key) DO UPDATE SET updated_at=operations.updated_at RETURNING *`,
        [id, ownerRef, values.workflowId ?? null, values.operationType ?? "purchase_advance", idempotencyKey,
          values.status ?? "creating_challenge", values.challengeId ?? null, values.transactionId ?? null,
          values.txHash ?? null, JSON.stringify(payload), this.ttlMs],
      );
      return operationFromRow(result.rows[0]);
    } catch (error) {
      if (error.code !== "23505" || !values.workflowId) throw error;
      const existing = await this.pool.query(
        `SELECT * FROM operations WHERE workflow_id=$1 AND operation_type=$2
         AND status NOT IN ('transaction_failed','transaction_timed_out','cancelled') ORDER BY created_at LIMIT 1`,
        [values.workflowId, values.operationType ?? "purchase_advance"],
      );
      if (!existing.rowCount) throw error;
      return operationFromRow(existing.rows[0]);
    }
  }

  async restore(operation) {
    if (!operation?.id) return null;
    const existing = await this.pool.query("SELECT * FROM operations WHERE id=$1", [operation.id]);
    if (existing.rowCount) return operationFromRow(existing.rows[0]);
    return this.create(operation, operation.id);
  }

  async get(id, ownerRef) {
    const result = await this.pool.query("SELECT * FROM operations WHERE id=$1 AND user_ref=$2", [id, ownerRef]);
    const operation = operationFromRow(result.rows[0]);
    if (operation && operation.expiresAt <= Date.now() && !["transaction_confirmed", "transaction_failed"].includes(operation.status)) {
      return this.update(id, { status: "transaction_timed_out" });
    }
    return operation;
  }

  async bind(id, ownerRef, transactionId) {
    const result = await this.pool.query(
      `UPDATE operations SET transaction_id=$3,status='transaction_pending',updated_at=now()
       WHERE id=$1 AND user_ref=$2 AND (transaction_id IS NULL OR transaction_id=$3)
       AND status NOT IN ('transaction_confirmed','transaction_failed','transaction_timed_out','cancelled') RETURNING *`,
      [id, ownerRef, transactionId],
    );
    if (result.rowCount) return operationFromRow(result.rows[0]);
    const existing = await this.pool.query("SELECT transaction_id FROM operations WHERE id=$1 AND user_ref=$2", [id, ownerRef]);
    return existing.rowCount ? false : null;
  }

  async update(id, values) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT * FROM operations WHERE id=$1 FOR UPDATE", [id]);
      if (!selected.rowCount) { await client.query("ROLLBACK"); return null; }
      const current = operationFromRow(selected.rows[0]);
      const nextStatus = values.status ?? current.status;
      if (!validOperationTransition(current.status, nextStatus)) {
        throw new Error(`Invalid operation transition: ${current.status} -> ${nextStatus}`);
      }
      const merged = cleanJson({ ...current, ...values, status: nextStatus });
      const payload = { ...merged };
      for (const key of ["id", "ownerRef", "workflowId", "operationType", "idempotencyKey", "status", "challengeId", "transactionId", "txHash", "createdAt", "expiresAt"]) delete payload[key];
      const result = await client.query(
        `UPDATE operations SET status=$2,challenge_id=$3,transaction_id=$4,tx_hash=$5,payload=$6::jsonb,updated_at=now()
         WHERE id=$1 RETURNING *`,
        [id, nextStatus, merged.challengeId ?? null, merged.transactionId ?? null, merged.txHash ?? null, JSON.stringify(payload)],
      );
      await client.query("COMMIT");
      return operationFromRow(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }
}

export class PostgresRequestLimiter {
  constructor(pool, { limit = 12, windowMs = 60_000 } = {}) { this.pool = pool; this.limit = limit; this.windowMs = windowMs; }

  async consume(keys) {
    const hashes = [...new Set(keys.filter(Boolean).map((key) => createHash("sha256").update(String(key)).digest("hex")))];
    if (!hashes.length) return true;
    const windowStart = new Date(Math.floor(Date.now() / this.windowMs) * this.windowMs);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const hash of hashes) {
        const result = await client.query(
          `INSERT INTO rate_limit_buckets (key_hash,window_start,request_count) VALUES ($1,$2,1)
           ON CONFLICT (key_hash,window_start) DO UPDATE SET request_count=rate_limit_buckets.request_count+1,updated_at=now()
           WHERE rate_limit_buckets.request_count < $3 RETURNING request_count`,
          [hash, windowStart, this.limit],
        );
        if (!result.rowCount) { await client.query("ROLLBACK"); return false; }
      }
      await client.query("COMMIT");
      return true;
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }
}
