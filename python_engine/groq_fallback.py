#!/usr/bin/env python3
"""
MatdataPortal Groq High-Speed AI Fallback Module
=============================================
Called ONLY when a voter card has missing or garbled data:
- Missing Father / Relative name ('पिता/पति का नाम नहीं आ रहा')
- Missing or invalid Voter Name (or mistakenly extracted city name like 'ओसियाँ')
- Questionable or missing House Number ('-', "'-", '0')

Powered by Groq's high-throughput endpoint: openai/gpt-oss-120b & qwen/qwen3.8-27b
"""

import os
import re
import json
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, List

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
if not GROQ_API_KEY:
    env_path = os.path.join(os.path.dirname(__file__), "../.env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("GROQ_API_KEY="):
                    GROQ_API_KEY = line.split("=", 1)[1].strip().strip('"\'')
                    break

GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b"
]

ADMIN_WORDS = [
    'ओसियाँ', 'विधानसभा', 'निर्वाचक', 'नामावली', 'ग्रामपंचायत', 'पंचायत', 'समिति', 'राजस्थान', 'आयोग', 'वार्ड', 'भाग'
]


def needs_ai_repair(record: Dict[str, Any]) -> bool:
    if not record:
        return True

    name = str(record.get("nameHi") or record.get("name") or "").strip()
    rel_name = str(record.get("relativeNameHi") or record.get("relativeName") or "").strip()

    # Reject administrative or city names mistakenly captured as voter names
    if any(w in name for w in ADMIN_WORDS) or any(w in rel_name for w in ADMIN_WORDS):
        return True

    # Missing or too short names
    if not name or len(name) < 2:
        return True

    if not rel_name or len(rel_name) < 2 or rel_name in ["-", "—", "nil", "na", "null"]:
        return True

    # Detect OCR noise, symbols, numbers or Latin characters in names
    if re.search(r'[|«»<>\\/_~`!@#$%^&*()_+=\[\]{}0-9A-Za-z]', name + rel_name):
        return True

    # Detect label bleed (e.g. 'का नाम', 'कर नरम', 'नपतर', 'पिता', 'पति')
    if any(k in name for k in ['का नाम', 'कर नरम', 'नपतर', 'पिता', 'पति', 'माता']):
        return True
    if any(k in rel_name for k in ['का नाम', 'कर नरम', 'नपतर']):
        return True

    return False


GROQ_CIRCUIT_BREAKER = False


def _call_groq_api(prompt: str, timeout: int = 8) -> Optional[str]:
    global GROQ_CIRCUIT_BREAKER
    if not GROQ_API_KEY or GROQ_CIRCUIT_BREAKER:
        return None

    for model in GROQ_MODELS:
        if GROQ_CIRCUIT_BREAKER:
            return None

        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)"
        }

        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are an expert Indian Electoral Roll (मतदाता सूची) text parser. "
                        "Extract structured voter information accurately in Hindi Devanagari script. "
                        "Always output VALID JSON only. No markdown formatting."
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
            req = urllib.request.Request(GROQ_ENDPOINT, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as response:
                result = json.loads(response.read().decode("utf-8"))
                choices = result.get("choices", [])
                if choices:
                    return choices[0].get("message", {}).get("content", "")
        except urllib.error.HTTPError as e:
            if e.code in (429, 402):
                print(f"⚠️ [GroqFallback] Groq HTTP {e.code} (Rate Limit/Quota). Circuit breaker tripped; proceeding with native engine.")
                GROQ_CIRCUIT_BREAKER = True
                return None
            continue
        except Exception:
            continue

    return None


def _extract_json_object(raw_text: str) -> Optional[Dict[str, Any]]:
    if not raw_text:
        return None
    try:
        return json.loads(raw_text.strip())
    except Exception:
        pass
    m = re.search(r'(\{[\s\S]*\})', raw_text)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return None


def repair_single_voter_card(card_raw_text: str, current_record: Dict[str, Any]) -> Dict[str, Any]:
    if not needs_ai_repair(current_record):
        return current_record

    prompt = (
        f"Extract voter details from this electoral card text in pure Hindi Devanagari JSON.\n"
        f"Card text: {card_raw_text}\n"
        f"Current raw record: {json.dumps(current_record, ensure_ascii=False)}\n\n"
        f"Rules:\n"
        f"1. Do NOT use town/area names like 'ओसियाँ' or 'विधानसभा' as voter's personal name.\n"
        f"2. In Rajasthan SEC rolls: 'र' stands for 'ा' (aa matra) like 'धनररज' -> 'धनराज', 'हलररलरल' -> 'हीरालाल'.\n"
        f"3. Return JSON:\n"
        f'{{"name": "...", "relativeName": "...", "relationType": "पिता"|"पति"|"माता", "houseNo": "...", "age": 30, "gender": "पुरुष"|"स्त्री"}}\n'
    )

    resp = _call_groq_api(prompt, timeout=8)
    data = _extract_json_object(resp)
    if not data:
        return current_record

    name = (data.get("name") or "").strip()
    rel_name = (data.get("relativeName") or "").strip()
    rel_type = (data.get("relationType") or "").strip()
    house = str(data.get("houseNo") or "").strip().replace("'", "").replace('"', "")
    age = data.get("age")
    gender = (data.get("gender") or "").strip()

    rel_name = re.sub(r'^(?:पिता|पति|माता|वालिद|आत्मज|सुपुत्र|पत्नी)[:\s\-]*', '', rel_name).strip()

    cur_name = str(current_record.get("nameHi") or current_record.get("name") or "").strip()
    cur_rel = str(current_record.get("relativeNameHi") or current_record.get("relativeName") or "").strip()

    should_update_name = (
        not cur_name
        or len(cur_name) < 2
        or any(w in cur_name for w in ADMIN_WORDS)
        or bool(re.search(r'[|«»<>\\/_~`!@#$%^&*()_+=\[\]{}0-9A-Za-z]', cur_name))
        or any(k in cur_name for k in ['का नाम', 'कर नरम', 'नपतर', 'पिता', 'पति', 'माता'])
    )
    if should_update_name and name and not any(w in name for w in ADMIN_WORDS):
        current_record["name"] = name
        current_record["nameHi"] = name

    should_update_rel = (
        not cur_rel
        or len(cur_rel) < 2
        or cur_rel in ["-", "—", "nil", "na", "null"]
        or any(w in cur_rel for w in ADMIN_WORDS)
        or bool(re.search(r'[|«»<>\\/_~`!@#$%^&*()_+=\[\]{}0-9A-Za-z]', cur_rel))
        or any(k in cur_rel for k in ['का नाम', 'कर नरम', 'नपतर'])
    )
    if should_update_rel and rel_name and not any(w in rel_name for w in ADMIN_WORDS):
        current_record["relativeName"] = rel_name
        current_record["relativeNameHi"] = rel_name

    if rel_type in ["पिता", "पति", "माता"]:
        current_record["relationType"] = rel_type

    if (not current_record.get("houseNo") or current_record["houseNo"] in ["-", "'-", "0", ""]):
        if house and house not in ["0", "-", ""]:
            current_record["houseNo"] = house

    if (not current_record.get("age") or current_record["age"] < 18) and isinstance(age, (int, float)) and 18 <= int(age) <= 125:
        current_record["age"] = int(age)

    if gender in ["पुरुष", "स्त्री"]:
        current_record["gender"] = gender

    return current_record


def repair_batch_voters(unresolved_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not unresolved_items or not GROQ_API_KEY:
        return unresolved_items

    needy_indices = [i for i, item in enumerate(unresolved_items) if needs_ai_repair(item.get("record", {}))]
    if not needy_indices:
        return unresolved_items

    batch_text = []
    for idx in needy_indices:
        raw = unresolved_items[idx].get("rawText", "")
        sl = unresolved_items[idx].get("record", {}).get("serialNo", idx + 1)
        batch_text.append(f"CARD #{sl}:\n{raw}\n---")

    prompt = (
        "Extract voter details for each card below in pure Hindi Devanagari JSON array.\n"
        "Important: In Rajasthan SEC rolls, 'र' represents 'ा' (aa matra) (e.g. 'धनररज' -> 'धनराज', 'हलररलरल' -> 'हीरालाल').\n"
        "Never use area/town names like 'ओसियाँ' as a person's name.\n"
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
        "CARDS:\n"
        + "\n".join(batch_text)
    )

    resp = _call_groq_api(prompt, timeout=12)
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
                rel_name = re.sub(r'^(?:पिता|पति|माता|वालिद|आत्मज|सुपुत्र|पत्नी)[:\s\-]*', '', rel_name).strip()
                name = (ai_data.get("name") or "").strip()
                house = str(ai_data.get("houseNo") or "").strip().replace("'", "").replace('"', "")

                cur_name = rec.get("nameHi") or ""
                if (not cur_name or len(cur_name) < 2 or any(w in cur_name for w in ADMIN_WORDS)) and name and not any(w in name for w in ADMIN_WORDS):
                    rec["nameHi"] = name

                if (not rec.get("relativeNameHi") or len(rec["relativeNameHi"]) < 2) and len(rel_name) >= 2:
                    rec["relativeNameHi"] = rel_name

                if (not rec.get("houseNo") or rec["houseNo"] in ["-", "'-", "0"]) and house and house not in ["0", "-"]:
                    rec["houseNo"] = house

                age = ai_data.get("age")
                if (not rec.get("age") or rec["age"] < 18) and isinstance(age, (int, float)) and 18 <= int(age) <= 125:
                    rec["age"] = int(age)

                if ai_data.get("relationType") in ["पिता", "पति", "माता"]:
                    rec["relationType"] = ai_data["relationType"]
                if ai_data.get("gender") in ["पुरुष", "स्त्री"]:
                    rec["gender"] = ai_data["gender"]

    return unresolved_items
