# 06 — API Contracts, Hybrid Auth Flows & Google Cloud Deployment Runbook

---

## 1. Hybrid Authentication Architecture (`@logicall.io` Google SSO + BPO Agent IDs)

LogiCall has two distinct user populations:
1. **Internal LogiCall Staff (`@logicall.io`):** Have corporate Google Workspace accounts. They sign in with 1 click via **Sign in with Google**.
2. **External BPO Partner Agents (`THS`, `NGA`, `DOZ`, `ZIM`, `MRR`, `CALL_CORE`, `LATAM_DIRECT`):** Many do **not** have corporate mailboxes, though every contractor is assigned a unique LogiCall Staff ID (`LC-XXXX`) or external email.

### 1.1 How `LC`-ID Login Works at \$0 License Cost
Firebase Authentication's free **Email/Password** provider serves both external-email users and `LC`-ID users:
* When an Admin bulk-imports or creates an agent with `lcNumber: "LC-1042"` and no email, the server normalizes `"LC-1042"` to deterministic synthetic address:
  `lc-1042@roster.logicall.internal`
* On `/login`, if the user types `LC-1042` into the **"LC Number or Email"** input, the client helper converts `LC-1042` → `lc-1042@roster.logicall.internal` before calling `signInWithEmailAndPassword(auth, identifier, password)`.
* Result: **Zero paid email seats required** for 150+ BPO contractors, unified Firebase `uid` across all users, and full support for Firebase Custom Claims!

### 1.2 Session Cookie & Custom Claims Handshake (`POST /api/auth/session`)
1. Client signs in via Firebase Web SDK (`signInWithPopup(auth, googleProvider)` or `signInWithEmailAndPassword`) and obtains `idToken`.
2. Client sends `POST /api/auth/session` with `{ idToken }`.
3. Server verifies `idToken` via `adminAuth.verifyIdToken(idToken, true)`:
   * **First-Time `@logicall.io` Google Sign-In:**
     * Rejects uninvited external Google domains unless matching an active `rosterInvites` email entry (`ALLOWED_GOOGLE_WORKSPACE_DOMAINS=logicall.io,logicall.live`).
     * If `email` is in `INITIAL_SUPER_ADMIN_EMAILS`, provisions `users/{uid}` with `role: 'SUPER_ADMIN'`, `partnerCohortId: 'INTERNAL'`, `divisionIds: ['TELEHEALTH', 'INBOUND', 'OUTBOUND']`, `active: true`.
     * Else if matching a pending `rosterInvites` record, applies the invited `role`, `partnerCohortId`, and `divisionIds`.
     * Else provisions `users/{uid}` as `role: 'AGENT'`, `partnerCohortId: 'INTERNAL'`, `active: true`.
   * **Deactivation Gate:** If `userDoc.active === false`, immediately revokes tokens and returns `403 { error: 'ACCOUNT_DEACTIVATED' }`.
   * **Sync Custom Claims:** Ensures `adminAuth.setCustomUserClaims(uid, { role, partnerCohortId, divisionIds, active: true })` matches `users/{uid}`.
   * **Mint HTTP-Only Cookie:** Calls `adminAuth.createSessionCookie(idToken, { expiresIn: 5 * 24 * 60 * 60 * 1000 })` (5 days) and sets `__session` cookie (`httpOnly: true`, `secure: process.env.NODE_ENV === 'production'`, `sameSite: 'lax'`, `path: '/'`). *(Note: Naming the cookie `__session` is mandatory on Firebase Hosting / App Hosting CDNs so the cookie is forwarded to Cloud Run!)*

---

## 2. Complete Backend API Route Contracts (`src/app/api/`)

All endpoints validate sessions via `requireAuth(req, allowedRoles)` and validate request bodies via `zod`.

| Method & Route | Allowed Roles | Request Payload / Params | Response / Stream Contract |
| :--- | :--- | :--- | :--- |
| `POST /api/auth/session` | Public (valid Firebase `idToken`) | `{ idToken: string }` | Sets `__session` cookie; returns `{ user: UserDoc, refreshClaimsRequired: boolean }`. |
| `DELETE /api/auth/session` | Authenticated | — | Clears `__session` cookie; returns `{ ok: true }`. |
| `POST /api/auth/claim-invite` | Public | `{ joinCode: string, displayName: string, lcNumber: string, password: string }` | Validates active `cohorts/{id}.joinCode`, creates Firebase Auth user + `users/{uid}` (`role: 'AGENT'`), returns `{ emailForSignIn }`. |
| `POST /api/tracks/upload` | `SUPER_ADMIN`, `ADMIN`, `TRAINER` | `multipart/form-data`: `file` (PDF ≤20MB), `title`, `campaignCode`, `divisionId` | Extracts pages via `unpdf`, uploads PDF to Storage, creates `tracks/{trackId}` (`status: 'GENERATING'`) + `sourcePages`; returns `{ trackId, pageCount }`. |
| `GET /api/tracks/[trackId]/generate` | `SUPER_ADMIN`, `ADMIN`, `TRAINER` | Query: `trackId` | **SSE (`text/event-stream`)**: Streams `event: progress` (`{ step, percent, message }`) across Blueprint → Units → Sims, ending with `event: complete` (`{ trackId, versionId }`) or `event: error`. |
| `PATCH /api/tracks/[trackId]` | `SUPER_ADMIN`, `ADMIN`, `TRAINER` | Partial plain-English edits to draft `TrackVersion` (`units`, `simScenarios`, `title`) | Validates updated `TrackVersionDocSchema`, writes draft; returns `{ ok: true, updatedAt }`. |
| `POST /api/tracks/[trackId]/regenerate-item` | `SUPER_ADMIN`, `ADMIN`, `TRAINER` | `{ targetType: 'CARD' \| 'DRILL' \| 'SCENARIO', unitId?: string, itemId: string, trainerHint?: string }` | Calls `LLMGateway.generateStructured` (`heavy` tier) grounded in the unit's `sourcePages`; replaces item in draft and returns `{ item }`. |
| `POST /api/tracks/[trackId]/publish` | `SUPER_ADMIN`, `ADMIN`, `TRAINER` | `{ assignedCohortIds: string[] }` | Freezes `TrackVersion`, writes `secrets/evalRubrics` separately, sets `tracks/{trackId}.status = 'PUBLISHED'`; returns `{ publishedVersionId }`. |
| `POST /api/progress/complete-unit` | Any active user | `{ trackId: string, versionId: string, unitId: string, drillResults: Array<{ drillId: string, competencyPillarId: string, passedFirstTry: boolean }> }` | Transactionally updates `enrollments/{uid}_{trackId}`, `users/{uid}.skillScoresByPillar` & XP/streak, and `analyticsRollups` (`GLOBAL`, `DIVISION`, `COHORT`, `TRACK`); returns `{ xpAwarded, enrollment }`. |
| `POST /api/simulations/start` | Any active user | `{ trackId: string, versionId: string, scenarioId: string }` | Enforces daily rate limit (`15/day`), creates `simSessions/{sessionId}` seeded with `openingMessage`; returns `{ session: SimSessionDoc }`. |
| `POST /api/simulations/[sessionId]/message` | Session owner (`userId === uid`) | `{ content: string }` | Appends agent turn; loads `secrets/evalRubrics` server-side; **SSE streams** `fast`-tier Actor reply tokens (`event: token`), strips `<SIM_END>`, saves turn, emits `event: done` (`{ simEnded: boolean, turnCount }`). |
| `POST /api/simulations/[sessionId]/evaluate` | Session owner (`userId === uid`) | `{ selectedDisposition: string }` | Runs `heavy`-tier Rubric Judge against `secrets/evalRubrics`; saves `SimEvaluation`; if `passed`, marks `scenarioId` passed on `enrollments` (certifying track if all units complete) & updates `analyticsRollups`; returns `{ evaluation, certified: boolean }`. |
| `POST /api/roster/import` | `SUPER_ADMIN`, `ADMIN` | `{ rows: Array<{ displayName: string, lcNumber?: string, email?: string, role: UserRole, partnerCohortId: string, divisionIds: DivisionId[], initialPassword?: string }> }` | Bulk creates Firebase Auth users + `users/{uid}` docs + increments `cohorts.activeAgentCount`; returns `{ createdCount, errors, credentialsCsv }`. |
| `PATCH /api/roster/[uid]/status` | `SUPER_ADMIN`, `ADMIN` | `{ active: boolean }` | Disables/enables Firebase Auth login + updates Custom Claims & `users/{uid}.active` while keeping 100% of historical records intact. |
| `GET /api/system/ai-health` | `SUPER_ADMIN`, `ADMIN`, `TRAINER` | — | Calls `getLLMGateway().healthCheck()`; returns active provider (`ollama` vs `gemini`) and model readiness. |

---

## 3. Environment Configuration (`.env.example`)

```ini
# ============================================================================
# 1. RUNTIME MODE & AI PROVIDER SWITCH
# Iteration 1 (Local Mac): AI_PROVIDER=ollama
# Iteration 2 (Cloud API): AI_PROVIDER=gemini
# ============================================================================
AI_PROVIDER=ollama

# --- Iteration 1: Local Ollama Configuration (macOS) ---
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_HEAVY_MODEL=clef:27b-mxfp8
OLLAMA_FAST_MODEL=clef-flash:9b-mxfp8

# --- Iteration 2: Google Gemini API Configuration (Production) ---
GEMINI_API_KEY=
GEMINI_HEAVY_MODEL=gemini-2.5-flash
GEMINI_FAST_MODEL=gemini-2.5-flash-lite

# ============================================================================
# 2. FIREBASE / GOOGLE CLOUD CONFIGURATION
# In Iteration 1, set NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true (0 cloud setup!)
# ============================================================================
NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true
NEXT_PUBLIC_FIREBASE_PROJECT_ID=logicall-pulse-dev
NEXT_PUBLIC_FIREBASE_API_KEY=demo-logicall-pulse-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=logicall-pulse-dev.appspot.com

# Emulator Host Ports (Used automatically when NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true)
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199

# ============================================================================
# 3. ACCESS CONTROL & COST GUARDRAILS
# ============================================================================
ALLOWED_GOOGLE_WORKSPACE_DOMAINS=logicall.io,logicall.live
INITIAL_SUPER_ADMIN_EMAILS=connor@logicall.io
MAX_SIM_SESSIONS_PER_USER_PER_DAY=15
```

---

## 4. Firebase & Cloud Run Configuration Files

### 4.1 `firebase.json`

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "storage": {
    "rules": "storage.rules"
  },
  "apphosting": {
    "backendId": "logicall-pulse",
    "rootDir": "/",
    "ignore": [
      "node_modules",
      ".git",
      "firebase-debug.log",
      "firebase-debug.*.log",
      "tests",
      "docs"
    ]
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "storage": { "port": 9199 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

### 4.2 `apphosting.yaml` (Scale-to-Zero Cloud Run Config)

```yaml
runConfig:
  cpu: 1
  memoryMiB: 1024
  minInstances: 0
  maxInstances: 10
  concurrency: 80

env:
  - variable: AI_PROVIDER
    value: gemini
    availability:
      - RUNTIME
  - variable: GEMINI_HEAVY_MODEL
    value: gemini-2.5-flash
    availability:
      - RUNTIME
  - variable: GEMINI_FAST_MODEL
    value: gemini-2.5-flash-lite
    availability:
      - RUNTIME
  - variable: NEXT_PUBLIC_USE_FIREBASE_EMULATOR
    value: "false"
    availability:
      - BUILD
      - RUNTIME
  - variable: ALLOWED_GOOGLE_WORKSPACE_DOMAINS
    value: logicall.io,logicall.live
    availability:
      - RUNTIME
  - variable: MAX_SIM_SESSIONS_PER_USER_PER_DAY
    value: "15"
    availability:
      - RUNTIME
  - variable: GEMINI_API_KEY
    secret: GEMINI_API_KEY
    availability:
      - RUNTIME
```

### 4.3 `storage.rules` (Server-Signed PDF Access Only)

All Playbook PDF uploads (`POST /api/tracks/upload`) and Trainer PDF previews go through authenticated Next.js Route Handlers via `firebase-admin` (which bypasses client rules), locking down direct client-side bucket enumeration or tampering:

```text
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

> **Note on SSE Streaming Timeout in Production:** Set Cloud Run request timeout on the `logicall-pulse` service to `300s` (`gcloud run services update logicall-pulse --timeout=300 --region=us-central1`) so even 60-page PDF generation streams never time out mid-build.

---

## 5. Step-by-Step Cutover Runbook: Iteration 1 (Local Mac) → Iteration 2 (Google Cloud)

### Phase A: Running Iteration 1 Locally on Connor's Mac (\$0.00, Zero Cloud Dependency)
1. Confirm Ollama is running with `clef:27b-mxfp8` and `clef-flash:9b-mxfp8`:
   `ollama list`
2. Copy `.env.example` to `.env.local` (defaults to `AI_PROVIDER=ollama` and `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`).
3. Start Firebase Local Emulators + Seed LogiCall Cohorts (`INTERNAL`, `THS`, `NGA`, `DOZ`, `ZIM`, `MRR`, `CALL_CORE`, `LATAM_DIRECT`) + Next.js Dev Server with a single script:
   `npm run dev:local`
4. Open `http://localhost:3000`, sign in via the local Emulator Auth popup or seeded Admin, drop any campaign PDF, test the generated Briefing Cards, Drills, Live Call Sim, and Strengths Heatmap locally!

### Phase B: Moving to Iteration 2 After Stakeholder Approval (< \$5/month on Google)
1. Create a Google Cloud / Firebase project under LogiCall's `@logicall.io` Google Workspace org (`npx -y firebase-tools@latest projects:create logicall-pulse`) and enable Blaze metered billing with a **\$15/month budget alert**.
2. Enable **Google Sign-In** and **Email/Password** providers in Firebase Authentication, adding LogiCall's custom domain (e.g., `pulse.logicall.io`) to Authorized Domains.
3. Deploy Firestore Standard Edition `(default)` database, audited [`firestore.rules`](file:///Users/connor/Coding/Contracting/Logicall/Telehealth%20LMS/firestore.rules), indexes, and Storage rules:
   `npx -y firebase-tools@latest deploy --only firestore,storage`
4. Store the Google Gemini API key securely in Cloud Secret Manager:
   `npx -y firebase-tools@latest apphosting:secrets:set GEMINI_API_KEY`
5. Deploy the Next.js application to scale-to-zero Firebase App Hosting (Cloud Run):
   `npx -y firebase-tools@latest deploy --only apphosting`
6. Run `npm run seed:prod` once to initialize default LogiCall Divisions and BPO Partner Cohorts. No application code changes are required between Iteration 1 and Iteration 2.
