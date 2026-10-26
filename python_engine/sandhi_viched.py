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
    'सिंह', 'प्रसाद', 'कुमार', 'लाल', 'चन्द', 'चंद', 'राम', 'प्रकाश', 'भान', 'दत्त',
    # Community & Surnames
    'जैन', 'शर्मा', 'माली', 'मेघवाल', 'सुथार', 'जाट', 'गुर्जर',
    'सोलंकी', 'पंवार', 'राठौड़', 'चौधरी', 'मोहम्मद', 'अंसारी',
    'बिश्नोई', 'यादव', 'अहीर', 'दर्जी', 'सोनी', 'लोहार', 'घांची',
    'कुमावत', 'गोदारा', 'बेनीवाल', 'पूनिया', 'झा', 'मिश्रा', 'पाण्डेय',
    'अग्रवाल', 'खण्डेलवाल', 'वर्मा', 'गौतम', 'तिवारी', 'जोशी', 'व्यास',
    'दवे', 'भट्ट', 'पंडित', 'पटेल', 'राव', 'दीवान', 'राणा', 'शेखावत'
]

# Non-greedy pattern matching name stem (>= 2 chars) followed by title
_TITLE_PAT = re.compile(
    r'([\u0900-\u097F]{2,}?)(' + '|'.join(COMPOUND_TITLES) + r')(?=[^\u0900-\u097F]|$)'
)

def fix_devanagari_matras(text: str) -> str:
    """
    Fixes common Devanagari OCR glyph and matra placement glitches:
    - Normalizes nukta/half-forms
    - Fixes duplicated matras (e.g. ू + ू, ी + ी)
    - Fixes anusvara/visarga order relative to vowel signs
    - Fixes broken conjuncts and trailing virama
    """
    if not text:
        return ""
    
    # 1. Normalize duplicate matras (e.g. ुु -> ु, ीी -> ी)
    text = re.sub(r'[\u093E]{2,}', '\u093E', text) # ा
    text = re.sub(r'[\u093F]{2,}', '\u093F', text) # ि
    text = re.sub(r'[\u0940]{2,}', '\u0940', text) # ी
    text = re.sub(r'[\u0941]{2,}', '\u0941', text) # ु
    text = re.sub(r'[\u0942]{2,}', '\u0942', text) # ू
    text = re.sub(r'[\u0947]{2,}', '\u0947', text) # े
    text = re.sub(r'[\u0948]{2,}', '\u0948', text) # ै
    text = re.sub(r'[\u094B]{2,}', '\u094B', text) # ो
    text = re.sub(r'[\u094C]{2,}', '\u094C', text) # ौ
    text = re.sub(r'[\u0902]{2,}', '\u0902', text) # ं
    
    # 2. Fix inverted matra + anusvara order (anusvara should follow vowel sign)
    text = re.sub(r'(\u0902)([\u093E-\u094C])', r'\2\1', text)
    
    # 3. Remove standalone illegal virama at end of word
    text = re.sub(r'\u094D(?=\s|$)', '', text)
    
    # 4. Normalize common OCR glyph splits
    text = text.replace('िह', 'हि') # misplaced i-matra
    
    return text

def normalize_indic(text: str) -> str:
    """Canonical Unicode & Indic NLP Normalization."""
    if not text:
        return ""
    if _normalizer:
        try:
            text = _normalizer.normalize(text)
        except Exception:
            pass
    text = unicodedata.normalize('NFC', text)
    return fix_devanagari_matras(text)

def sandhi_viched(name: str) -> str:
    """
    Performs Sandhi Viched on Devanagari electoral names:
    - Normalizes script via Indic NLP & matra fixer
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
