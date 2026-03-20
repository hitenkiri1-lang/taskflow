# 🎙️ VoiceTask — Voice-Controlled Task Manager

A full-stack task management application where you can create, assign, and update tasks using your voice. Built with FastAPI, React, Firebase Firestore, Whisper (speech-to-text), and Ollama (LLM command extraction).

---

## 📌 Project Overview

VoiceTask lets teams manage work through natural voice commands instead of manual form filling. Speak a command like *"Assign task to Raj to fix the login bug with high priority due tomorrow"* — the app transcribes it, extracts the intent using an LLM, and saves the task to Firestore in real time.

### Key Features

- 🎙️ **Voice task creation** — record audio, get a task saved automatically
- 👤 **Individual task assignment** — assign tasks to specific registered users
- 👥 **Group task assignment** — assign one task to an entire group at once
- ✅ **Role-based permissions** — only assignees can update individual tasks; only group members (not the owner) can update group tasks
- 📊 **Real-time dashboard** — live Firestore listeners update tasks without page refresh
- 🔢 **Sequential task numbers** — per-user and per-group task numbering
- 🗓️ **Natural language due dates** — "tomorrow", "next week", "अगले सोमवार" all work
- 🔐 **Custom auth** — register/login with bcrypt-hashed passwords stored in Firestore
- 🌐 **Multilingual transcription** — Whisper medium model handles English, Hindi, Gujarati

### Real-World Use Case

Small development teams that want to assign and track tasks hands-free during standups, or project managers who want to quickly delegate work by speaking rather than clicking through forms.

---

## 🏗️ Architecture Overview

```
Browser (React + Vite)
        │
        │  HTTP / Vite proxy (/api → :8000)
        ▼
FastAPI Backend (:8000)
        │
        ├── faster-whisper  →  audio → transcript
        ├── Ollama (LLM)    →  transcript → structured JSON
        ├── dateparser      →  "tomorrow" → "2025-03-21"
        └── firebase-admin  →  read/write Firestore
                │
                ▼
        Firebase Firestore
        (users / tasks / groups collections)

Frontend also connects directly to Firestore
via Firebase JS SDK for real-time onSnapshot listeners.
```

### Request Flow — Voice Command

1. User clicks the mic button in the browser
2. Browser records audio using `MediaRecorder` API (WebM format)
3. Audio blob is `POST`ed to `/api/voice-command` with `X-User-Id` header
4. Backend transcribes audio with **faster-whisper**
5. Transcript is sent to **Ollama** with a strict system prompt
6. Ollama returns structured JSON: `{ command_type, task_title, assignee_name, priority, due_date }`
7. Backend validates the assignee/group, resolves due dates, saves to **Firestore**
8. Frontend receives the response and shows a toast notification
9. Firestore `onSnapshot` listener on the dashboard picks up the new task in real time

### Firebase Usage

| Collection | Purpose |
|---|---|
| `users` | Stores name, email, bcrypt password hash, `name_lower` for case-insensitive lookup |
| `tasks` | Individual and group tasks with status, priority, due date, task number |
| `groups` | Group name, owner (`created_by`), members array |

---

## 📂 Folder Structure

```
voicetask/
├── backend/
│   ├── main.py                  # FastAPI app — all endpoints + AI pipeline
│   ├── requirements.txt         # Python dependencies
│   ├── serviceAccountKey.json   # Firebase service account (DO NOT COMMIT)
│   ├── .env                     # Backend environment variables
│   └── test_mic.py              # Quick microphone/Whisper smoke test
│
└── frontend/
    ├── index.html               # Vite HTML entry point
    ├── package.json             # Node dependencies and scripts
    ├── vite.config.js           # Vite config + /api proxy
    ├── tailwind.config.js       # Tailwind CSS config
    ├── postcss.config.js        # PostCSS config
    ├── .env                     # Firebase web SDK config
    └── src/
        ├── main.jsx             # React entry point
        ├── App.jsx              # Router + protected routes
        ├── index.css            # Global styles + Tailwind directives
        ├── firebase.js          # Firebase JS SDK initialisation
        ├── api/
        │   └── axios.js         # Axios instance with X-User-Id interceptor
        ├── pages/
        │   ├── Register.jsx     # Registration form
        │   ├── Login.jsx        # Login form
        │   ├── Dashboard.jsx    # Main task view with 3 real-time listeners
        │   ├── Groups.jsx       # Create / join groups
        │   └── GroupDetails.jsx # Group members + group tasks (real-time)
        └── components/
            ├── Navbar.jsx       # Top nav with Dashboard + Groups links
            ├── VoiceButton.jsx  # Toggle-style mic button (click to start/stop)
            ├── VoiceRecorder.jsx# Hold-to-record mic button (alternative)
            ├── TaskCard.jsx     # Single task card with status advance button
            ├── TaskList.jsx     # Renders a list of TaskCards
            ├── TaskSection.jsx  # Titled section wrapping TaskList
            ├── TaskForm.jsx     # Manual task assignment modal (individual/group)
            └── StatsBar.jsx     # Summary counts (pending, in-progress, etc.)
```

### Backend — File Details

**`main.py`**
The entire backend lives here. Key sections:
- **Auth** — `POST /api/register`, `POST /api/login` with bcrypt
- **Groups** — create, join, leave, remove-member endpoints
- **Tasks** — manual create (individual + group), status update with permission checks
- **Voice pipeline** — `POST /api/voice-command`: Whisper → Ollama → Firestore
- **Helpers** — `validate_assignee()`, `get_next_task_number()`, `normalise_status()`, `check_task_status_permission()`, `save_group_tasks_to_firestore()`
- **LLM fallback** — if Ollama misclassifies a group name as a user, the backend normalises and fuzzy-matches against Firestore groups before falling back to user lookup

**`requirements.txt`** — pinned Python dependencies (see Dependencies section)

**`serviceAccountKey.json`** — Firebase Admin SDK credentials. Download from Firebase Console → Project Settings → Service Accounts. Never commit this file.

**`.env`** — Whisper model size, Ollama URL/model, Firebase key path

### Frontend — File Details

**`vite.config.js`** — proxies all `/api/*` requests to `http://localhost:8000`, so the frontend never needs to hardcode the backend URL

**`App.jsx`** — React Router setup with a `ProtectedRoute` wrapper that redirects unauthenticated users to `/login`

**`firebase.js`** — initialises the Firebase JS SDK using `VITE_FIREBASE_*` env vars; exports the `db` Firestore instance used by real-time listeners

**`axios.js`** — creates an Axios instance with `baseURL: '/api'` and an interceptor that automatically attaches `X-User-Id` from `localStorage` to every request

---

## ⚙️ Backend Setup

### Prerequisites

- Python 3.10+
- [Ollama](https://ollama.com) installed and running locally
- A Firebase project with Firestore enabled

### Steps

**1. Clone the repo and enter the backend folder**

```bash
cd backend
```

**2. Create and activate a virtual environment**

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate
```

**3. Install dependencies**

```bash
pip install -r requirements.txt
```

> First run will download the Whisper `medium` model (~1.5 GB). This is a one-time download.

**4. Set up Firebase**

- Go to [Firebase Console](https://console.firebase.google.com)
- Create a project and enable **Firestore Database**
- Go to **Project Settings → Service Accounts → Generate new private key**
- Save the downloaded JSON as `backend/serviceAccountKey.json`

**5. Configure environment variables**

```bash
cp .env.example .env   # or create .env manually
```

Edit `.env`:

```env
FIREBASE_SERVICE_ACCOUNT=serviceAccountKey.json
WHISPER_MODEL=medium
OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=llama3.2
```

**6. Pull the Ollama model**

```bash
ollama pull llama3.2
```

**7. Start the backend**

```bash
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

---

## 💻 Frontend Setup

### Prerequisites

- Node.js 18+
- npm 9+

### Steps

**1. Enter the frontend folder**

```bash
cd frontend
```

**2. Install dependencies**

```bash
npm install
```

**3. Configure environment variables**

Create `frontend/.env` (or edit the existing one):

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

Get these values from Firebase Console → Project Settings → Your apps → Web app → SDK setup.

**4. Start the dev server**

```bash
npm run dev
```

App runs at `http://localhost:5173`.

---

## 🔐 Environment Variables

> **Never commit `.env` files.** Both are listed in `.gitignore`. Use the `.env.example` templates as a reference.

### `backend/.env`

Copy `backend/.env.example` → `backend/.env` and fill in your values.

| Variable | Description | Default |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Path to Firebase service account JSON | `serviceAccountKey.json` |
| `WHISPER_MODEL` | Whisper model size (`tiny`, `base`, `small`, `medium`, `large-v3`) | `medium` |
| `OLLAMA_URL` | Ollama API endpoint | `http://localhost:11434/api/generate` |
| `OLLAMA_MODEL` | Ollama model name | `llama3.2` |

### `frontend/.env`

Copy `frontend/.env.example` → `frontend/.env` and fill in your values.
All variables must be prefixed with `VITE_` to be exposed to the browser by Vite.

| Variable | Description |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firestore project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | FCM sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |

---

## 🔊 Voice Processing Flow

```
1. User clicks mic button
        │
        ▼
2. MediaRecorder captures audio (audio/webm)
        │
        ▼
3. POST /api/voice-command
   Headers: X-User-Id: <user_id>
   Body: FormData { audio: <blob> }
        │
        ▼
4. faster-whisper transcribes audio
   Model: medium (multilingual)
   Settings: beam_size=5, vad_filter=True, temperature=0
        │
        ▼
5. Transcript sent to Ollama (llama3.2)
   System prompt enforces strict JSON output:
   { command_type, task_title, assignee_name/group_name, priority, due_date }
        │
        ▼
6. Backend routes by command_type:
   ├── create_task         → validate user → save to Firestore
   ├── create_group_task   → validate owner → save single group task doc
   ├── update_task_status  → permission check → update doc
   ├── leave_group         → remove user from members array
   └── remove_member       → owner removes a member
        │
        ▼
7. due_date parsed by dateparser
   "tomorrow"       → "2025-03-21"
   "next week"      → "2025-03-27"
   "अगले सोमवार"   → next Monday's date
        │
        ▼
8. Task document written to Firestore
        │
        ▼
9. Frontend onSnapshot listener fires → UI updates instantly
```

### LLM Misclassification Fallback

If Ollama incorrectly returns `create_task` with a group name as `assignee_name` (e.g. `"front-end team"`), the backend:

1. Normalises the name: `re.sub(r"[^a-z0-9]", "", text)` → `"frontendteam"`
2. Scans all Firestore groups, normalising each stored name the same way
3. If a match is found → auto-corrects to `create_group_task`
4. If no match → falls through to user lookup
5. If neither → returns `HTTP 400` (never `503`)

---

## 🔥 Firebase Integration

### Firestore Collections

**`users`**
```json
{
  "name": "Hiten",
  "name_lower": "hiten",
  "email": "hiten@example.com",
  "password_hash": "$2b$12$...",
  "created_at": "2025-01-01T00:00:00Z"
}
```

**`tasks`**
```json
{
  "task_title": "Fix login bug",
  "assignee_name": "viraj",
  "task_number": 3,
  "priority": "high",
  "due_date": "2025-03-21",
  "status": "pending",
  "sender_id": "uid_abc123",
  "group_id": null,
  "group_name": null,
  "created_at": "2025-03-20T10:00:00Z"
}
```

Group tasks omit `assignee_name` and include `group_id`, `group_name`, and `assigned_by`.

**`groups`**
```json
{
  "group_name": "Frontend Team",
  "group_name_lower": "frontend team",
  "created_by": "uid_abc123",
  "members": ["uid_abc123", "uid_def456"],
  "created_at": "2025-03-01T00:00:00Z"
}
```

### Real-Time Listeners (Frontend)

The Dashboard sets up three `onSnapshot` listeners on mount:

| Listener | Query | Purpose |
|---|---|---|
| 1 | `assignee_name == currentUser` | Tasks assigned to me |
| 2 | `sender_id == userId` | Tasks I assigned to others |
| 3 | `group_id in [myGroupIds]` | Group tasks for my groups |

GroupDetails sets up two listeners: one on the group document (member changes) and one on tasks for that group.

### Authentication

Authentication is handled entirely by the FastAPI backend — no Firebase Auth SDK is used. Passwords are hashed with bcrypt via `passlib`. On login, the backend returns a `user_id` (Firestore document ID) and `name`, which are stored in `localStorage`. Every API request attaches `X-User-Id` as a header via the Axios interceptor.

---

## 🚀 How to Run the Full Project

**1. Start Ollama**

```bash
ollama serve
# In another terminal:
ollama pull llama3.2
```

**2. Start the backend**

```bash
cd backend
source venv/bin/activate   # or venv\Scripts\activate on Windows
uvicorn main:app --reload --port 8000
```

**3. Start the frontend**

```bash
cd frontend
npm run dev
```

**4. Open the app**

Navigate to `http://localhost:5173`

**5. Register and use**

- Register a new account at `/register`
- Log in at `/login`
- You land on the Dashboard — click the mic button and speak a command
- Example commands:
  - *"Assign task to Viraj to fix the login bug with high priority"*
  - *"Create a task for frontend team to complete the report by tomorrow"*
  - *"Complete task 3 for Hiten"*
  - *"Approve all pending tasks"*

---

## 🧪 API Endpoints

### Auth

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/register` | Register a new user |
| `POST` | `/api/login` | Login and receive `user_id` + `name` |

```json
// POST /api/register
{ "name": "Hiten", "email": "hiten@example.com", "password": "secret" }

// Response
{ "success": true, "user_id": "abc123", "name": "Hiten" }
```

### Users

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/users` | List all registered users (for task assignment dropdown) |

### Groups

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/groups` | Get all groups the current user belongs to |
| `POST` | `/api/groups/create` | Create a new group |
| `POST` | `/api/groups/join` | Join a group by ID |
| `POST` | `/api/groups/leave` | Leave a group |
| `POST` | `/api/groups/remove-member` | Owner removes a member |

### Tasks

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/tasks/create` | Manually create an individual task |
| `POST` | `/api/tasks/create-group-task` | Manually create a group task (owner only) |
| `POST` | `/api/tasks/update-status` | Update a task's status (permission enforced) |
| `GET` | `/api/tasks/assigned-to-me` | Tasks where I am the assignee |
| `GET` | `/api/tasks/assigned-by-me` | Tasks I created for others |
| `GET` | `/api/tasks/my-group-tasks` | Group tasks for all my groups |

### Voice

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/voice-command` | Upload audio → transcribe → extract → save |

```
Headers: X-User-Id: <user_id>
Body: multipart/form-data { audio: <webm blob> }

Response (create_task):
{ "action": "create_task", "success": true, "task": { ... }, "doc_id": "..." }

Response (create_group_task):
{ "action": "create_group_task", "success": true, "group_name": "...", "tasks_created": 1 }

Response (update_task_status):
{ "action": "update_task_status", "new_status": "completed", "updated_tasks": 3 }
```

### Health

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Backend health check |

---

## 📦 Dependencies

### Backend

| Package | Version | Purpose |
|---|---|---|
| `fastapi` | 0.111.0 | Web framework — routing, request parsing, OpenAPI docs |
| `uvicorn[standard]` | 0.29.0 | ASGI server to run FastAPI |
| `faster-whisper` | 1.0.3 | CTranslate2-based Whisper — fast CPU speech-to-text |
| `httpx` | 0.27.0 | Async HTTP client used to call the Ollama API |
| `firebase-admin` | 6.5.0 | Server-side Firestore read/write |
| `passlib[bcrypt]` | 1.7.4 | Password hashing and verification |
| `python-dateparser` | 1.2.0 | Parses natural language dates in multiple languages |
| `python-multipart` | 0.0.9 | Required for FastAPI to accept `multipart/form-data` (audio upload) |
| `python-jose[cryptography]` | 3.3.0 | JWT utilities (available for future token-based auth) |

### Frontend

| Package | Version | Purpose |
|---|---|---|
| `react` + `react-dom` | 18.3.1 | UI framework |
| `react-router-dom` | 6.23.1 | Client-side routing with protected routes |
| `axios` | 1.6.8 | HTTP client with request interceptor for auth headers |
| `firebase` | 10.12.2 | Firebase JS SDK — Firestore real-time listeners |
| `framer-motion` | 11.18.2 | Animations for mic button, toasts, task cards |
| `lucide-react` | 0.395.0 | Icon set (Mic, LogOut, Users, etc.) |
| `tailwindcss` | 3.4.4 | Utility-first CSS framework |
| `vite` | 5.2.12 | Build tool and dev server with HMR |

---

## ⚠️ Common Issues & Fixes

**Whisper model downloads on first run**
> The `medium` model is ~1.5 GB and downloads automatically on first startup. This is a one-time operation. Set `WHISPER_MODEL=base` in `.env` for a faster (less accurate) alternative during development.

**`serviceAccountKey.json` not found**
> Ensure the file is placed at `backend/serviceAccountKey.json` and the `FIREBASE_SERVICE_ACCOUNT` env var matches the path. The file must be the full service account JSON, not the web SDK config.

**Ollama 503 / connection refused**
> Ollama must be running before starting the backend. Run `ollama serve` in a separate terminal. Verify with `curl http://localhost:11434`.

**CORS errors in browser**
> The backend allows all origins (`allow_origins=["*"]`). If you still see CORS errors, ensure you're accessing the frontend via `http://localhost:5173` (not a different port) and that the Vite proxy is active (dev server only).

**Firestore `failed-precondition` / missing composite index**
> Some queries require composite indexes. Firestore will log a direct URL in the browser console to create the missing index. Click it, wait ~1 minute for the index to build, then reload.

**Voice command returns "User not found"**
> The LLM extracted a name that doesn't match any registered user. Ensure the person is registered and that the spoken name closely matches their registered name. The backend does case-insensitive matching via `name_lower`.

**Mic button stays in "Processing" state**
> This usually means the backend returned an error that wasn't caught. Check the browser Network tab for the `/api/voice-command` response and the backend terminal for the full traceback.

**`ollama pull` fails or model not found**
> Run `ollama list` to see available models. If `llama3.2` is not listed, run `ollama pull llama3.2`. You can also set `OLLAMA_MODEL=llama3` or any other installed model in `.env`.

---

## 📈 Future Improvements

- **Mobile app** — React Native or PWA wrapper so voice commands work on phones
- **Better NLP** — fine-tune the LLM prompt or use a dedicated NER model for more reliable name/date extraction
- **Firebase Auth** — replace the custom bcrypt auth with Firebase Authentication for OAuth (Google, GitHub) support
- **Task editing** — allow updating task title, priority, and due date after creation
- **Notifications** — push notifications when a task is assigned to you
- **File attachments** — attach documents or images to tasks via Firebase Storage
- **Analytics dashboard** — charts showing task completion rates, team velocity
- **Webhook / Slack integration** — post task updates to a Slack channel automatically
- **Larger Whisper model** — switch to `large-v3` on GPU hardware for near-perfect multilingual accuracy
- **Offline support** — Firestore offline persistence is already supported by the SDK; just needs enabling

---

## 📄 License

MIT — free to use, modify, and distribute.
