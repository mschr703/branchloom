# Shared API contract (F02 first slice)

In **Agents → Shared API contract**, define one `GET /api/...` endpoint for the active project. The response is one object or a list of objects, each with 1–16 flat string, number, or boolean fields and required flags. One error case specifies an HTTP status, code, and message. This deliberately narrow format is the supported contract, not arbitrary JSON Schema or OpenAPI.

1. Edit the route, fields, and error case. **Preview** validates the draft and shows deterministic local success and error JSON examples. It does not write to the database.
2. **Save revision** persists the exact normalized draft and SHA-256 fingerprint. A stale preview cannot overwrite a newer revision. Older revisions remain visible.
3. **Connect** both the frontend and backend cards. Each new agent launch receives the same revision and fingerprint in its prompt, and the launch evidence labels the contract as a source. A card with an older binding is blocked from starting until explicitly rebound. Changing a card binding is rejected while its agent runs or if the card changed since the UI loaded.
4. Paste a response and HTTP status into **Check response**. The local checker reports field paths, expected types, and actual types. It checks both success and the configured error case, but it does not call a server or store the response text.

A saved revision is project-local. Cards in other projects cannot be connected to it. A resumed Codex conversation is allowed only when the card still has the same contract revision it received at its original start. The generated examples are static in-app mock data. There is no HTTP mock server, automated endpoint probe, nested schema, agent-generated contract proposal, or canvas link yet. A passing pasted response is evidence about only that sample, not the running backend.
