#!/usr/bin/env python3
"""
MatdataPortal OpenRouter AI Fallback Module
========================================
Called ONLY when a voter card has missing or garbled data:
- Missing Father / Relative name ('पिता/पति का नाम नहीं आ रहा')
- Missing or invalid Voter Name
- Questionable or missing House Number

Zero-cost architecture: uses OpenRouter free routing pool with automatic fallback.
If all fields are already cleanly extracted by local engine, this module is NEVER called.
"""

import os
import re
import json
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, List

# Load API key from env or .env file
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
if not OPENROUTER_API_KEY:
    env_path = os.path.join(os.path.dirname(__file__), "../.env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("OPENROUTER_API_KEY="):
                    OPENROUTER_API_KEY = line.split("=", 1)[1].strip().strip('"\'')
                    break

OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

# Prioritized list of robust free models on OpenRouter (max 3 allowed by API)
CANDIDATE_FREE_MODELS = [
    "openrouter/free",
    "liquid/lfm-2.5-2.6b:free",
    "google/gemma-4-26b-a4b-it:free"
]


def needs_ai_repair(record: Dict[str, Any]) -> bool:
    """
    Strict filter: ONLY invoke AI if critical voter data is missing or corrupted.
    Returns False when local parser extracted clean data.
    """
    if not record:
        return True

    name = str(record.get("nameHi") or record.get("name") or "").strip()
    rel_name = str(record.get("relativeNameHi") or record.get("relativeName") or "").strip()

    # 1. Critical: Missing or 1-letter Voter name
    if not name or len(name) < 2:
        return True

    # 2. Critical: Missing Father/Husband relative name
    if not rel_name or len(rel_name) < 2 or rel_name in ["-", "—", "nil", "na"]:
        return True

    return False


def _call_openrouter_api(prompt: str, timeout: int = 15) -> Optional[str]:
    """Makes a secure POST request to OpenRouter API with Candidate Fallback Models"""
    if not OPENROUTER_API_KEY:
        return None

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://matdataportal.app",
        "X-Title": "MatdataPortal Electoral Roll AI Resolver"
    }

    # OpenRouter supports specifying an array of models
    payload = {
        "models": CANDIDATE_FREE_MODELS,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are an expert Indian Electoral Roll (मतदाता सूची) OCR text parser. "
                    "Extract structured voter information accurately in Hindi Devanagari script. "
                    "Always output VALID JSON only. No markdown formatting, no explanations."
                )
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.1
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(OPENROUTER_ENDPOINT, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
            choices = result.get("choices", [])
            if choices:
                return choices[0].get("message", {}).get("content", "")
    except Exception as e:
        # Gracefully handle network / quota issues without crashing engine
        pass

    return None


def _extract_json_object(raw_text: str) -> Optional[Dict[str, Any]]:
    """Extracts first valid JSON dictionary from LLM response text"""
    if not raw_text:
        return None
    # 1. Try direct parse
    try:
        return json.loads(raw_text.strip())
    except Exception:
        pass

    # 2. Find outermost { ... }
    m = re.search(r'(\{[\s\S]*\})', raw_text)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass

    return None


def repair_single_voter_card(card_raw_text: str, current_record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Repairs a single tricky voter card using OpenRouter.
    ONLY modifies fields that were missing or empty in current_record.
    """
    if not needs_ai_repair(current_record):
        return current_record

    prompt = (
        "Extract the voter details from this raw Indian voter roll card text.\n"
        f"Raw Text:\n\"\"\"{card_raw_text.strip()}\"\"\"\n\n"
        "Output JSON format strictly with these keys:\n"
        "{\n"
        "  \"name\": \"मतदाता का पूरा नाम (Hindi Devanagari)\",\n"
        "  \"relativeName\": \"पिता या पति का नाम (Hindi Devanagari, strictly NO prefix like पिता/पति)\",\n"
        "  \"relationType\": \"पिता\" or \"पति\" or \"माता\",\n"
        "  \"houseNo\": \"मकान संख्या (digits only, e.g. '1', '2', '12क', or '-' if unknown)\",\n"
        "  \"age\": 25,\n"
        "  \"gender\": \"पुरुष\" or \"स्त्री\"\n"
        "}"
    )

    resp = _call_openrouter_api(prompt, timeout=12)
    if not resp:
        return current_record

    data = _extract_json_object(resp)
    if not data:
        return current_record

    # Carefully merge ONLY missing or improved fields
    name = (data.get("name") or "").strip()
    rel_name = (data.get("relativeName") or "").strip()
    rel_type = (data.get("relationType") or "").strip()
    house = str(data.get("houseNo") or "").strip()
    age = data.get("age")
    gender = (data.get("gender") or "").strip()

    # Clean up any residual noise from relative name
    rel_name = re.sub(r'^(?:पिता|पति|माता|वालिद|आत्मज|सुपुत्र|पत्नी|सुपुत्री|नातेदार)[:\s\-]*', '', rel_name).strip()

    if (not current_record.get("nameHi") or len(current_record["nameHi"]) < 2) and len(name) >= 2:
        current_record["nameHi"] = name

    if (not current_record.get("relativeNameHi") or len(current_record["relativeNameHi"]) < 2) and len(rel_name) >= 2:
        current_record["relativeNameHi"] = rel_name

    if rel_type in ["पिता", "पति", "माता"]:
        current_record["relationType"] = rel_type

    if (not current_record.get("houseNo") or current_record["houseNo"] in ["-", ""]) and house and house != "-":
        # Ensure house conforms to our strict rules (no English, only allowed devanagari suffixes)
        from pdf_to_excel import clean_house_no
        current_record["houseNo"] = clean_house_no(house)

    if (not current_record.get("age") or current_record["age"] < 18) and isinstance(age, int) and 18 <= age <= 125:
        current_record["age"] = age

    if gender in ["पुरुष", "स्त्री"]:
        current_record["gender"] = gender

    return current_record


def repair_batch_voters(unresolved_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Repairs a batch of unresolved cards in a single prompt for ultra-high throughput.
    """
    if not unresolved_items or not OPENROUTER_API_KEY:
        return unresolved_items

    # Filter to only items that actually need repair
    needy_indices = [i for i, item in enumerate(unresolved_items) if needs_ai_repair(item.get("record", {}))]
    if not needy_indices:
        return unresolved_items

    # Build batch prompt
    batch_text = []
    for idx in needy_indices:
        raw = unresolved_items[idx].get("rawText", "")
        sl = unresolved_items[idx].get("record", {}).get("serialNo", idx + 1)
        batch_text.append(f"CARD #{sl}:\n{raw}\n---")

    prompt = (
        "Extract the voter details for each card below. Return a JSON array of objects.\n"
        "[\n"
        "  {\n"
        "    \"serialNo\": 1,\n"
        "    \"name\": \"मतदाता नाम\",\n"
        "    \"relativeName\": \"पिता/पति का नाम\",\n"
        "    \"relationType\": \"पिता\" | \"पति\" | \"माता\",\n"
        "    \"houseNo\": \"मकान सं\",\n"
        "    \"age\": 30,\n"
        "    \"gender\": \"पुरुष\" | \"स्त्री\"\n"
        "  }\n"
        "]\n\n"
        "CARDS TO EXTRACT:\n"
        + "\n".join(batch_text)
    )

    resp = _call_openrouter_api(prompt, timeout=20)
    if not resp:
        return unresolved_items

    parsed_list = None
    try:
        parsed_list = json.loads(resp.strip())
    except Exception:
        m = re.search(r'(\[[\s\S]*\])', resp)
        if m:
            try:
                parsed_list = json.loads(m.group(1))
            except Exception:
                pass

    if isinstance(parsed_list, list):
        parsed_by_sl = {item.get("serialNo"): item for item in parsed_list if isinstance(item, dict)}
        for idx in needy_indices:
            rec = unresolved_items[idx].get("record", {})
            sl = rec.get("serialNo", idx + 1)
            ai_data = parsed_by_sl.get(sl)
            if ai_data:
                rel_name = (ai_data.get("relativeName") or "").strip()
                rel_name = re.sub(r'^(?:पिता|पति|माता|वालिद|आत्मज|सुपुत्र|पत्नी|सुपुत्री|नातेदार)[:\s\-]*', '', rel_name).strip()
                name = (ai_data.get("name") or "").strip()
                
                if (not rec.get("nameHi") or len(rec["nameHi"]) < 2) and len(name) >= 2:
                    rec["nameHi"] = name
                if (not rec.get("relativeNameHi") or len(rec["relativeNameHi"]) < 2) and len(rel_name) >= 2:
                    rec["relativeNameHi"] = rel_name
                if ai_data.get("relationType") in ["पिता", "पति", "माता"]:
                    rec["relationType"] = ai_data["relationType"]

    return unresolved_items
