from dotenv import load_dotenv
load_dotenv()

import os
import json
import time
import tempfile

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from google import genai
from prompts import SYSTEM_INSTRUCTION, USER_PROMPT

app = FastAPI()


def get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing GEMINI_API_KEY in env/.env")
    return genai.Client(api_key=api_key)


def validate_video_upload(video: UploadFile) -> None:
    """
    Accept common video MIME types.
    Also accept Windows curl's application/octet-stream as long as the file extension looks like a video.
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

    if ct.startswith("video/") or ct in allowed_ct:
        if ct == "application/octet-stream" and ext not in allowed_ext:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported octet-stream file extension: {ext} (filename={video.filename})",
            )
        return

    raise HTTPException(status_code=400, detail=f"Unsupported content_type: {video.content_type}")


def wait_until_file_active(client: genai.Client, file_name: str, timeout_s: int = 60, poll_s: float = 1.0):
    """
    Videos may upload in PROCESSING state; only ACTIVE can be used for inference. :contentReference[oaicite:2]{index=2}
    """
    deadline = time.time() + timeout_s
    last_state = None

    while time.time() < deadline:
        f = client.files.get(name=file_name)
        # SDK typically exposes a 'state' field; we handle it defensively.
        state = getattr(f, "state", None)
        last_state = state

        # If state is not present, just return and let inference attempt proceed.
        if state is None:
            return f

        # Some SDKs represent enum values as strings; normalize.
        s = str(state).upper()
        if "ACTIVE" in s:
            return f
        if "FAILED" in s:
            raise RuntimeError(f"Uploaded file state FAILED: {f}")

        time.sleep(poll_s)

    raise RuntimeError(f"Timed out waiting for file to become ACTIVE. Last state={last_state}")


@app.post("/api/analyze")
async def analyze(video: UploadFile = File(...)):
    validate_video_upload(video)

    # Save uploaded file to temp
    filename = (video.filename or "upload").lower()
    ext = os.path.splitext(filename)[1]
    if ext not in {".mp4", ".webm", ".mov"}:
        ext = ".mp4"

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as f:
        tmp_path = f.name
        f.write(await video.read())

    try:
        print("received:", video.filename, video.content_type, "saved_to:", tmp_path)

        client = get_client()

        # IMPORTANT: google-genai uses 'file=' (not 'path=') for upload. :contentReference[oaicite:3]{index=3}
        uploaded = client.files.upload(file=tmp_path)

        # For video, wait until it's ACTIVE (some uploads need processing). :contentReference[oaicite:4]{index=4}
        # uploaded.name is the file resource name used to query status.
        uploaded = wait_until_file_active(client, file_name=uploaded.name, timeout_s=90, poll_s=1.0)

        model = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")

        resp = client.models.generate_content(
            model=model,
            contents=[
                SYSTEM_INSTRUCTION,
                uploaded,
                USER_PROMPT,
            ],
        )

        text = (resp.text or "").strip()
        if not text:
            raise HTTPException(status_code=500, detail="Empty response from model")

        # Enforce raw JSON output
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            preview = text[:400]
            raise HTTPException(
                status_code=500,
                detail=f"Model output is not valid JSON: {e}. Output preview: {preview}",
            )

        # Minimal schema check
        if not isinstance(data, dict):
            raise HTTPException(status_code=500, detail="Model JSON is not an object")

        for key in ("title", "steps", "error_log"):
            if key not in data:
                raise HTTPException(status_code=500, detail=f"Missing key in model JSON: {key}")

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
