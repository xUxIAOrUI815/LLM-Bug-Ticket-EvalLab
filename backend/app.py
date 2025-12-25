from dotenv import load_dotenv
load_dotenv()

import os
import json
import time
import tempfile

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from google import genai
from prompts import SYSTEM_INSTRUCTION, USER_PROMPT

app = FastAPI()

# --- CORS: allow React(Vite) dev server ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite default
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing GEMINI_API_KEY in env/.env")
    return genai.Client(api_key=api_key)


def validate_video_upload(video: UploadFile) -> str:
    """
    Accept common video MIME types.
    Also accept Windows curl's application/octet-stream (with extension check).
    Returns chosen file extension for temp file.
    """
    ct = (video.content_type or "").lower()
    filename = (video.filename or "").lower()
    ext = os.path.splitext(filename)[1]  # ".mp4", ".webm", ".mov"

    allowed_ct = {
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "application/octet-stream",  # Windows curl often uses this
    }
    allowed_ext = {".mp4", ".webm", ".mov"}

    # Accept video/* and known allowed_ct
    if ct.startswith("video/") or ct in allowed_ct:
        # If octet-stream, require known video extension
        if ct == "application/octet-stream":
            if ext not in allowed_ext:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported octet-stream file extension: {ext} (filename={video.filename})",
                )
        # choose extension fallback
        if ext not in allowed_ext:
            ext = ".mp4"
        return ext

    raise HTTPException(status_code=400, detail=f"Unsupported content_type: {video.content_type}")


def wait_until_file_active(
    client: genai.Client,
    file_name: str,
    timeout_s: int = 90,
    poll_s: float = 1.0,
):
    """
    Videos may be uploaded in PROCESSING state; wait until ACTIVE to avoid intermittent failures.
    """
    deadline = time.time() + timeout_s
    last_state = None

    while time.time() < deadline:
        f = client.files.get(name=file_name)
        state = getattr(f, "state", None)
        last_state = state

        # If SDK doesn't expose state, just proceed.
        if state is None:
            return f

        s = str(state).upper()
        if "ACTIVE" in s:
            return f
        if "FAILED" in s:
            raise RuntimeError(f"Uploaded file state FAILED: {f}")

        time.sleep(poll_s)

    raise RuntimeError(f"Timed out waiting for file to become ACTIVE. Last state={last_state}")


def build_issue_markdown(title: str, steps: list, error_log: list) -> str:
    steps = steps or []
    error_log = error_log or []

    steps_md = "\n".join([f"{i+1}. {s}" for i, s in enumerate(steps)]) or "-"
    err = "\n".join(error_log)

    return (
        f"### 🐞 Bug: {title}\n\n"
        f"**Steps to Reproduce**\n{steps_md}\n\n"
        f"**Error Log**\n```text\n{err}\n```\n"
    )


@app.post("/api/analyze")
async def analyze(video: UploadFile = File(...)):
    # 1) Validate upload (and decide temp suffix)
    suffix = validate_video_upload(video)

    # 2) Save upload to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        tmp_path = f.name
        f.write(await video.read())

    try:
        # Helpful debug (keep during dev)
        print("received:", video.filename, video.content_type, "saved_to:", tmp_path)

        client = get_client()

        # 3) Upload video via File API
        # IMPORTANT: current google-genai SDK uses file=, not path=
        uploaded = client.files.upload(file=tmp_path)

        # 4) Wait until file is ACTIVE (some videos need processing)
        uploaded = wait_until_file_active(client, file_name=uploaded.name, timeout_s=90, poll_s=1.0)

        # 5) Call Gemini
        model = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")

        resp = client.models.generate_content(
            model=model,
            contents=[SYSTEM_INSTRUCTION, uploaded, USER_PROMPT],
        )

        text = (resp.text or "").strip()
        if not text:
            raise HTTPException(status_code=500, detail="Empty response from model")

        # 6) Enforce raw JSON
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            preview = text[:500]
            raise HTTPException(
                status_code=500,
                detail=f"Model output is not valid JSON: {e}. Output preview: {preview}",
            )

        if not isinstance(data, dict):
            raise HTTPException(status_code=500, detail="Model JSON is not an object")

        # 7) Minimal schema check
        for key in ("title", "steps", "error_log"):
            if key not in data:
                raise HTTPException(status_code=500, detail=f"Missing key in model JSON: {key}")

        # 8) Add human-usable markdown
        data["issue_markdown"] = build_issue_markdown(
            title=data.get("title", ""),
            steps=data.get("steps", []),
            error_log=data.get("error_log", []),
        )

        return JSONResponse(content=data)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass
