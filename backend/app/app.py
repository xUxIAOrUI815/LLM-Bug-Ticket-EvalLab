from __future__ import annotations

from dotenv import load_dotenv
load_dotenv()

import os
import json
import time
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from google import genai

# =========================
# Paths / Config
# =========================
BASE_DIR = Path(__file__).resolve().parent
DATASETS_DIR = BASE_DIR / "datasets"
PROMPTS_DIR = BASE_DIR / "prompts"
RULES_DIR = BASE_DIR / "rules"
RUNS_DIR = BASE_DIR / "storage" / "runs"

RUNS_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_RULES_PATH = RULES_DIR / "default_rules.json"

RUNS_DIR.mkdir(parents=True, exist_ok=True)
RULES_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173"]

# =========================
# FastAPI
# =========================
app = FastAPI(title="LLM Bug-Ticket EvalLab")

app.add_middleware(
    CORSMiddleware,
    allow_origins=DEFAULT_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# Types
# =========================
InputType = Literal["text", "video"]
Severity = Literal["low", "medium", "high", "critical"]

TICKET_SCHEMA_KEYS = [
    "title",
    "steps",
    "expected",
    "actual",
    "environment",
    "severity",
    "tags",
    "confidence",
]
ENV_KEYS = ["os", "browser", "app_version"]


class RunRequest(BaseModel):
    dataset_version: str = Field(..., examples=["v1"])
    prompt_name: str = Field(..., examples=["ticket_v1_schema"])
    model: str = Field(..., examples=["gemini-3-flash-preview"])
    max_samples: int = Field(50, ge=1, le=500)
    input_types: Optional[List[InputType]] = Field(default=None, description="e.g. ['text','video']; None=all")


class RunSummary(BaseModel):
    run_id: str
    status: str
    config: Dict[str, Any]
    metrics: Dict[str, Any]


@dataclass
class ModelCallResult:
    raw_text: str
    latency_ms: int


# =========================
# Gemini client / provider
# =========================
def get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing GEMINI_API_KEY in env/.env")
    return genai.Client(api_key=api_key)


def wait_until_file_active(
    client: genai.Client,
    file_name: str,
    timeout_s: int = 90,
    poll_s: float = 1.0,
):
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


def _strip_code_fences(s: str) -> str:
    s = (s or "").strip()
    # Remove common ```json ... ``` wrappers
    if s.startswith("```"):
        lines = s.splitlines()
        # drop first and last fence if present
        if len(lines) >= 2 and lines[0].startswith("```") and lines[-1].startswith("```"):
            s = "\n".join(lines[1:-1]).strip()
    return s


def validate_video_upload(video: UploadFile) -> str:
    ct = (video.content_type or "").lower()
    filename = (video.filename or "").lower()
    ext = os.path.splitext(filename)[1]

    allowed_ct = {
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "application/octet-stream",
    }
    allowed_ext = {".mp4", ".webm", ".mov"}

    if ct.startswith("video/") or ct in allowed_ct:
        if ct == "application/octet-stream" and ext not in allowed_ext:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported octet-stream file extension: {ext} (filename={video.filename})",
            )
        if ext not in allowed_ext:
            ext = ".mp4"
        return ext

    raise HTTPException(status_code=400, detail=f"Unsupported content_type: {video.content_type}")


def load_prompt(prompt_name: str) -> str:
    """
    prompt_name is filename without extension, e.g. ticket_v1_schema
    """
    path = PROMPTS_DIR / f"{prompt_name}.txt"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Prompt not found: {prompt_name}")
    return path.read_text(encoding="utf-8")


def list_prompt_names() -> List[str]:
    if not PROMPTS_DIR.exists():
        return []
    return sorted([p.stem for p in PROMPTS_DIR.glob("*.txt")])


def list_dataset_versions() -> List[str]:
    if not DATASETS_DIR.exists():
        return []
    return sorted([p.name for p in DATASETS_DIR.iterdir() if p.is_dir() and (p / "bugs.jsonl").exists()])


def list_models() -> List[str]:
    # You can later extend to OpenAI/Qwen/etc.
    return [os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")]


def gemini_generate(
    client: genai.Client,
    model: str,
    prompt: str,
    input_type: InputType,
    input_data: str,
) -> ModelCallResult:
    """
    input_data:
      - text: the bug description
      - video: absolute path to video file
    """
    t0 = time.time()

    # Build multimodal content
    contents = []
    # Put prompt as first instruction
    contents.append(prompt)

    if input_type == "text":
        contents.append(f"输入内容（文本）：\n{input_data}")
    elif input_type == "video":
        video_path = Path(input_data)
        if not video_path.exists():
            raise RuntimeError(f"Video not found: {video_path}")
        uploaded = client.files.upload(file=str(video_path))
        uploaded = wait_until_file_active(client, file_name=uploaded.name, timeout_s=90, poll_s=1.0)
        contents.append(uploaded)
        contents.append("输入内容（视频）：请根据视频内容完成上述要求。")
    else:
        raise RuntimeError(f"Unsupported input_type: {input_type}")

    resp = client.models.generate_content(model=model, contents=contents)
    raw = (resp.text or "").strip()

    latency_ms = int((time.time() - t0) * 1000)
    return ModelCallResult(raw_text=raw, latency_ms=latency_ms)


# =========================
# Dataset loading
# =========================
def load_dataset_items(dataset_version: str) -> List[Dict[str, Any]]:
    ds_dir = DATASETS_DIR / dataset_version
    path = ds_dir / "bugs.jsonl"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Dataset not found: {dataset_version}")

    items: List[Dict[str, Any]] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=500, detail=f"Invalid JSONL at line {line_no}: {e}")
        # normalize video path to absolute if needed
        if obj.get("input_type") == "video":
            vp = obj.get("video_path")
            if not vp:
                raise HTTPException(status_code=500, detail=f"Missing video_path for item {obj.get('id')}")
            # Treat as path relative to BASE_DIR
            abs_path = (BASE_DIR / vp).resolve()
            obj["_video_abs_path"] = str(abs_path)
        items.append(obj)

    return items


# =========================
# Parsing / Validation / Eval
# =========================
def parse_ticket_json(raw_text: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Return (parsed_json, error_message)
    """
    text = _strip_code_fences(raw_text)
    if not text:
        return None, "empty_output"
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        return None, f"json_parse_error:{e}"
    if not isinstance(data, dict):
        return None, "json_not_object"
    return data, None


def validate_ticket_schema(ticket: Dict[str, Any], rules: Dict[str, Any]) -> List[str]:
    errors: List[str] = []

    schema = rules.get("schema", {})
    required_keys = schema.get("required", [])
    env_required = schema.get("environment_required_keys", [])
    allowed_sev = set([s.lower() for s in schema.get("severity_allowed", ["low","medium","high","critical"])])

    for k in required_keys:
        if k not in ticket:
            errors.append(f"missing:{k}")

    # minimal type checks
    if "steps" in ticket and not isinstance(ticket["steps"], list):
        errors.append("type:steps_not_list")
    if "tags" in ticket and not isinstance(ticket["tags"], list):
        errors.append("type:tags_not_list")
    if "confidence" in ticket and not isinstance(ticket["confidence"], (int, float)):
        errors.append("type:confidence_not_number")

    if "environment" in ticket:
        env = ticket["environment"]
        if not isinstance(env, dict):
            errors.append("type:environment_not_object")
        else:
            for ek in env_required:
                if ek not in env:
                    errors.append(f"missing:environment.{ek}")

    if "severity" in ticket:
        sev = str(ticket["severity"]).lower()
        if sev not in allowed_sev:
            errors.append("value:severity_invalid")

    return errors



def steps_compliance(ticket: Dict[str, Any], rules: Dict[str, Any]) -> bool:
    steps_rule = rules.get("steps", {})
    min_steps = int(steps_rule.get("min_steps", 3))
    require_non_empty = bool(steps_rule.get("require_non_empty", True))

    steps = ticket.get("steps")
    if not isinstance(steps, list):
        return False

    if require_non_empty:
        steps = [s for s in steps if isinstance(s, str) and s.strip()]
    else:
        steps = [s for s in steps if isinstance(s, str)]

    return len(steps) >= min_steps



def severity_rule_score(input_text_hint: str, ticket: Dict[str, Any], gold: Dict[str, Any], rules: Dict[str, Any]) -> float:
    sev_conf = rules.get("severity", {})
    mode = sev_conf.get("mode", "exact")  # exact | gold_min
    order = [s.lower() for s in sev_conf.get("order", ["low","medium","high","critical"])]
    kw_map = {k.lower(): v.lower() for k, v in (sev_conf.get("keyword_min_severity", {}) or {}).items()}

    sev = str(ticket.get("severity", "")).lower().strip()
    if sev not in order:
        return 0.0

    gold = gold or {}
    gold_sev = str(gold.get("severity", "")).lower().strip()
    gold_min = str(gold.get("severity_min", "")).lower().strip()

    # 1) gold-based
    if mode == "exact" and gold_sev in order:
        return 1.0 if sev == gold_sev else 0.0

    if mode == "gold_min" and gold_min in order:
        return 1.0 if severity_ge(sev, gold_min, order) else 0.0

    # 2) keyword heuristics
    text = (input_text_hint or "").lower()
    matched_min: Optional[str] = None
    for kw, min_sev in kw_map.items():
        if kw in text:
            matched_min = min_sev
            # choose the strictest (highest) min severity if multiple match
            if matched_min in order:
                # TODO:
                # keep the max requirement
                # compare by index
                # (higher severity => larger index)
                pass

    if matched_min and matched_min in order:
        return 1.0 if severity_ge(sev, matched_min, order) else 0.0

    # unknown -> neutral
    return 0.5



def compute_metrics(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    n = len(records)
    if n == 0:
        return {}

    # overall
    parse_ok = sum(1 for r in records if r.get("parse_error") is None)
    schema_ok = sum(1 for r in records if r.get("parse_error") is None and len(r.get("schema_errors", [])) == 0)
    steps_ok = sum(1 for r in records if r.get("parse_error") is None and r.get("steps_ok") is True)

    latencies = [r["latency_ms"] for r in records if isinstance(r.get("latency_ms"), int)]
    avg_latency = int(sum(latencies) / len(latencies)) if latencies else None

    sev_scores = [r["severity_score"] for r in records if isinstance(r.get("severity_score"), (int, float))]
    avg_sev_score = round(sum(sev_scores) / len(sev_scores), 4) if sev_scores else None

    inference_errors = sum(1 for r in records if (r.get("failure_type") == "inference_error"))

    overall = {
        "num_samples": n,
        "num_inference_error": inference_errors,
        "json_parse_rate": round(parse_ok / n, 4),
        "schema_complete_rate": round(schema_ok / n, 4),
        "steps_compliance_rate": round(steps_ok / n, 4),
        "avg_severity_rule_score": avg_sev_score,
        "avg_latency_ms": avg_latency,
    }

    # quality-only (exclude inference_error)
    q = [r for r in records if r.get("failure_type") != "inference_error"]
    qn = len(q)
    if qn == 0:
        quality = {
            "num_quality_samples": 0,
            "json_parse_rate": None,
            "schema_complete_rate": None,
            "steps_compliance_rate": None,
            "avg_severity_rule_score": None,
            "avg_latency_ms": None,
        }
    else:
        q_parse_ok = sum(1 for r in q if r.get("parse_error") is None)
        q_schema_ok = sum(1 for r in q if r.get("parse_error") is None and len(r.get("schema_errors", [])) == 0)
        q_steps_ok = sum(1 for r in q if r.get("parse_error") is None and r.get("steps_ok") is True)
        q_lat = [r["latency_ms"] for r in q if isinstance(r.get("latency_ms"), int)]
        q_avg_latency = int(sum(q_lat) / len(q_lat)) if q_lat else None
        q_sev = [r["severity_score"] for r in q if isinstance(r.get("severity_score"), (int, float))]
        q_avg_sev = round(sum(q_sev) / len(q_sev), 4) if q_sev else None

        quality = {
            "num_quality_samples": qn,
            "json_parse_rate": round(q_parse_ok / qn, 4),
            "schema_complete_rate": round(q_schema_ok / qn, 4),
            "steps_compliance_rate": round(q_steps_ok / qn, 4),
            "avg_severity_rule_score": q_avg_sev,
            "avg_latency_ms": q_avg_latency,
        }

    return {"overall": overall, "quality_only": quality}


def classify_failure(parse_error: Optional[str], schema_errors: List[str], steps_ok: bool) -> Optional[str]:
    if parse_error:
        return "parse_error"
    if schema_errors:
        return "schema_error"
    if not steps_ok:
        return "steps_noncompliant"
    return None

def load_default_rules() -> Dict[str, Any]:
    if not DEFAULT_RULES_PATH.exists():
        raise RuntimeError(f"Missing rules file: {DEFAULT_RULES_PATH}")
    return json.loads(DEFAULT_RULES_PATH.read_text(encoding="utf-8"))

def severity_ge(sev_a: str, sev_b: str, order: List[str]) -> bool:
    # returns True if sev_a >= sev_b
    try:
        ia = order.index(sev_a)
        ib = order.index(sev_b)
        return ia >= ib
    except ValueError:
        return False


# =========================
# Registry endpoints
# =========================
@app.get("/v1/registry/datasets")
def api_list_datasets():
    return {"datasets": list_dataset_versions()}


@app.get("/v1/registry/prompts")
def api_list_prompts():
    return {"prompts": list_prompt_names()}


@app.get("/v1/registry/models")
def api_list_models():
    return {"models": list_models()}


# =========================
# Runs (batch evaluation)
# =========================
def create_run_id() -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{ts}_run"


@app.post("/v1/runs", response_model=RunSummary)
def create_run(req: RunRequest):
    # Validate registry
    if req.dataset_version not in list_dataset_versions():
        raise HTTPException(status_code=404, detail=f"Unknown dataset_version: {req.dataset_version}")
    if req.prompt_name not in list_prompt_names():
        raise HTTPException(status_code=404, detail=f"Unknown prompt_name: {req.prompt_name}")

    run_id = create_run_id()
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    rules = load_default_rules()
    (run_dir / "rules.json").write_text(json.dumps(rules, ensure_ascii=False, indent=2), encoding="utf-8")

    config = req.model_dump()
    (run_dir / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

    prompt = load_prompt(req.prompt_name)
    items = load_dataset_items(req.dataset_version)


    # filter by input_types if provided
    if req.input_types:
        items = [it for it in items if it.get("input_type") in set(req.input_types)]

    items = items[: req.max_samples]

    client = get_client()

    records: List[Dict[str, Any]] = []
    failures: List[Dict[str, Any]] = []

    for it in items:
        sample_id = it.get("id")
        input_type: InputType = it.get("input_type")
        gold = it.get("gold") or {}
        meta = it.get("meta") or {}

        # Build input_data
        if input_type == "text":
            input_data = it.get("input", "")
            input_hint = input_data
        elif input_type == "video":
            input_data = it.get("_video_abs_path", "")
            input_hint = it.get("input", "")  # hint prompt text
        else:
            # skip unknown type
            continue

        try:
            call = gemini_generate(
                client=client,
                model=req.model,
                prompt=prompt,
                input_type=input_type,
                input_data=input_data,
            )
            raw_text = call.raw_text
            latency_ms = call.latency_ms
        except Exception as e:
            # Treat as inference failure
            rec = {
                "id": sample_id,
                "input_type": input_type,
                "meta": meta,
                "gold": gold,
                "raw_text": "",
                "latency_ms": None,
                "parse_error": f"inference_error:{str(e)}",
                "schema_errors": [],
                "steps_ok": False,
                "severity_score": 0.0,
                "failure_type": "inference_error",
            }
            records.append(rec)
            failures.append({**rec, "input_preview": it.get("input", "")[:300]})
            continue

        parsed, parse_err = parse_ticket_json(raw_text)
        schema_errors: List[str] = []
        steps_ok = False
        sev_score = 0.0

        if parse_err is None and parsed is not None:
            schema_errors = validate_ticket_schema(parsed, rules)
            steps_ok = steps_compliance(parsed, rules)
            sev_score = severity_rule_score(input_hint, parsed, gold, rules)

        failure_type = classify_failure(parse_err, schema_errors, steps_ok)

        rec = {
            "id": sample_id,
            "input_type": input_type,
            "meta": meta,
            "gold": gold,
            "raw_text": raw_text,
            "parsed": parsed,
            "latency_ms": latency_ms,
            "parse_error": parse_err,
            "schema_errors": schema_errors,
            "steps_ok": steps_ok,
            "severity_score": sev_score,
            "failure_type": failure_type,
        }
        records.append(rec)

        if failure_type:
            failures.append(
                {
                    "id": sample_id,
                    "input_type": input_type,
                    "failure_type": failure_type,
                    "parse_error": parse_err,
                    "schema_errors": schema_errors,
                    "steps_ok": steps_ok,
                    "latency_ms": latency_ms,
                    "input_preview": (it.get("input", "") or "")[:500],
                    "raw_preview": raw_text[:800],
                }
            )

        # Write raw outputs incrementally (safer for long runs)
        with (run_dir / "raw_outputs.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"id": sample_id, "raw_text": raw_text}, ensure_ascii=False) + "\n")

        with (run_dir / "parsed_outputs.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"id": sample_id, "parsed": parsed, "parse_error": parse_err}, ensure_ascii=False) + "\n")

    metrics = compute_metrics(records)

    (run_dir / "eval.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    (run_dir / "failures.json").write_text(json.dumps(failures, ensure_ascii=False, indent=2), encoding="utf-8")

    from collections import Counter

    def build_eval_summary(records: List[Dict[str, Any]]) -> Dict[str, Any]:
        failure_counts = Counter([(r.get("failure_type") or "ok") for r in records])
        schema_errs = Counter()
        parse_errs = Counter()

        for r in records:
            pe = r.get("parse_error")
            if pe:
                # coarse type: json_parse_error / inference_error / json_not_object / empty_output ...
                parse_errs[pe.split(":")[0]] += 1
            for se in r.get("schema_errors", []):
                schema_errs[se] += 1

        return {
            "failure_type_counts": dict(failure_counts),
            "top_schema_errors": schema_errs.most_common(10),
            "top_parse_error_types": parse_errs.most_common(10)
        }

    summary = build_eval_summary(records)
    (run_dir / "eval_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    return RunSummary(
        run_id=run_id,
        status="completed",
        config=config,
        metrics=metrics,
    )






@app.get("/v1/runs/{run_id}", response_model=RunSummary)
def get_run(run_id: str):
    run_dir = RUNS_DIR / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")

    config_path = run_dir / "config.json"
    eval_path = run_dir / "eval.json"

    config = json.loads(config_path.read_text(encoding="utf-8")) if config_path.exists() else {}
    metrics = json.loads(eval_path.read_text(encoding="utf-8")) if eval_path.exists() else {}

    return RunSummary(run_id=run_id, status="completed", config=config, metrics=metrics)


@app.get("/v1/runs/{run_id}/failures")
def get_failures(run_id: str, failure_type: Optional[str] = None):
    run_dir = RUNS_DIR / run_id
    path = run_dir / "failures.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="failures.json not found")
    data = json.loads(path.read_text(encoding="utf-8"))
    if failure_type:
        data = [x for x in data if x.get("failure_type") == failure_type]
    return {"run_id": run_id, "failures": data}


# =========================
# Legacy: single upload analyze (kept for your current UI)
# =========================
@app.post("/api/analyze")
async def analyze(video: UploadFile = File(...), prompt_name: str = "ticket_v1_schema"):
    """
    Keep your original UX: upload one video, get one JSON output.
    This now reuses the prompt registry + unified parsing.
    """
    suffix = validate_video_upload(video)

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        tmp_path = f.name
        f.write(await video.read())

    try:
        client = get_client()
        model = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")

        prompt = load_prompt(prompt_name)

        call = gemini_generate(
            client=client,
            model=model,
            prompt=prompt,
            input_type="video",
            input_data=tmp_path,
        )

        raw_text = call.raw_text
        parsed, parse_err = parse_ticket_json(raw_text)
        if parse_err is not None or parsed is None:
            raise HTTPException(status_code=500, detail=f"Model output invalid JSON: {parse_err}. Preview: {raw_text[:500]}")

        schema_errors = validate_ticket_schema(parsed)
        return JSONResponse(
            content={
                "ticket": parsed,
                "schema_errors": schema_errors,
                "latency_ms": call.latency_ms,
                "raw_preview": raw_text[:800],
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass