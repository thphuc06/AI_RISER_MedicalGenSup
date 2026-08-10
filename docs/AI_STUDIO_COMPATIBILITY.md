# Google AI Studio / Cloud Run Compatibility

## Preserved contract

- React + TypeScript + Vite frontend.
- Node.js + Express server runtime.
- Same-origin HTTP and WebSocket architecture.
- Server-only `GEMINI_API_KEY`.
- `package.json`, `metadata.json`, `firebase-applet-config.json`, and `firebase-blueprint.json` preserved.
- Gemini Live model remains `gemini-3.1-flash-live-preview`.
- Server listens on `0.0.0.0` and honors Cloud Run `PORT`.

## Firebase configuration layers

Runtime web configuration remains in `firebase-applet-config.json` and `src/firebase.ts`. It identifies the Firebase app and named Firestore database; it is not a Gemini secret.

Firebase CLI configuration (`firebase.json`/`.firebaserc`) is still absent. That does not disconnect runtime Firebase. No `firebase init` was run. Emulator/rules deploy configuration can be added later as a separate, reviewed concern.

## Trusted server identity

The server now uses Firebase Admin with Application Default Credentials (ADC), never a committed private key.

- Local: run `gcloud auth application-default login`, then verify the ADC principal and explicitly target `project-c55c421d-248e-4800-bfb`.
- Cloud Run/AI Studio: ADC is supplied by the runtime service account.
- The runtime identity needs Firestore data access to the named database and the ability to verify Firebase ID tokens. Grant only the minimum role(s) required after reviewing the actual deployment identity.
- No IAM change was made by this audit.

Current local ADC is unavailable, so compatibility is implemented but not proven end-to-end against Firestore.

## Authentication prerequisite

Google Sign-In is enabled on the expected Firebase project. Anonymous Auth configuration is absent. The UI attempts an isolated anonymous identity only when the provider is available; otherwise it asks the user to sign in with Google. Do not reintroduce `default_user` or a global guest cart.

## Build and serving

`npm run build` produces:

```text
dist/
  client/
    index.html
    assets/**
  server.cjs
  server.cjs.map
```

Express serves only `dist/client`. The Node bundle and source map are not public static assets. SPA fallback serves both `/` and `/duoc-si`.

## Secrets

- `GEMINI_API_KEY` is read only by the Node server.
- The browser WebSocket URL contains neither the Gemini key nor Firebase ID token.
- Firebase ID tokens are sent in the initial WebSocket message and standard `Authorization` headers.
- `ADMIN_SYNC_SECRET` is optional; if unset, the manual sync endpoint stays disabled.
- No service-account JSON/private key is present or required.

## Deployment checklist (not performed)

1. Verify the Google AI Studio/Cloud Run runtime service account and least-privilege Firestore access.
2. Verify the chosen Firebase Auth providers and authorized domains.
3. Run emulator tests for the checked-in Firestore rules.
4. Obtain explicit approval before deploying production rules or Cloud Run.
5. After deployment, run only isolated, non-destructive user/cart/order smoke tests and remove only documents created by that smoke test.
