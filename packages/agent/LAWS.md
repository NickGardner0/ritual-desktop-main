# Ritual Chat Laws

1. **Admit is durable before the client is told OK.**
   A user prompt is persisted as a `user` session item before the HTTP response returns 200.

2. **One running loop per session.**
   A session lock (`run_status` + `run_heartbeat`) ensures at most one agent loop is executing at any time. Heartbeat expiry (~2 min) recovers crashed processes.

3. **Queue is FIFO; only the head may steer into a running loop.**
   v1 may reject-while-busy; steer-into-running-loop can wait until a later PR.

4. **Failed dispatch stays first; no duplicate user turns from retry of the same `commandId`.**
   `commandId` is an idempotency key on `user` items. Re-admitting the same `commandId` is a no-op 200.

5. **Tool side effects happen only after `tool_called` is persisted.**
   The `tool_called` item is written to the session before `execute()` runs. Crash-before-execute means no side effect occurred and can be safely retried.

6. **Writes require a durable approval unless the scope is already always-allowed.**
   Mutating tools produce an `approval_ask` item and unlock the session until the client POSTs a decision. `approval` items are durable records.

7. **The UI shows tool name and status from stored identity, not model titles.**
   Tool cards render from `tool_called.name` and `tool_result.status`, never from free-text model output.
