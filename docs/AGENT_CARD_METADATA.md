# Agent changes to card priority and labels

In **Agents**, enable **Agenten dürfen ändern** for a project. The switch is off for every existing and new project. It applies to newly started card sessions; an already running agent does not acquire a capability when the switch is enabled later.

An opted-in card session receives a private, random, in-memory capability in its process environment and a local HTTP URL. Branchloom binds that service to `127.0.0.1` on a temporary port. The agent's initial task text names the two environment variables and the request format. The token is never placed in the prompt, command arguments, SQLite, a project file, or the Git worktree. It is revoked on stop, process exit and app shutdown. Disabling the project switch rejects new requests immediately.

The agent first reads its current card with `GET $BRANCHLOOM_CARD_METADATA_URL` and `Authorization: Bearer <token>`. The response includes priority, labels, the available labels on active project cards and a fingerprint. A change requires `POST` to the same URL, `Content-Type: application/json` and a JSON body:

```json
{
  "requestId": "d834234f-236a-42ef-b647-cad0dc8d331b",
  "expectedFingerprint": "64 lowercase hex characters from GET",
  "priority": "high",
  "labels": ["Review"],
  "reason": "The task has a stated deadline"
}
```

`priority` and `labels` are each optional, but at least one must be present. The labels field replaces the card's entire label list. Existing validation limits it to 12 names of at most 32 characters; priority is one of `none`, `low`, `medium`, `high`, `urgent`. The reason is an agent-supplied explanation, not independently verified evidence. The request ID must be a new UUID. A stale fingerprint or duplicate request is rejected; the agent must read the card again before trying a genuinely new change.

Use a child script that reads `process.env.BRANCHLOOM_CARD_METADATA_TOKEN` inside that process and calls `fetch`. Do not interpolate the token into a shell command argument or print it. The server rejects browser `Origin` headers, non-loopback hosts, missing capabilities, stopped sessions, disabled projects and archived cards. The capability can only change the one card linked to the running session. A successful write updates the board snapshot and appends an audit row containing agent, session, previous/new values, time and reason. **Agents** shows the latest audit rows after restart.

This is an application-level permission. A CLI agent with unrestricted operating-system file access may be able to edit other local files directly. Use a sandboxed agent profile where that distinction matters. The adapter has a real local PTY/process test; reachability from each third-party CLI sandbox and model-driven tool selection still need live acceptance on the user's agent profiles.
