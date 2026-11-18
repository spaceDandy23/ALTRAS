# PostgREST 14 revision-conflict recovery

Prepared migration: `20261118100441_nonretrying_revision_conflicts.sql`.
Do not apply or restart services without operational approval.

The migration changes deterministic revision conflicts from SQLSTATE `40001`
to `P0001`. Authorization, locks, revision comparisons, messages, and grants stay
unchanged. Deploy the assessment client change with it: it recognizes the new
conflict while retaining compatibility with the old code.

## Approved recovery sequence

1. Record current backend PIDs, error contexts, rollback rate, API health, and CPU.
2. Apply the migration through the normal linked-project migration procedure.
3. Verify installed definitions and permissions for all five signatures.
4. Match repeating `40001` error PIDs from logs to current `pg_stat_activity`.
   Have the operator stop only confirmed looping work, or coordinate a service
   restart with Supabase support. The official advisory warns that replacing
   the function alone may not stop already-running loops.
5. If targeted recovery is unavailable, schedule a project restart. This
   interrupts all connections and in-flight requests. Committed records remain;
   interrupted requests need normal reconciliation before being retried.
6. Check CPU, rollback deltas, API readiness, and login. Do not increase pool
   capacity merely to accommodate the loop.

## PostgREST verification after approval

Use isolated test accounts/content and the deployed API, not production student
attempts. For each of Save, Publish, assessment draft sync, and both assessment
completion signatures:

- Read a current record and retain its revision and data snapshot.
- Submit one stale revision request with the same authorized test session.
- Expect one prompt HTTP 400 response with code `P0001` and the existing conflict
  message. Do not automatically retry it.
- Read the record again: draft/answers/results/rewards must be unchanged.
- Confirm the failed request does not leave a continuing series of rollbacks or
  repeated backend errors.
- Submit a valid revision and confirm normal behavior.

Direct SQL tests cannot reproduce PostgREST's internal transaction retry runner.
Local HTTP verification requires a real PostgreSQL/PostgREST stack; Docker was
unavailable during preparation. Hosted stale-conflict probes were deliberately
not sent before applying the fix because they can create more retry loops.

Do not roll back to custom `40001` business conflicts. Keep concurrency checks
and use a forward correction if another issue is found.

Reference: https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
