# Phase 2 Code Audit

Audit date: 2026-08-10  
Repository: `thphuc06/AI_RISER_MedicalGen`  
Scope: Phase 2 stabilization only

## Executive status

- Overall code health: **3/10 before → 7/10 after**
- Google AI Studio compatibility: **C before → B after**
- Phase 2 status: **NOT READY**
- Safety status: **PARTIAL**

The deterministic code path and its unit tests now pass, and the loader follows the updated Playbook schema where product recommendation uses semantic reasoning over `chi_dinh_ngan` without a separate keyword column. Deployment prerequisites are still incomplete: Application Default Credentials (ADC) are unavailable locally, and the revised Firestore rules were not deployed as required by the audit constraints.

## Evidence and environment verification

- Active gcloud account: `phuctranaws180406@gmail.com`.
- Active gcloud default project: `ai-riser-505007` (**does not match the expected project**).
- Firebase CLI can list `project-c55c421d-248e-4800-bfb` as ACTIVE. The CLI then hit a Windows libuv assertion after returning valid JSON.
- All cloud inspection after detecting the mismatch used explicit project `project-c55c421d-248e-4800-bfb`.
- Firestore database: `ai-studio-vietmedcareaipha-de4deeac-0189-48f6-8f0e-4affb477dc90`, native mode, `us-west1`.
- Firestore, Firebase, Identity Toolkit, Cloud Run, and related APIs are enabled.
- Google Sign-In is enabled. Anonymous Auth configuration is absent.
- ADC check: unavailable. No Firestore Admin SDK read/write smoke test was run.
- `GEMINI_API_KEY`: not configured in the process and no `.env.local` was present. No Gemini Live quota was consumed.
- Real Google Sheets read: completed without mutation. All four tabs match the updated canonical Playbook headers.
- No `firebase init`, deployment, IAM change, database/collection deletion, paid resource creation, or production rule deployment was performed.

## Architecture after stabilization

The React/Vite UI remains intact. The Node/Express server is the sole mutation authority:

1. Firebase Auth establishes a user identity. Google Sign-In is available; anonymous sign-in is attempted only when configured.
2. Client Firestore SDK listeners read the authenticated user's cart/profile in real time.
3. Cart, checkout, and profile writes go to same-origin authenticated server endpoints.
4. Firebase Admin SDK verifies ID tokens and uses ADC for trusted Firestore operations.
5. Cart documents are keyed as `user_<uid>` and include `userId`.
6. Transcript confirmation is persisted server-side on the user's cart document; mutation endpoints do not trust a client-supplied transcript.
7. Every cart mutation runs in a Firestore transaction: load current cart + current profile + server-confirmed transcript, create the candidate, run pure deterministic safety evaluation, then persist only if permitted.
8. Checkout runs the same final deterministic validation in a Firestore transaction before creating an order.
9. Gemini Live runs server-side. The browser sends a Firebase ID token as the first WebSocket message, never in a URL. The server does not open a Gemini session until authentication succeeds.

Runtime Firebase application configuration remains separate from Firebase CLI configuration. `firebase-applet-config.json`, `src/firebase.ts`, Firebase Auth, and Firestore runtime access remain present. No `firebase.json` or `.firebaserc` was created, and their absence was not treated as disconnection.

## Verified P0 findings and resolution

### Sheets schema and cache health

Before: legacy internal field names, missing-header acceptance, random SKU fallback, no fetch timeout, false-success sync response, and fallback condition codes.

After:

- Canonical Playbook headers and strongly typed canonical models are first-class.
- Documented legacy aliases are accepted only when a complete equivalent header exists.
- Missing mandatory headers or invalid numeric safety values mark the entire cache unhealthy.
- RX rows are discarded before catalog admission.
- Cache records `lastSuccessfulRefresh`, `lastRefreshAttempt`, `isHealthy`, `lastError`, and RX count.
- Initial refresh is awaited; refresh remains every ten minutes.
- Requests have an abort timeout.
- A failed refresh retains data for diagnosis but marks it unusable for mutation.
- `/api/pharmacy/sync` reports failure truthfully and is disabled unless both Firebase authentication and `ADMIN_SYNC_SECRET` are present.

Product recommendation is intentionally non-deterministic: the model receives `chi_dinh_ngan` and performs semantic matching. Deterministic exact keyword matching remains limited to `Red_Flags`.

### Deterministic safety

Before: logic was embedded in the Live handler, split ingredients on comma/plus, used substring condition matches, assigned one parsed dose to every ingredient, selected the first max-dose rule, and mixed model transcript into safety input.

After:

- Pure `evaluateSafety` has no Gemini, WebSocket, Firestore, or network dependency.
- Active ingredients split only on semicolon and compare by normalized exact name.
- Multi-ingredient dosages pair positionally by semicolon; ambiguous/misaligned dosage fails closed when a dose rule applies.
- Contraindication condition codes compare exactly after canonical normalization.
- Maximum dose matches both ingredient and exact `nhom_tuoi`.
- Red flags normalize Unicode, Vietnamese diacritics, case, trim, and repeated whitespace; keywords split only on semicolon.
- `STOP_SELL` deterministically rejects mutation.
- Only the confirmed user transcript reaches safety evaluation. Model transcript is tracked separately.

### Identity, health profile, and confirmation

Before: server imported the Firebase Web SDK, trusted model-supplied `user_id`, read `default_user`, fabricated an elderly/hypertensive/penicillin-allergic profile on missing/error, and persisted AI updates immediately.

After:

- Server uses Firebase Admin with ADC and always derives `uid` from the verified ID token.
- A missing profile returns `{status: "missing", profile: null}`.
- Firestore failure is an unsafe error, never a fabricated patient.
- Model profile updates enter a pending state. A later explicit confirmation is required before persistence.
- Manual profile saves require an explicit UI submit and server validation.
- Condition codes and age groups are validated against live cached safety data.

### Server-authoritative, isolated cart

Before: one global `customer_active_cart`, direct client writes, mount-time cart wipe, preset replacement, quantity bypass, in-memory WebSocket cart, and checkout without final validation.

After:

- Cart IDs are unique per Firebase `uid`.
- Client code performs no Firestore writes.
- No automatic wipe or preset cart replacement remains.
- Add, remove, quantity, clear, and checkout pass through server safety validation.
- Mutations use Firestore transactions to prevent concurrent lost-update safety bypass.
- Reconnects do not lose safety state because every mutation reloads the persisted cart.
- Final checkout validation creates the order only after passing.

### Transcript/tool gate and Live handling

- States are explicit: `LISTENING`, `TRANSCRIPT_PENDING`, `CONFIRMED`, `PROCESSING`.
- State-changing tools are denied before a confirmed transcript.
- Confirmation is recorded by the authenticated WebSocket server; REST cart/checkout endpoints ignore client transcript claims and read the persisted confirmed value.
- Audio may reach Gemini for transcription, but model tool calls cannot mutate before confirmation.
- Browser WebSocket URL contains no API key or auth token.
- Authentication is the first WebSocket message; unauthenticated connections time out/close.
- All `modelTurn.parts` are scanned for audio instead of assuming part zero.
- Input and output transcripts remain separate.
- Basic per-IP WebSocket upgrade throttling is present.

### Firestore rules

The checked-in rules now deny all client writes to `carts`, `orders`, and `health_profiles`; allow owner reads; and prepare pharmacist order reads through `authorized_pharmacists`. Trusted server writes use Admin SDK and bypass client rules.

Important: these rules were **not deployed**. Deploying production rules requires explicit approval and emulator validation first.

## P1 compatibility fixes

- `/` resolves to customer UI; `/duoc-si` resolves to pharmacist UI and survives SPA refresh.
- Split/demo view remains optional at `/?view=split`.
- Startup no longer seeds mock orders into production Firestore.
- Voice presets no longer replace the cart.
- Port uses `Number(process.env.PORT || 3000)` and binds `0.0.0.0`.
- Build outputs `dist/client/**` and `dist/server.cjs`; Express serves only `dist/client`.
- Build cleans stale `dist` contents portably before generation.
- `.env.local` is supported locally; injected AI Studio/Cloud Run environment variables are not overwritten.

## Test and build results

- `npm install`: PASS. `package-lock.json` created; `bun.lock` preserved.
- `npm run lint`: PASS (`tsc --noEmit`).
- `npm test`: PASS, 17/17.
- `npm run build`: PASS. Vite emits a large-chunk warning (~1.44 MB JS; ~374 KB gzip), not a build failure.
- Local production HTTP smoke: PASS. `/api/health` returned 200; `/duoc-si` returned 200; `dist/client/server.cjs` does not exist.
- Live Sheets health: healthy after aligning the loader with the updated Product schema.
- Firebase Emulator Suite: not run because CLI emulator/deploy configuration is absent; `firebase init` was intentionally not run.
- Real Firestore Admin test: not run because ADC is unavailable.
- Gemini Live smoke: not run because `GEMINI_API_KEY` is not configured.
- `npm audit`: 8 moderate findings, all in the Firebase Admin/Google Cloud transitive chain. The suggested remediation is a major downgrade and was not applied automatically.

## Remaining work before Phase 2 can be READY

1. Set the gcloud default project to the expected project or always pass it explicitly.
2. Configure local ADC and run read-only Admin SDK tests against the named Firestore database.
3. Confirm the Cloud Run/AI Studio runtime service account has only the Firestore data permissions and token-verification capability required by Firebase Admin. Do not add a service-account key.
4. Decide guest behavior. Google Sign-In is enabled; anonymous Auth is currently absent. Either explicitly enable anonymous Auth after approval or require Google Sign-In. Never restore a shared guest cart.
5. Add minimal `firebase.json` emulator-only configuration manually if desired, run Firestore rules/integration tests, and review before any rules deployment. Do not use `firebase init` merely to connect the app.
6. Review the current moderate dependency advisories when upstream patched releases are available; do not follow npm's unsafe downgrade suggestion blindly.
7. Run an authenticated end-to-end cart/profile/checkout test in the emulator, then a non-destructive real-project smoke test.
8. Run Gemini Live multipart/reconnect/confirmation smoke tests when a server-side key is available.

## Intentionally deferred

- Phase 3 File Search/RAG, citations, and risk scoring.
- Phase 4 pharmacist authorization UX, realtime order workflow, and approval timers.
- Phase 5 automation and Sheets order mirror.
- App Check is recommended hardening after the Phase 2 authenticated flow is verified.

Phase 3 architecture note: do not assume `gemini-3.1-flash-live-preview` supports File Search directly. Keep one user-facing Live agent and expose `tra_cuu_duoc_thu(...)` as a function call to the Node server; the server should call a File-Search-capable non-Live Gemini model, then return answer and citations to the Live agent. Do not add a vector database or Python service.

## Files changed

- `.env.example` — documents ADC/runtime configuration without secrets.
- `firestore.rules` — owner reads, deny client writes, pharmacist-ready read guard.
- `package.json`, `package-lock.json` — Firebase Admin, tests, portable clean build.
- `vite.config.ts` — separate client output.
- `server.ts` — authentication, protected endpoints, authoritative mutations, Cloud Run/static fixes.
- `server/actionGate.ts` — transcript and profile confirmation state machines.
- `server/auth.ts` — Firebase token verification.
- `server/cartService.ts` — transactional authoritative cart/profile/order operations.
- `server/domain.ts` — canonical safety domain types.
- `server/env.ts` — AI Studio-safe local environment loading.
- `server/firebaseAdmin.ts` — ADC-backed Admin initialization for the named database.
- `server/liveAgentHandler.ts` — authenticated Live lifecycle, gates, persistent cart access, multipart handling.
- `server/safetyService.ts` — pure deterministic safety engine.
- `server/sheetsService.ts` — canonical validation, cache health, timeout, strict refresh.
- `src/App.tsx`, `src/routing.ts` — required routes and removal of production mock writes.
- `src/firebase.ts` — authentication setup and anonymous-to-Google linking support.
- `src/services/cartService.ts` — realtime owner listener plus authenticated server mutations.
- `src/services/healthProfileService.ts` — empty-on-missing listener plus confirmed server save.
- `src/services/liveAgentClient.ts` — authenticated handshake and explicit transcript/audio state messages.
- `src/components/VoiceShoppingCustomer.tsx` — no direct writes/wipes/preset bypass; server quantity/checkout/profile paths.
- `tests/phase2-safety.test.ts` — the 17 required Phase 2 tests.
