import os
import json
import re
import difflib
import tempfile
import httpx
import dateparser
import firebase_admin
from firebase_admin import credentials, firestore
from fastapi import FastAPI, File, UploadFile, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from datetime import datetime, timezone
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
from typing import Optional
from googletrans import Translator

# --- Google Translate client (used to convert Hindi/Hinglish names → English) ---
_translator = Translator()

# --- App Init ---
app = FastAPI(title="Voice Task Manager")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Firebase Init ---
# Place your Firebase service account key JSON file at backend/serviceAccountKey.json
SERVICE_ACCOUNT_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT", "serviceAccountKey.json")

if not firebase_admin._apps:
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)

db = firestore.client()

# --- Password Hashing ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# --- Pydantic Models ---
class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class CreateGroupRequest(BaseModel):
    group_name: str

class JoinGroupRequest(BaseModel):
    group_id: str

class LeaveGroupRequest(BaseModel):
    group_id: str

class RemoveMemberRequest(BaseModel):
    group_id: str
    member_id: str

class CreateTaskRequest(BaseModel):
    task_title: str
    assignee_name: str
    priority: Optional[str] = "medium"
    due_date: Optional[str] = None
    group_id: Optional[str] = None
    group_name: Optional[str] = None

class CreateGroupTaskRequest(BaseModel):
    group_id: str
    task_title: str
    priority: Optional[str] = "medium"
    due_date: Optional[str] = None

class UpdateTaskStatusRequest(BaseModel):
    task_id: str
    new_status: str

# --- Whisper Model Init ---
# "medium" gives significantly better accuracy for Hindi/Gujarati and other
# non-English languages compared to "base". Override via WHISPER_MODEL env var
# if you need to trade speed for accuracy (e.g. "large-v3" on a capable machine).
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL", "medium")
print(f"Loading Whisper model: {WHISPER_MODEL_SIZE} ...")
whisper_model = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
print("Whisper model loaded.")

# --- Ollama Config ---
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")

SYSTEM_PROMPT = (
    "You are a strict JSON data extractor for a task management system. "
    "Read the user's voice command and classify it, then extract fields.\n\n"

    # ── CRITICAL RULE ────────────────────────────────────────────────────────
    "CRITICAL CLASSIFICATION RULE:\n"
    "1. If the assignee is a PERSON NAME (e.g. viraj, hiten, amit, rahul), you MUST use "
    "command_type=create_task and put the name in assignee_name. "
    "NEVER return create_group_task for a person name.\n"
    "2. If the assignee contains ANY of these words — team, group, department, squad, "
    "crew, frontend, backend, dev, development, design, marketing, qa, testing, "
    "devops, sales, support, engineering — you MUST use command_type=create_group_task "
    "and put the name in group_name. NEVER use create_task for these.\n\n"

    # ── INDIVIDUAL TASK ───────────────────────────────────────────────────────
    "If the command assigns a task to a SINGLE PERSON (a human name, not a team/group), output:\n"
    '{"command_type": "create_task", "task_title": "...", "assignee_name": "...", '
    '"priority": "low|medium|high", "due_date": "tomorrow|today|next week|null"}\n\n'

    # ── GROUP TASK ────────────────────────────────────────────────────────────
    "If the command assigns a task to a GROUP, TEAM, or DEPARTMENT, output:\n"
    '{"command_type": "create_group_task", "group_name": "...", "task_title": "...", '
    '"priority": "low|medium|high", "due_date": "tomorrow|today|next week|null"}\n\n'
    "Use create_group_task whenever the target contains: team, group, department, squad, "
    "or is clearly a collective noun (frontend, backend, dev, design, marketing, qa, etc.).\n\n"

    # ── UPDATE STATUS ─────────────────────────────────────────────────────────
    "If the command is about UPDATING task status, output:\n"
    '{"command_type": "update_task_status", '
    '"assignee_name": "<name>|null", '
    '"task_number": <integer>|null, '
    '"target": "specific|all", '
    '"from_status": "pending|in-progress|completed|approved|null", '
    '"status": "pending|in-progress|completed|approved"}\n\n'
    "Field rules for update_task_status:\n"
    "- target: 'specific' when a task number is mentioned, 'all' for bulk commands.\n"
    "- task_number: the integer task number if mentioned, otherwise null.\n"
    "- from_status: the current status being filtered (e.g. 'complete all PENDING tasks' → 'pending'). "
    "Use null if no source status is mentioned.\n"
    "- assignee_name: the person's name if mentioned. "
    "For 'my tasks' / 'all tasks' without a name, use null (backend resolves from auth).\n"
    "- status: the TARGET status to set. Map spoken phrases — "
    "'complete'/'done'/'finish' → 'completed'; "
    "'in progress'/'in process'/'started' → 'in-progress'; "
    "'approve' → 'approved'; 'pending' → 'pending'.\n\n"

    # ── LEAVE GROUP ───────────────────────────────────────────────────────────
    "If the command is about LEAVING a group, output:\n"
    '{"command_type": "leave_group", "group_name": "..."}\n\n'
    "Examples: 'leave the frontend team', 'remove me from development group'.\n\n"

    # ── REMOVE MEMBER ─────────────────────────────────────────────────────────
    "If the command is about REMOVING a member from a group (owner action), output:\n"
    '{"command_type": "remove_member", "group_name": "...", "member_name": "..."}\n\n'
    "Examples: 'remove rahul from frontend team', 'delete hiten from development group'.\n\n"

    # ── EXAMPLES ─────────────────────────────────────────────────────────────
    "Examples (follow these exactly):\n"
    "  'create task for hiten to submit report'           → command_type=create_task, assignee_name=hiten\n"
    "  'assign task to viraj to fix bug'                  → command_type=create_task, assignee_name=viraj\n"
    "  'create task for frontend team to submit report'   → command_type=create_group_task, group_name=frontend team\n"
    "  'assign task to backend group to deploy service'   → command_type=create_group_task, group_name=backend group\n"
    "  'create task for development team'                 → command_type=create_group_task, group_name=development team\n"
    "  'assign report to backend group'                   → command_type=create_group_task, group_name=backend group\n"
    "  'create task for dev team to write tests'          → command_type=create_group_task, group_name=dev team\n"
    "  'assign design task to ui team'                    → command_type=create_group_task, group_name=ui team\n"
    "  'complete task 1 for viraj'                        → target=specific, task_number=1, assignee_name=viraj, status=completed\n"
    "  'approve all pending tasks'                        → target=all, from_status=pending, assignee_name=null, status=approved\n"
    "  'complete all approved tasks'                      → target=all, from_status=approved, assignee_name=null, status=completed\n"
    "  'complete all my tasks'                            → target=all, from_status=null, assignee_name=null, status=completed\n"
    "  'mark hiten tasks in progress'                     → target=all, from_status=null, assignee_name=hiten, status=in-progress\n"
    "  'leave the frontend team'                          → command_type=leave_group, group_name=frontend team\n"
    "  'remove rahul from backend group'                  → command_type=remove_member, group_name=backend group, member_name=rahul\n\n"
    # ── HINDI / HINGLISH INPUT ────────────────────────────────────────────────
    "LANGUAGE RULE — Hindi / Hinglish input:\n"
    "If the voice command is in Hindi or Hinglish, transliterate or translate "
    "all person names and group names into their English equivalents BEFORE "
    "placing them in the JSON fields. Never output Devanagari script in the JSON.\n"
    "CRITICAL: If a PERSON NAME is mentioned (e.g. विराज→viraj, हितेन→hiten, अमित→amit), "
    "ALWAYS return command_type=create_task. NEVER return create_group_task for a person.\n"
    "Examples:\n"
    "  'विराज को प्रेजेंटेशन बनाने का टास्क दो' → command_type=create_task, assignee_name=viraj\n"
    "  'हितेन को रिपोर्ट बनाने का टास्क दो'     → command_type=create_task, assignee_name=hiten\n"
    "  'मैनेजमेंट टीम को टास्क दो'              → command_type=create_group_task, group_name=management team\n"
    "  'मेंजिमेंट टीम को प्रेजेंटेशन बनाओ'      → command_type=create_group_task, group_name=management team\n"
    "  'डेव टीम को बग फिक्स करो'                → command_type=create_group_task, group_name=dev team\n\n"

    "Output ONLY valid JSON. No markdown, no extra text."
)


def _norm_name(text: str) -> str:
    """
    Normalize a name for matching: lowercase + strip all non-alphanumeric chars.
    'front-end team' → 'frontendteam'
    'Frontend Team'  → 'frontendteam'
    'front end team' → 'frontendteam'
    """
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _translate_to_english(text: str) -> str:
    """
    Translate Hindi / Hinglish text to English using Google Translate.
    Falls back to the original text if translation fails (network error, etc.).
    Always returns a lowercase string.
    """
    if not text:
        return ""
    try:
        result = _translator.translate(text.strip(), dest="en")
        translated = result.text.lower()
        if translated != text.lower():
            print(f"[translate] '{text}' → '{translated}'")
        return translated
    except Exception as e:
        print(f"[translate] Failed for '{text}': {e} — using original")
        return text.lower()


def _norm_translated(text: str) -> str:
    """
    Translate (Hindi → English) then normalize.
    Single helper used for both group and user name matching.
    """
    return _norm_name(_translate_to_english(text))


def _find_group_by_name(spoken_name: str) -> tuple[object, dict] | tuple[None, None]:
    """
    Match a spoken group name (any language) against all Firestore groups.

    Matching strategy — tries each in order, stops at first hit:
      1. Normalized translation of spoken_name vs normalized stored group_name_lower
      2. Normalized translation vs normalized stored group_name (display name)

    Returns (doc, data) on match, (None, None) if nothing found.
    """
    if not (spoken_name or "").strip():
        return None, None

    # Translate + normalize the spoken input once
    translated   = _translate_to_english(spoken_name)
    target_norm  = _norm_name(translated)
    original_norm = _norm_name(spoken_name)   # fallback: try without translation too

    print(f"[group-match] raw='{spoken_name}' translated='{translated}' norm='{target_norm}'")

    for gdoc in db.collection("groups").stream():
        gdata  = gdoc.to_dict()
        stored = _norm_name(gdata.get("group_name_lower") or gdata.get("group_name", ""))

        if stored in (target_norm, original_norm):
            print(f"[group-match] ✓ matched '{gdata.get('group_name')}' (id={gdoc.id})")
            return gdoc, gdata

    print(f"[group-match] ✗ no match for '{spoken_name}'")
    return None, None


def transcribe_audio(file_path: str) -> str:
    """
    Run faster-whisper on the given audio file and return the transcript.

    Key parameters for multilingual accuracy (Hindi / Gujarati / English):
    - beam_size=5 / best_of=5: explore more candidate sequences before committing
    - temperature=0: greedy decoding — deterministic and usually more accurate
      than sampling when the model is large enough
    - vad_filter=True: strip silent segments before transcription so Whisper
      doesn't hallucinate text over silence or background noise
    """
    segments, info = whisper_model.transcribe(
        file_path,
        beam_size=5,
        best_of=5,
        temperature=0,
        vad_filter=True,
    )
    print(f"Detected language: {info.language} (probability: {info.language_probability:.2f})")
    transcript = " ".join(segment.text.strip() for segment in segments)
    print(f"Transcript: {transcript}")
    return transcript


def extract_task_from_ollama(transcript: str) -> dict:
    """Send transcript to Ollama and parse the returned JSON."""
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": transcript,
        "system": SYSTEM_PROMPT,
        "stream": False,
    }

    try:
        response = httpx.post(OLLAMA_URL, json=payload, timeout=60.0)
        response.raise_for_status()
    except Exception as e:
        print("[Ollama] Extraction failed:", str(e))
        raise HTTPException(status_code=503, detail="Ollama is not running or not reachable.")

    raw_text = response.json().get("response", "")
    print(f"Ollama raw response: {raw_text}")

    # Strip any accidental markdown code fences
    cleaned = re.sub(r"```(?:json)?|```", "", raw_text).strip()

    try:
        task_data = json.loads(cleaned)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=422,
            detail=f"Ollama did not return valid JSON. Raw output: {raw_text}",
        )

    return task_data


def parse_due_date(due_date_str: Optional[str]) -> Optional[str]:
    """
    Convert a natural-language date phrase (e.g. 'tomorrow', 'next week',
    'अगले सोमवार') into an ISO-8601 date string (YYYY-MM-DD).
    Returns None if the phrase is missing or unparseable.
    """
    if not due_date_str or due_date_str.lower() == "null":
        return None
    parsed = dateparser.parse(
        due_date_str,
        settings={"PREFER_DATES_FROM": "future", "RETURN_AS_TIMEZONE_AWARE": False},
    )
    if parsed is None:
        print(f"Could not parse due_date: '{due_date_str}'")
        return None
    return parsed.strftime("%Y-%m-%d")


def bulk_update_task_status(
    new_status: str,
    assignee_name: Optional[str] = None,
    task_number: Optional[int] = None,
    from_status: Optional[str] = None,
) -> tuple[int, list[str]]:
    """
    Unified status updater. Handles three cases:

    1. Specific task  — task_number is provided
       Query: assignee_name + task_number
    2. Filtered bulk  — from_status is provided, no task_number
       Query: assignee_name (optional) + current status == from_status
    3. Full bulk      — neither task_number nor from_status
       Query: assignee_name (optional), updates ALL tasks for that user

    Returns (count_updated, [doc_ids]).
    Raises HTTP 404 when a specific task lookup finds nothing.
    """
    base = db.collection("tasks")

    # ── Case 1: specific task by number ───────────────────────────────────────
    if task_number is not None:
        if not assignee_name:
            raise HTTPException(
                status_code=400,
                detail="assignee_name is required when updating a specific task_number.",
            )
        results = (
            base
            .where("assignee_name", "==", assignee_name)
            .where("task_number", "==", task_number)
            .limit(1)
            .get()
        )
        if not results:
            raise HTTPException(
                status_code=404,
                detail=f"Task #{task_number} for '{assignee_name}' not found.",
            )
        results[0].reference.update({"status": new_status})
        print(f"Task #{task_number} ({assignee_name}) → '{new_status}'")
        return 1, [results[0].id]

    # ── Case 2 & 3: bulk update ────────────────────────────────────────────────
    q = base
    if assignee_name:
        q = q.where("assignee_name", "==", assignee_name)
    if from_status:
        q = q.where("status", "==", from_status)

    docs = list(q.stream())
    doc_ids = []
    for doc in docs:
        doc.reference.update({"status": new_status})
        doc_ids.append(doc.id)

    label = f"assignee='{assignee_name or 'all'}'"
    if from_status:
        label += f", from_status='{from_status}'"
    print(f"Bulk updated {len(doc_ids)} task(s) [{label}] → '{new_status}'")
    return len(doc_ids), doc_ids


def get_next_task_number(assignee_name: str) -> int:
    """
    Return the next sequential task_number for the given assignee.
    Finds the highest existing task_number assigned to that user and adds 1.
    Starts at 1 if no tasks exist yet.
    """
    results = (
        db.collection("tasks")
        .where("assignee_name", "==", assignee_name.lower())
        .order_by("task_number", direction=firestore.Query.DESCENDING)
        .limit(1)
        .get()
    )
    if not results:
        return 1
    return (results[0].to_dict().get("task_number") or 0) + 1


def get_next_group_task_number(group_id: str) -> int:
    """
    Return the next sequential task_number for a group task.
    Scoped to the group_id so each group has its own numbering.
    """
    results = (
        db.collection("tasks")
        .where("group_id", "==", group_id)
        .where("assignee_name", "==", None)
        .order_by("task_number", direction=firestore.Query.DESCENDING)
        .limit(1)
        .get()
    )
    if not results:
        # Also check legacy per-member docs to avoid number collisions
        legacy = (
            db.collection("tasks")
            .where("group_id", "==", group_id)
            .order_by("task_number", direction=firestore.Query.DESCENDING)
            .limit(1)
            .get()
        )
        if not legacy:
            return 1
        return (legacy[0].to_dict().get("task_number") or 0) + 1
    return (results[0].to_dict().get("task_number") or 0) + 1


# Canonical status values stored in Firestore.
# The LLM is instructed to use these, but we normalise defensively here too.
_STATUS_ALIASES = {
    "complete":     "completed",
    "completed":    "completed",
    "done":         "completed",
    "finish":       "completed",
    "finished":     "completed",
    "in progress":  "in-progress",
    "in-progress":  "in-progress",
    "in process":   "in-progress",
    "inprogress":   "in-progress",
    "started":      "in-progress",
    "working":      "in-progress",
    "approve":      "approved",
    "approved":     "approved",
    "pending":      "pending",
    "todo":         "pending",
}

def normalise_status(raw: str) -> str:
    """Map any spoken/LLM status phrase to a canonical Firestore value."""
    return _STATUS_ALIASES.get(raw.strip().lower(), raw.strip().lower())


def validate_assignee(assignee_name: str) -> str:
    """
    Look up assignee_name case-insensitively via the 'name_lower' field.
    Returns the matching document ID.
    Raises HTTP 400 if the user is not registered.
    """
    results = (
        db.collection("users")
        .where("name_lower", "==", assignee_name.lower())
        .limit(1)
        .get()
    )

    if not results:
        raise HTTPException(
            status_code=400,
            detail=f"User '{assignee_name}' is not registered in the system.",
        )

    user_doc = results[0]
    print(f"Assignee validated: {assignee_name} (doc_id={user_doc.id})")
    return user_doc.id


def find_closest_user(name: str):
    """
    Fuzzy-match a spoken/transcribed name against all registered users.

    Scoring strategy (takes the max of two signals):
      1. SequenceMatcher ratio  — handles typos, dropped letters, accent shifts
         e.g. "raul" vs "rahul" → ~0.89
      2. Substring containment  — handles partial transcriptions
         e.g. "ten" in "hiten" → 1.0

    Threshold: 0.6 — low enough to catch bad transcriptions, high enough to
    avoid false positives between short distinct names.
    """
    original_input = name
    name = name.lower().strip()
    if not name:
        return None

    users = list(db.collection("users").stream())
    best_match = None
    best_score = 0.0

    for user in users:
        user_data = user.to_dict()
        user_name = user_data.get("name_lower", "").lower()
        if not user_name:
            continue

        score_full    = difflib.SequenceMatcher(None, name, user_name).ratio()
        score_partial = 1.0 if (name in user_name or user_name in name) else 0.0
        score         = max(score_full, score_partial)

        if score > best_score:
            best_score = score
            best_match = user

    if best_score >= 0.6:
        matched_name = best_match.to_dict().get("name_lower")
        print(f"[fuzzy-match] '{original_input}' → '{matched_name}' (score={best_score:.2f})")
        return best_match

    print(f"[fuzzy-match] No match for '{original_input}' (best_score={best_score:.2f})")
    return None


def save_task_to_firestore(task_data: dict, transcript: str, sender_id: str) -> str:
    """Persist the task document to Firestore and return the new document ID."""
    assignee = (task_data.get("assignee_name") or "unassigned").strip().lower()
    task_number = get_next_task_number(assignee)

    doc = {
        "task_title":    task_data.get("task_title", "Untitled Task"),
        "assignee_name": assignee,
        "task_number":   task_number,
        "priority":      (task_data.get("priority") or "medium").lower(),
        "due_date":      parse_due_date(task_data.get("due_date")),
        "status":        "pending",
        "transcript":    transcript,
        "sender_id":     sender_id,
        "created_at":    datetime.now(timezone.utc),
    }

    try:
        _, doc_ref = db.collection("tasks").add(doc)
    except Exception as e:
        print(f"[Firestore] Failed to write task: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save task: {e}")

    print(f"Task #{task_number} saved for '{assignee}' (doc_id={doc_ref.id})")
    task_data["task_number"] = task_number
    return doc_ref.id


def save_group_tasks_to_firestore(task_data: dict, transcript: str, sender_id: str) -> str:
    """
    Look up the group by normalized name match, then create ONE task document
    for the group. No assignee_name — all members share the same task.
    Returns the created doc ID.
    """
    group_name_raw = (task_data.get("group_name") or "").strip()
    if not group_name_raw:
        raise HTTPException(status_code=400, detail="group_name is required for create_group_task.")

    group_doc, group = _find_group_by_name(group_name_raw)
    if group_doc is None:
        raise HTTPException(status_code=404, detail=f"Group '{group_name_raw}' not found.")

    members: list[str] = group.get("members", [])
    if not members:
        raise HTTPException(status_code=400, detail=f"Group '{group_name_raw}' has no members.")

    task_number = get_next_group_task_number(group_doc.id)

    doc = {
        "task_title":  task_data.get("task_title", "Untitled Task"),
        "group_id":    group_doc.id,
        "group_name":  group.get("group_name", group_name_raw),
        "assigned_by": sender_id,
        "task_number": task_number,
        "priority":    (task_data.get("priority") or "medium").lower(),
        "due_date":    parse_due_date(task_data.get("due_date")),
        "status":      "pending",
        "transcript":  transcript,
        "created_at":  datetime.now(timezone.utc),
        # No assignee_name — this is a group-wide task
    }

    try:
        _, doc_ref = db.collection("tasks").add(doc)
    except Exception as e:
        print(f"[Firestore] Failed to write group task: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save group task: {e}")

    print(f"Group task #{task_number} saved for group '{group_name_raw}' (doc_id={doc_ref.id})")
    task_data["task_number"] = task_number
    return doc_ref.id


@app.post("/api/groups/create")
async def create_group(body: CreateGroupRequest, x_user_id: Optional[str] = Header(None)):
    """Create a new group. The creator is automatically added as the first member."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")

    group_name_lower = body.group_name.strip().lower()
    if not group_name_lower:
        raise HTTPException(status_code=400, detail="group_name cannot be empty.")

    # Prevent duplicate group names
    existing = (
        db.collection("groups")
        .where("group_name_lower", "==", group_name_lower)
        .limit(1)
        .get()
    )
    if existing:
        raise HTTPException(status_code=400, detail=f"Group '{body.group_name}' already exists.")

    doc = {
        "group_name":       body.group_name.strip(),
        "group_name_lower": group_name_lower,
        "created_by":       x_user_id,
        "members":          [x_user_id],
        "created_at":       datetime.now(timezone.utc),
    }
    _, doc_ref = db.collection("groups").add(doc)
    print(f"Group '{group_name_lower}' created (doc_id={doc_ref.id}) by {x_user_id}")
    return {"success": True, "group_id": doc_ref.id, "group_name": body.group_name.strip()}


@app.post("/api/groups/join")
async def join_group(body: JoinGroupRequest, x_user_id: Optional[str] = Header(None)):
    """Add the authenticated user to an existing group's members array."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")

    group_ref = db.collection("groups").document(body.group_id)
    group_doc = group_ref.get()
    if not group_doc.exists:
        raise HTTPException(status_code=404, detail="Group not found.")

    group_ref.update({"members": firestore.ArrayUnion([x_user_id])})
    group_name = group_doc.to_dict().get("group_name", body.group_id)
    print(f"User {x_user_id} joined group '{group_name}' ({body.group_id})")
    return {"success": True, "group_id": body.group_id, "group_name": group_name}


@app.get("/api/groups")
async def get_groups(x_user_id: Optional[str] = Header(None)):
    """Return all groups the authenticated user is a member of."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")

    docs = (
        db.collection("groups")
        .where("members", "array_contains", x_user_id)
        .stream()
    )
    groups = []
    for d in docs:
        g = d.to_dict()
        groups.append({
            "group_id":    d.id,
            "group_name":  g.get("group_name"),
            "created_by":  g.get("created_by"),
            "members":     g.get("members", []),
            "created_at":  g.get("created_at").isoformat() if hasattr(g.get("created_at"), "isoformat") else None,
        })
    return {"groups": groups}


@app.post("/api/groups/leave")
async def leave_group(body: LeaveGroupRequest, x_user_id: Optional[str] = Header(None)):
    """Remove the authenticated user from a group's members array."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")

    group_ref = db.collection("groups").document(body.group_id)
    group_doc = group_ref.get()
    if not group_doc.exists:
        raise HTTPException(status_code=404, detail="Group not found.")

    group_data = group_doc.to_dict()
    group_name = group_data.get("group_name", body.group_id)

    if x_user_id not in group_data.get("members", []):
        raise HTTPException(status_code=400, detail="You are not a member of this group.")

    if group_data.get("created_by") == x_user_id:
        raise HTTPException(status_code=400, detail="Group owner cannot leave. Transfer ownership or delete the group.")

    group_ref.update({"members": firestore.ArrayRemove([x_user_id])})
    print(f"User {x_user_id} left group '{group_name}' ({body.group_id})")
    return {"success": True, "group_id": body.group_id, "group_name": group_name}


@app.post("/api/groups/remove-member")
async def remove_member(body: RemoveMemberRequest, x_user_id: Optional[str] = Header(None)):
    """Owner-only: remove a specific member from the group."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")

    group_ref = db.collection("groups").document(body.group_id)
    group_doc = group_ref.get()
    if not group_doc.exists:
        raise HTTPException(status_code=404, detail="Group not found.")

    group_data = group_doc.to_dict()
    group_name = group_data.get("group_name", body.group_id)

    if group_data.get("created_by") != x_user_id:
        raise HTTPException(status_code=403, detail="Only the group owner can remove members.")

    if body.member_id == x_user_id:
        raise HTTPException(status_code=400, detail="Owner cannot remove themselves.")

    if body.member_id not in group_data.get("members", []):
        raise HTTPException(status_code=400, detail="User is not a member of this group.")

    group_ref.update({"members": firestore.ArrayRemove([body.member_id])})
    print(f"Owner {x_user_id} removed member {body.member_id} from group '{group_name}'")
    return {"success": True, "group_id": body.group_id, "group_name": group_name, "removed_member_id": body.member_id}


def check_task_status_permission(task_doc, current_user_id: str, current_user_name: str) -> None:
    """
    Enforce role-based rules for status updates:

    Individual task  → only the assignee can update status.
    Group task       → any group member (except the owner) can update status.

    Raises HTTP 403 on violation.
    """
    task = task_doc.to_dict()
    group_id = task.get("group_id")

    if group_id:
        # ── Group task rules ──────────────────────────────────────────────────
        group_doc = db.collection("groups").document(group_id).get()
        if not group_doc.exists:
            raise HTTPException(status_code=404, detail="Associated group not found.")

        group = group_doc.to_dict()
        members   = group.get("members", [])
        owner_id  = group.get("created_by")

        if current_user_id == owner_id:
            raise HTTPException(
                status_code=403,
                detail="Group owner cannot update task status — only members can.",
            )
        if current_user_id not in members:
            raise HTTPException(
                status_code=403,
                detail="Only group members can update task status.",
            )
    else:
        # ── Individual task rules ─────────────────────────────────────────────
        assignee = task.get("assignee_name", "")
        if current_user_name.lower() != assignee.lower():
            raise HTTPException(
                status_code=403,
                detail=f"Only the assignee ('{assignee}') can update this task's status.",
            )


@app.post("/api/tasks/create")
async def create_task_manual(body: CreateTaskRequest, x_user_id: Optional[str] = Header(None)):
    """
    Manual task creation from the UI form.
    Validates assignee exists, enforces group-owner-only rule for group tasks,
    then saves to Firestore.
    """
    if not x_user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")

    assignee_lower = body.assignee_name.strip().lower()

    # Validate assignee exists
    validate_assignee(assignee_lower)

    # If this is a group task, only the group owner may assign
    if body.group_id:
        group_doc = db.collection("groups").document(body.group_id).get()
        if not group_doc.exists:
            raise HTTPException(status_code=404, detail="Group not found.")
        if group_doc.to_dict().get("created_by") != x_user_id:
            raise HTTPException(
                status_code=403,
                detail="Only the group owner can assign tasks to this group.",
            )

    task_data = {
        "task_title":    body.task_title.strip(),
        "assignee_name": assignee_lower,
        "priority":      (body.priority or "medium").lower(),
        "due_date":      body.due_date or None,
        "group_id":      body.group_id or None,
        "group_name":    body.group_name or None,
    }

    task_number = get_next_task_number(assignee_lower)
    doc = {
        "task_title":    task_data["task_title"],
        "assignee_name": assignee_lower,
        "task_number":   task_number,
        "priority":      task_data["priority"],
        "due_date":      parse_due_date(task_data["due_date"]),
        "status":        "pending",
        "transcript":    None,
        "sender_id":     x_user_id,
        "group_id":      task_data["group_id"],
        "group_name":    task_data["group_name"],
        "created_at":    datetime.now(timezone.utc),
    }
    _, doc_ref = db.collection("tasks").add(doc)
    task_data["task_number"] = task_number
    print(f"Manual task #{task_number} created for '{assignee_lower}' by {x_user_id}")
    return {"success": True, "task_id": doc_ref.id, "task_number": task_number, "task": task_data}


@app.post("/api/tasks/create-group-task")
async def create_group_task_manual(body: CreateGroupTaskRequest, x_user_id: Optional[str] = Header(None)):
    """
    Manual group task creation from the UI form.
    Only the group owner may call this. Creates ONE task document shared by all members.
    """
    if not x_user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")

    group_ref = db.collection("groups").document(body.group_id)
    group_doc = group_ref.get()
    if not group_doc.exists:
        raise HTTPException(status_code=404, detail="Group not found.")

    group = group_doc.to_dict()
    if group.get("created_by") != x_user_id:
        raise HTTPException(status_code=403, detail="Only the group owner can assign tasks to this group.")

    members: list[str] = group.get("members", [])
    if not members:
        raise HTTPException(status_code=400, detail="Group has no members.")

    task_number = get_next_group_task_number(body.group_id)

    doc = {
        "task_title":  body.task_title.strip(),
        "group_id":    body.group_id,
        "group_name":  group.get("group_name", ""),
        "assigned_by": x_user_id,
        "task_number": task_number,
        "priority":    (body.priority or "medium").lower(),
        "due_date":    parse_due_date(body.due_date),
        "status":      "pending",
        "transcript":  None,
        "created_at":  datetime.now(timezone.utc),
        # No assignee_name — group-wide task
    }
    _, doc_ref = db.collection("tasks").add(doc)
    print(f"Manual group task #{task_number} created for group '{group.get('group_name')}' by {x_user_id}")

    return {
        "success":       True,
        "group_id":      body.group_id,
        "group_name":    group.get("group_name"),
        "tasks_created": 1,
        "task_number":   task_number,
        "doc_ids":       [doc_ref.id],
    }


@app.post("/api/tasks/update-status")
async def update_task_status_manual(body: UpdateTaskStatusRequest, x_user_id: Optional[str] = Header(None)):
    """
    Manual status update from the UI.
    Enforces permission rules before writing.
    """
    if not x_user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")

    task_ref = db.collection("tasks").document(body.task_id)
    task_doc = task_ref.get()
    if not task_doc.exists:
        raise HTTPException(status_code=404, detail="Task not found.")

    # Resolve current user's name for individual-task permission check
    user_doc = db.collection("users").document(x_user_id).get()
    if not user_doc.exists:
        raise HTTPException(status_code=404, detail="Authenticated user not found.")
    current_user_name = (
        user_doc.to_dict().get("name_lower") or user_doc.to_dict().get("name", "")
    ).lower()

    check_task_status_permission(task_doc, x_user_id, current_user_name)

    new_status = normalise_status(body.new_status)
    task_ref.update({"status": new_status})
    print(f"Manual status update: task {body.task_id} → '{new_status}' by {x_user_id}")
    return {"success": True, "task_id": body.task_id, "new_status": new_status}


@app.post("/api/register")
async def register(body: RegisterRequest):
    """Register a new user. Stores hashed password in Firestore."""
    # Check if email already exists
    existing = db.collection("users").where("email", "==", body.email).limit(1).get()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered.")

    password_hash = pwd_context.hash(body.password)
    doc = {
        "name": body.name,
        "name_lower": body.name.lower(),
        "email": body.email,
        "password_hash": password_hash,
        "created_at": datetime.now(timezone.utc),
    }
    _, doc_ref = db.collection("users").add(doc)
    return {"success": True, "user_id": doc_ref.id, "name": body.name}


@app.post("/api/login")
async def login(body: LoginRequest):
    """Validate credentials and return user info."""
    results = db.collection("users").where("email", "==", body.email).limit(1).get()
    if not results:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    user_doc = results[0]
    user = user_doc.to_dict()

    if not pwd_context.verify(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    return {"success": True, "user_id": user_doc.id, "name": user["name"]}


@app.get("/api/users")
async def get_users():
    """Return list of all registered users (name + id only)."""
    docs = db.collection("users").stream()
    users = [{"user_id": d.id, "name": d.to_dict().get("name")} for d in docs]
    return {"users": users}


@app.get("/api/tasks/assigned-to-me")
async def tasks_assigned_to_me(x_user_id: Optional[str] = Header(None)):
    """Tasks where the logged-in user is the assignee, sorted by task_number asc."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")

    user_doc = db.collection("users").document(x_user_id).get()
    if not user_doc.exists:
        raise HTTPException(status_code=404, detail="User not found.")

    user_name = user_doc.to_dict().get("name_lower") or user_doc.to_dict().get("name", "")
    docs = (
        db.collection("tasks")
        .where("assignee_name", "==", user_name.lower())
        .order_by("task_number", direction=firestore.Query.ASCENDING)
        .stream()
    )

    tasks = []
    for d in docs:
        t = d.to_dict()
        t["task_id"] = d.id
        if hasattr(t.get("created_at"), "isoformat"):
            t["created_at"] = t["created_at"].isoformat()
        tasks.append(t)

    return {"tasks": tasks}


@app.get("/api/tasks/assigned-by-me")
async def tasks_assigned_by_me(x_user_id: Optional[str] = Header(None)):
    """Tasks where the logged-in user is the sender, sorted by task_number asc."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")

    docs = (
        db.collection("tasks")
        .where("sender_id", "==", x_user_id)
        .order_by("task_number", direction=firestore.Query.ASCENDING)
        .stream()
    )

    tasks = []
    for d in docs:
        t = d.to_dict()
        t["task_id"] = d.id
        if hasattr(t.get("created_at"), "isoformat"):
            t["created_at"] = t["created_at"].isoformat()
        tasks.append(t)

    return {"tasks": tasks}


@app.get("/api/tasks/my-group-tasks")
async def my_group_tasks(x_user_id: Optional[str] = Header(None)):
    """
    Return all group tasks visible to the logged-in user.
    Fetches the user's groups, then queries tasks where group_id is in that set.
    Only returns docs where assignee_name is absent (new single-doc model).
    """
    if not x_user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")

    # Get all groups the user belongs to
    group_docs = (
        db.collection("groups")
        .where("members", "array_contains", x_user_id)
        .stream()
    )
    group_ids = [d.id for d in group_docs]

    if not group_ids:
        return {"tasks": []}

    # Firestore 'in' supports up to 30 values; chunk if needed
    tasks = []
    chunk_size = 30
    for i in range(0, len(group_ids), chunk_size):
        chunk = group_ids[i:i + chunk_size]
        docs = (
            db.collection("tasks")
            .where("group_id", "in", chunk)
            .stream()
        )
        for d in docs:
            t = d.to_dict()
            # Only new-model docs (no assignee_name)
            if t.get("assignee_name"):
                continue
            t["task_id"] = d.id
            if hasattr(t.get("created_at"), "isoformat"):
                t["created_at"] = t["created_at"].isoformat()
            tasks.append(t)

    tasks.sort(key=lambda x: x.get("task_number") or 0)
    return {"tasks": tasks}


@app.get("/api/tasks")
async def get_tasks(x_user_id: Optional[str] = Header(None)):
    """Return tasks assigned to the logged-in user (matched by assignee_name via user_id)."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header.")

    user_doc = db.collection("users").document(x_user_id).get()
    if not user_doc.exists:
        raise HTTPException(status_code=404, detail="User not found.")

    user_name = user_doc.to_dict().get("name_lower") or user_doc.to_dict().get("name", "")
    task_docs = (
        db.collection("tasks")
        .where("assignee_name", "==", user_name.lower())
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .stream()
    )

    tasks = []
    for d in task_docs:
        t = d.to_dict()
        t["task_id"] = d.id
        # Convert Firestore timestamp to ISO string for JSON serialisation
        if hasattr(t.get("created_at"), "isoformat"):
            t["created_at"] = t["created_at"].isoformat()
        tasks.append(t)

    return {"tasks": tasks}


@app.post("/api/voice-command")
async def voice_command(audio: UploadFile = File(...), x_user_id: Optional[str] = Header(None)):
    """
    Full voice command pipeline:
      1. Transcribe audio with Whisper
      2. Extract intent + fields via Ollama LLM
      3. Route by command_type
      4. Validate + persist to Firestore
      5. Return structured response

    All failure modes return a clean HTTP error — never an unhandled 500/503.
    """
    suffix = os.path.splitext(audio.filename or "audio.webm")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        # ── Step 1: Transcribe ────────────────────────────────────────────────
        try:
            transcript = transcribe_audio(tmp_path)
        except HTTPException:
            raise
        except Exception as e:
            print(f"[Whisper] Transcription failed: {e}")
            raise HTTPException(status_code=500, detail=f"Transcription error: {e}")

        if not transcript.strip():
            raise HTTPException(status_code=400, detail="Could not transcribe audio — got empty result.")

        # ── Step 2: Extract intent via Ollama ─────────────────────────────────
        # 503 here means Ollama is not running — that is the correct status code.
        # Users should see "Ollama unreachable" rather than a generic crash.
        try:
            task_data = extract_task_from_ollama(transcript)
        except HTTPException:
            raise
        except Exception as e:
            print(f"[Ollama] Extraction failed: {e}")
            raise HTTPException(status_code=500, detail=f"LLM extraction error: {e}")

        command_type = task_data.get("command_type", "create_task")
        print(f"[voice-command] transcript='{transcript}' command_type='{command_type}'")

        # ── Sanitize LLM output: strip pipe-separated placeholder values ──────
        raw_priority = (task_data.get("priority") or "medium").strip()
        task_data["priority"] = "medium" if "|" in raw_priority else raw_priority

        raw_due = (task_data.get("due_date") or "").strip()
        task_data["due_date"] = None if (not raw_due or "|" in raw_due or raw_due == "null") else raw_due

        # ── User-priority check: if LLM says create_group_task but a real user
        #    matches the assignee/group name, override to create_task ──────────
        # NOTE: We do NOT translate person names — Google Translate converts names
        # by meaning (e.g. "viraj" → "male") which breaks user lookup.
        # The LLM already outputs names in English (per SYSTEM_PROMPT), so we
        # only need to normalize (lowercase + strip non-alphanumeric).
        user_match = None
        if command_type in ("create_group_task", "create_task"):
            # Prefer assignee_name; fall back to group_name (LLM misclassification)
            candidate = (
                (task_data.get("assignee_name") or "").strip()
                or (task_data.get("group_name") or "").strip()
            )
            if candidate:
                norm_candidate = _norm_name(candidate)
                print(f"[user-check] raw='{candidate}' norm='{norm_candidate}'")
                user_match = (
                    db.collection("users")
                    .where("name_lower", "==", norm_candidate)
                    .limit(1)
                    .get()
                )
                if user_match:
                    print(f"[user-check] ✅ Real user found for '{candidate}' → overriding to create_task")
                    task_data["assignee_name"] = norm_candidate
                    task_data.pop("group_name", None)
                    command_type = "create_task"
                else:
                    user_match = None  # normalise to falsy for guard below

        # ── Step 3a: UPDATE TASK STATUS ───────────────────────────────────────
        if command_type in ("update_task_status", "approve_tasks"):
            raw_status    = (task_data.get("status") or "approved").strip()
            new_status    = normalise_status(raw_status)
            raw_assignee  = (task_data.get("assignee_name") or "").strip().lower()
            assignee_name: Optional[str] = raw_assignee if raw_assignee and raw_assignee != "all" else None
            task_number_raw = task_data.get("task_number")
            task_number   = int(task_number_raw) if task_number_raw else None
            from_status_raw = (task_data.get("from_status") or "").strip().lower()
            from_status   = normalise_status(from_status_raw) if from_status_raw else None

            current_user_name: Optional[str] = None
            if x_user_id:
                u_doc = db.collection("users").document(x_user_id).get()
                if u_doc.exists:
                    current_user_name = (
                        u_doc.to_dict().get("name_lower") or u_doc.to_dict().get("name", "")
                    ).lower() or None

            if assignee_name is None and current_user_name:
                assignee_name = current_user_name

            if task_number is not None and assignee_name:
                task_results = (
                    db.collection("tasks")
                    .where("assignee_name", "==", assignee_name)
                    .where("task_number", "==", task_number)
                    .limit(1)
                    .get()
                )
                if task_results and x_user_id and current_user_name:
                    check_task_status_permission(task_results[0], x_user_id, current_user_name)

            count, doc_ids = bulk_update_task_status(
                new_status=new_status,
                assignee_name=assignee_name,
                task_number=task_number,
                from_status=from_status,
            )
            return {
                "action":        "update_task_status",
                "transcript":    transcript,
                "new_status":    new_status,
                "assignee_name": assignee_name,
                "task_number":   task_number,
                "from_status":   from_status,
                "updated_tasks": count,
            }

        # ── Step 3b: LEAVE GROUP ──────────────────────────────────────────────
        if command_type == "leave_group":
            if not x_user_id:
                raise HTTPException(status_code=400, detail="Authentication required.")

            spoken = (task_data.get("group_name") or "").strip()
            if not spoken:
                raise HTTPException(status_code=400, detail="Could not extract group_name from voice command.")

            group_doc, group_data = _find_group_by_name(spoken)
            if group_doc is None:
                raise HTTPException(status_code=404, detail=f"Group '{spoken}' not found.")
            if group_data.get("created_by") == x_user_id:
                raise HTTPException(status_code=400, detail="Group owner cannot leave the group.")
            if x_user_id not in group_data.get("members", []):
                raise HTTPException(status_code=400, detail="You are not a member of this group.")

            group_doc.reference.update({"members": firestore.ArrayRemove([x_user_id])})
            print(f"Voice: user {x_user_id} left group '{spoken}'")
            return {
                "action":     "leave_group",
                "success":    True,
                "transcript": transcript,
                "group_name": group_data.get("group_name", spoken),
                "group_id":   group_doc.id,
            }

        # ── Step 3c: REMOVE MEMBER ────────────────────────────────────────────
        if command_type == "remove_member":
            if not x_user_id:
                raise HTTPException(status_code=400, detail="Authentication required.")

            spoken_group  = (task_data.get("group_name") or "").strip()
            member_name_lower = (task_data.get("member_name") or "").strip().lower()
            if not spoken_group or not member_name_lower:
                raise HTTPException(status_code=400, detail="Could not extract group_name and member_name from voice command.")

            group_doc, group_data = _find_group_by_name(spoken_group)
            if group_doc is None:
                raise HTTPException(status_code=404, detail=f"Group '{spoken_group}' not found.")
            if group_data.get("created_by") != x_user_id:
                raise HTTPException(status_code=403, detail="Only the group owner can remove members.")

            u_results = (
                db.collection("users")
                .where("name_lower", "==", member_name_lower)
                .limit(1)
                .get()
            )
            if not u_results:
                raise HTTPException(status_code=404, detail=f"User '{member_name_lower}' not found.")

            member_id = u_results[0].id
            if member_id not in group_data.get("members", []):
                raise HTTPException(status_code=400, detail=f"'{member_name_lower}' is not a member of this group.")

            group_doc.reference.update({"members": firestore.ArrayRemove([member_id])})
            print(f"Voice: owner {x_user_id} removed '{member_name_lower}' from group '{spoken_group}'")
            return {
                "action":      "remove_member",
                "success":     True,
                "transcript":  transcript,
                "group_name":  group_data.get("group_name", spoken_group),
                "group_id":    group_doc.id,
                "member_name": member_name_lower,
            }

        # ── Step 3d: CREATE GROUP TASK ────────────────────────────────────────
        if command_type == "create_group_task" and not user_match:
            spoken_group = (task_data.get("group_name") or "").strip()
            if not spoken_group:
                raise HTTPException(status_code=400, detail="Could not extract group_name from voice command.")

            group_doc, group_data = _find_group_by_name(spoken_group)
            if group_doc is None:
                # LLM hallucinated a group that doesn't exist — fall through to user task
                print(f"[voice-command] ❌ LLM hallucinated group '{spoken_group}' → falling back to create_task")
                command_type = "create_task"
                task_data["assignee_name"] = _norm_translated(spoken_group)
                task_data.pop("group_name", None)
            else:
                if group_data.get("created_by") != x_user_id:
                    raise HTTPException(
                        status_code=403,
                        detail="Only the group owner can assign tasks to this group.",
                    )

                # Normalise group_name in task_data to the canonical stored value
                task_data["group_name"] = group_data.get("group_name", spoken_group)

                print(f"[FINAL] command_type=create_group_task, group={task_data['group_name']}, assignee=None")
                actual_sender_id = x_user_id or ""
                doc_id = save_group_tasks_to_firestore(task_data, transcript, actual_sender_id)
                return {
                    "action":        "create_group_task",
                    "success":       True,
                    "transcript":    transcript,
                    "group_name":    task_data["group_name"],
                    "task_title":    task_data.get("task_title"),
                    "tasks_created": 1,
                    "doc_ids":       [doc_id],
                }

        # ── Step 3e: CREATE INDIVIDUAL TASK ──────────────────────────────────
        raw_assignee  = (task_data.get("assignee_name") or "").strip()
        # Normalize only — do NOT translate person names.
        # Google Translate converts names by meaning (e.g. "viraj" → "male").
        # The LLM already outputs names in English per SYSTEM_PROMPT.
        assignee_name = _norm_name(raw_assignee)
        task_data["assignee_name"] = assignee_name
        print(f"[FINAL] command_type=create_task, assignee='{assignee_name}', group=None")

        # Group detection fallback: LLM sometimes returns create_task for group names.
        # Use normalized matching against all Firestore groups before user lookup.
        group_doc, group_data = _find_group_by_name(assignee_name)
        if group_doc is not None:
            print(f"[voice-command] LLM misclassified group '{assignee_name}' as user — auto-correcting")
            if group_data.get("created_by") != x_user_id:
                raise HTTPException(
                    status_code=403,
                    detail="You are not the owner of this group, so you cannot assign tasks.",
                )
            task_data["group_name"] = group_data.get("group_name", assignee_name)
            task_data.pop("assignee_name", None)
            actual_sender_id = x_user_id or ""
            doc_id = save_group_tasks_to_firestore(task_data, transcript, actual_sender_id)
            return {
                "action":        "create_group_task",
                "success":       True,
                "transcript":    transcript,
                "group_name":    task_data["group_name"],
                "task_title":    task_data.get("task_title"),
                "tasks_created": 1,
                "doc_ids":       [doc_id],
            }

        # Not a group — fuzzy-match against registered users
        original_name = assignee_name
        user_doc = find_closest_user(assignee_name)
        if not user_doc:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"'{original_name}' is neither a registered user nor a known group. "
                    "Check the name and try again."
                ),
            )
        assignee_name = user_doc.to_dict().get("name_lower")
        task_data["assignee_name"] = assignee_name
        sender_id = user_doc.id
        print(f"[user-check] input='{original_name}' → matched='{assignee_name}'")

        actual_sender_id = x_user_id if x_user_id else sender_id
        doc_id = save_task_to_firestore(task_data, transcript, actual_sender_id)
        return {
            "action":     "create_task",
            "success":    True,
            "transcript": transcript,
            "task":       task_data,
            "doc_id":     doc_id,
            "sender_id":  actual_sender_id,
        }

    except HTTPException:
        # Re-raise known HTTP errors unchanged — they already have the right status + message
        raise
    except Exception as e:
        # Catch-all: log the full traceback and return a clean 500
        # This prevents any unhandled exception from becoming a cryptic 503
        import traceback
        print(f"[voice-command] Unexpected error:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Unexpected server error: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass  # temp file cleanup — non-fatal


@app.get("/health")
def health():
    return {"status": "ok"}
