#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Devanagari Sandhi Viched & Compound Word Splitter (संधि विच्छेद एवं पद विग्रह इंजन)
Utilizes AI4Bharat's Indic NLP Library for Canonical Devanagari Script Normalization
and applies Indian Electoral Compound Word Splitting rules.
"""

import re
import unicodedata

try:
    from indicnlp.normalize.indic_normalize import DevanagariNormalizer
    _normalizer = DevanagariNormalizer()
except Exception:
    _normalizer = None

# Key titles, honorifics, gender markers, and community surnames for Sandhi Viched
COMPOUND_TITLES = [
    # Females
    'देवी', 'कंवर', 'बाई', 'कुमारी', 'बेगम', 'बानू', 'बानो', 'खातून',
    # Males
    'सिंह', 'प्रसाद', 'कुमार',
    # Community & Surnames
    'जैन', 'शर्मा', 'माली', 'मेघवाल', 'सुथार', 'जाट', 'गुर्जर',
    'सोलंकी', 'पंवार', 'राठौड़', 'चौधरी', 'मोहम्मद', 'अंसारी',
    'बिश्नोई', 'यादव', 'अहीर', 'दर्जी', 'सोनी', 'लोहार', 'घांची',
    'कुमावत', 'गोदारा', 'बेनीवाल', 'पूनिया', 'झा', 'मिश्रा', 'पाण्डेय'
]

# Non-greedy pattern matching name stem (>= 2 chars) followed by title
_TITLE_PAT = re.compile(
    r'([\u0900-\u097F]{2,}?)(' + '|'.join(COMPOUND_TITLES) + r')(?=[^\u0900-\u097F]|$)'
)

def normalize_indic(text: str) -> str:
    """Canonical Unicode & Indic NLP Normalization."""
    if not text:
        return ""
    if _normalizer:
        try:
            text = _normalizer.normalize(text)
        except Exception:
            pass
    return unicodedata.normalize('NFC', text)

def sandhi_viched(name: str) -> str:
    """
    Performs Sandhi Viched on Devanagari electoral names:
    - Normalizes script via Indic NLP
    - Splits glued titles, suffixes, and surnames (e.g. पप्पूदेवी -> पप्पू देवी, चिरागजैन -> चिराग जैन)
    - Normalizes whitespace
    """
    if not name:
        return ""
    
    clean = normalize_indic(name.strip())
    
    # 1. Apply Compound Title & Surname Sandhi Splitting
    clean = _TITLE_PAT.sub(r'\1 \2', clean)
    
    # 2. Collapse redundant spaces
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean

if __name__ == '__main__':
    samples = [
        'पप्पूदेवी', 'कंकूकंवर', 'डूंगरसिंह', 'सुनीताकुमारी', 'शान्तीबाई',
        'दुर्गाप्रसाद', 'सुरेशकुमार', 'चिरागजैन', 'हसमुखजैन', 'ओमप्रकाशशर्मा',
        'सफीमोहम्मद', 'कमलादेवी सोलंकी'
    ]
    for s in samples:
        print(f"{s} -> {sandhi_viched(s)}")
