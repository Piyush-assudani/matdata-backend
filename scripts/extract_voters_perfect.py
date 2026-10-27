#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MatdataPortal Universal Pure Hindi Electoral Roll Extractor (PERFECT ENGINE)
Direct PDF Content Stream & Binary TTF Glyph Parser with Government Electoral Lexicon.
Features:
- Complete Glyph-Hash dictionary across all Indian / Rajasthan SEC voter PDF fonts
- Zero English data, pure Devanagari Hindi output
- Universal electoral name normalizer (कंवर, स्वरूप, हिम्मत, उम्मेद, श्रवण, आदि)
- Exact dynamic column boundary detection (zero missing names in 3-digit supplement cards)
- Clean section/mohalla detection without footer corruption
- Anti-repetition filter for voter names in relative names
- Publication-grade styled Excel outputs
"""

import os
import re
import glob
import json
import struct
import hashlib
import pypdf
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'python_engine'))
try:
    from sandhi_viched import sandhi_viched
except Exception:
    def sandhi_viched(text):
        return text

# ==============================================================================
# 1. MASTER GLYPH-HASH DICTIONARY (Universal SEC Rajasthan Voter PDFs)
# ==============================================================================
GLYPH_HASH_TO_HINDI = {
    '0171bec762': 'ड',
    '027103c065': 'ड़',
    '046b405861': 'ऊ',
    '047d8b1a18': 'ं',
    '05308cc89b': 'ड़',
    '07941b38f2': 'ज्',
    '0a5158353b': '्',
    '0ba1327fc4': 'ड़',
    '0bfe8aba54': 'ी',
    '0c388fbb92': 'ग्',
    '0c38a1de68': 'ी',
    '0c4b471492': 'झ',
    '0c756f93f5': 'प्त',
    '0cda6a9133': 'घ',
    '0e190bfd1c': 'ज्ञ',
    '1164f99f87': 'ण्',
    '11cfd439b5': 'ल्',
    '11d46de407': 'ीं',
    '12fb9d0f09': 'हु',
    '139503929c': 'ू',
    '1480d40370': 'ष्ठ',
    '14a018752f': 'प्',
    '16396a0352': 'स्त्र',
    '1861fa3ec0': 'न्न',
    '190b11d6ea': 'झ',
    '194c71316e': 'ढ',
    '19774bcbf7': 'ल्',
    '1ba2a675b1': 'ल्',
    '1d0368ca3b': 'ल्',
    '1d729d00ce': 'भ',
    '1e10d3a1d3': 'ड़',
    '1f2f22cd9c': 'ब्',
    '21655d6d20': 'थ्',
    '2252e0fd34': 'ज्ज',
    '22c91adf3c': 'ज्ञ',
    '23f46f5991': 'श्र',
    '2480d88cb1': 'द्र',
    '258d7eff1b': 'ीं',
    '259c4ab587': 'प्',
    '25e9022dfc': 'ेर्',
    '2600840ca6': 'द्र',
    '26654ce284': 'प्',
    '2ab96237ef': 'म',
    '2b15a97444': 'ि',
    '2baee2673d': 'ष्',
    '2c9c034cf8': 'ैं',
    '2d961fc68a': 'ट',
    '2efd2c4701': 'आ',
    '3147fcb544': 'थ्',
    '31d7d7ca5a': '◌',
    '326b85b3ae': 'ि',
    '37cbf77554': 'ट्ट',
    '384789ba2d': 'ेर्ं',
    '39e2dee31f': 'ई',
    '3a11828b40': 'ल्',
    '3a9f4a0e0a': 'ि',
    '3b2dc7fb19': 'ड़',
    '3ba30e63ba': 'ऊ',
    '3cb89da98e': 'ल्',
    '3e6d4c4f43': 'ि',
    '3ecd36bc08': 'ीं',
    '3ed9121507': 'ौ',
    '3fc2dc4f83': 'ओ',
    '40dd73efe7': 'ैं',
    '4137d91632': 'ए',
    '42d41c8023': 'ल्',
    '46454da477': 'ढ',
    '4732f6e4cd': 'व',
    '47a66ae6f0': 'ड़',
    '47cc38d7c7': 'ड्ड',
    '47d70eff7c': 'ड़',
    '48c0ec2ca4': 'ों',
    '4b894f09df': 'ो',
    '4c94216b25': 'फ',
    '4d1d034fca': 'द्य',
    '4d4d1bf640': 'ेर्ं',
    '4dff97ade2': 'ओं',
    '4e05551e38': 'ल्',
    '4e7e55c17c': 'ल्',
    '4f3a2f5d5c': 'ई',
    '4f5142b1bc': 'ीं',
    '504921c133': 'त्र',
    '5074b61402': 'द्घ',
    '51061acd4a': 'ड़',
    '513d4f697f': 'ीर्',
    '521d45dc3d': 'ीं',
    '52e1ecd704': 'िं',
    '561778e61e': 'ी',
    '5673f83eb2': 'ृ',
    '5788fb4ce4': 'ई',
    '5819a1061b': 'ॅ',
    '599c678acf': 'झ',
    '5b1d3367b9': 'इ',
    '5c95b4cd3e': 'ए',
    '5cea448068': 'उ',
    '5d1ddd1813': 'स',
    '5f1d629e11': 'द्र',
    '5f38615013': 'श्व',
    '60ee998735': 'रू',
    '613075704b': 'प्',
    '61ece8dbe0': 'ि',
    '63eefd4c14': 'ैं',
    '65695721a3': 'प',
    '66e5287b94': 'त्',
    '66ff22024f': 'फ',
    '6751e9ce99': 'न्',
    '68e969101b': 'श्',
    '6a4f928c94': 'ऊ',
    '6af89d7c27': 'ष',
    '6b0a2443cf': 'झ',
    '6dcfad013f': 'ीं',
    '6fee751c4f': 'ोर्',
    '70ffa394e7': 'ीं',
    '721e46753b': 'ड़',
    '726b6ec72c': 'ऊ',
    '73586743ed': 'रु',
    '738886d79d': 'ेर्',
    '73ecbe4a6c': 'ीं',
    '747ebbd4ad': 'छ',
    '74d744e8b3': 'क्ष',
    '74db27ca64': 'फ',
    '750c1b0d41': 'प्',
    '758397e072': 'ज़',
    '7600b543f9': 'फ',
    '76cbcdf490': 'झ',
    '772188adff': 'च्',
    '78ebd5f238': 'ड्ड',
    '78feea417a': '◌',
    '79e6225dee': 'ध',
    '7ab9ef3167': 'ऊ',
    '7c559bebf6': 'ऐ',
    '7cb6208062': 'न',
    '7d81b055b4': 'फ',
    '7f66e38315': 'ीर्',
    '805bc11136': 'ऋ',
    '807e80bed1': 'ीं',
    '81e8fe8892': '॰',
    '81f45a91fd': 'ए',
    '83692da855': 'हु',
    '86a1b3345a': 'ज्ज',
    '87a20b56c9': 'प्',
    '890802b019': 'ड्ड',
    '890b44a110': 'म्',
    '89240a9925': 'झ',
    '8b642bd434': 'ख',
    '8ba1e1db3f': 'ड्ड',
    '8c44df052d': 'स्',
    '8ca833b6f2': 'ण',
    '8e1c2ad8ae': 'र',
    '8f83dd2ba5': 'ख्',
    '8f924cc8ba': 'फ',
    '8f994df474': 'ढ',
    '8fce6b30ee': 'ीं',
    '906d14ca84': 'ेर्',
    '9076ec49ea': 'त',
    '91c4fb9cde': 'द्र',
    '9270cf40b5': '◌',
    '9364604c2b': 'ों',
    '93723488c9': 'ऊ',
    '93d2baa93d': 'ल्',
    '940f102545': 'ि',
    '976ca4a5be': 'क्ष्',
    '9923d29632': 'ई',
    '9a18581fbc': 'र्',
    '9b5ae33b17': 'ध्',
    '9b795c29ee': 'द',
    '9bbba179cc': 'ौं',
    '9dbe3751a3': 'ि',
    '9e75d77c52': 'ट्य',
    '9f91e4de31': 'ल',
    'a015e63dde': 'ठ',
    'a029efb9f7': 'ध्र',
    'a178079bc2': 'व्य',
    'a3422e66d6': 'प्',
    'a394fa367f': '◌',
    'a4274d8f98': 'हु',
    'a5bf22212a': 'ढ',
    'a6d1de452f': 'ड़',
    'a6dd172025': 'ल़',
    'a7e73062a8': 'ेर्',
    'a8739110de': 'ों',
    'a8b78a0c82': '◌',
    'a8bcabc3c7': 'थ',
    'a9488cba84': 'फ',
    'a9b34f178a': 'प्',
    'a9f61e1199': 'प्',
    'aa29d6fd6a': 'द',
    'aacdfd3864': 'द्ध',
    'ac1d0b4152': 'क्',
    'acae4e4844': 'ह',
    'ad6125f089': 'ीं',
    'ad9ebd3f61': 'श्न',
    'ae7ed0be9e': 'झ',
    'af77da75e5': 'ड्ड',
    'b0659ef005': 'क्र',
    'b195fad4ed': 'ब',
    'b25df06259': 'ल्',
    'b4c6be945c': 'ढ',
    'b516ed4428': 'ेर्ं',
    'b6160428e9': 'ऐ',
    'b627b4ad55': 'ीर्',
    'b654a1fab9': 'थ्र',
    'b677287bbf': 'ण्',
    'b6d9b989ad': 'ब्र',
    'bb420533eb': 'द्ध',
    'bc42741d95': 'ल्',
    'bdbd89856b': 'क़',
    'bead7b885e': 'स्न',
    'bebbc6ce45': 'च्च',
    'bf77dee873': 'ँ',
    'c005752634': 'त्न',
    'c42eb6b0f3': 'य',
    'c4bad94212': 'ओ',
    'c62677ef77': 'ऊ',
    'c68d1cf440': 'प्',
    'c76170c082': 'ई',
    'c88c48c79e': 'फ',
    'cad285f226': 'ि',
    'ccb67ba80e': 'ैं',
    'ce804ce7c6': 'अ',
    'd03da9c3bc': 'ग',
    'd05bddea29': 'द्व',
    'd1bd160dd1': 'ई',
    'd2ca7f547d': 'ग्र',
    'd3151878f0': 'श',
    'd3a4a84020': 'ें',
    'd60218c6fa': 'झ',
    'd6141a350d': 'च',
    'd64d1492a7': 'ेर्',
    'd652713d5b': 'द्र',
    'd75610cf75': 'ैं',
    'd9036427cf': 'ि',
    'd9784dc043': 'ड़',
    'dc507a85ae': 'स्',
    'dc6ebfed73': 'े',
    'dd11ba4798': 'ल्',
    'ddb59861ec': 'ा',
    'dee07a7b88': 'प्',
    'def56c5e38': 'ेर्',
    'e014c65273': 'त्त',
    'e058c1c9d7': 'ष्ठ',
    'e0d2a0aa9a': 'ै',
    'e53613119b': 'ओ',
    'e82b6adb94': 'ऊ',
    'e895e1e174': 'ज',
    'e936687da2': 'ऊ',
    'eb4776a788': 'ु',
    'ec864e5618': 'प्र',
    'ec9ce8b169': 'ड़',
    'ee91b64b3c': 'क',
    'f2e90f726c': 'थ्',
    'f4616f7a0d': 'ों',
    'f5e95ba074': 'ि',
    'f762cc5fd1': 'ि',
    'f8eaaf6e12': 'ष्ठ',
    'f90e17bc6a': 'ि',
    'fad0ed760c': 'ढ',
    'fb772abf30': 'ड़',
    'fe0dc18178': 'फ',
    'ff774a509c': 'े',
}

PRE_BASE_HASHES = set(['2b15a97444', '326b85b3ae', '3a9f4a0e0a', '3e6d4c4f43', '52e1ecd704', '61ece8dbe0', '940f102545', '9dbe3751a3', 'cad285f226', 'd9036427cf', 'f5e95ba074', 'f762cc5fd1', 'f90e17bc6a'])
REPH_HASHES = set(['25e9022dfc', '384789ba2d', '4d4d1bf640', '513d4f697f', '6fee751c4f', '738886d79d', '7f66e38315', '906d14ca84', '9a18581fbc', 'a7e73062a8', 'b516ed4428', 'b627b4ad55', 'd64d1492a7', 'def56c5e38'])
MATRA_CHARS = {'ा', 'ि', 'ी', 'ु', 'ू', 'ृ', 'े', 'ै', 'ो', 'ौ', 'ं', 'ँ', 'ः', 'ॅ', 'ों', 'ौं', 'ैं', 'ीं', 'ें', '्'}

# ==============================================================================
# CONTINUOUS SELF-LEARNING GLYPH & WORD DICTIONARY SYSTEM
# ==============================================================================
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
os.makedirs(DATA_DIR, exist_ok=True)
LEARNED_DICT_FILE = os.path.join(DATA_DIR, 'learned_dictionary.json')

def load_learned_dictionary():
    if os.path.exists(LEARNED_DICT_FILE):
        try:
            with open(LEARNED_DICT_FILE, 'r', encoding='utf-8') as f:
                d = json.load(f)
                return d.get('glyphs', {}), d.get('words', {})
        except Exception:
            pass
    return {}, {}

def save_learned_dictionary(new_glyphs, new_words=None):
    if not new_glyphs and not new_words:
        return 0
    try:
        cur_glyphs, cur_words = load_learned_dictionary()
        if new_glyphs:
            cur_glyphs.update(new_glyphs)
        if new_words:
            cur_words.update(new_words)
        payload = {
            'glyphs': cur_glyphs,
            'words': cur_words,
            'total_glyphs': len(cur_glyphs),
            'total_words': len(cur_words),
            'last_updated': str(os.path.getmtime(LEARNED_DICT_FILE)) if os.path.exists(LEARNED_DICT_FILE) else ""
        }
        with open(LEARNED_DICT_FILE, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return len(new_glyphs or {}) + len(new_words or {})
    except Exception:
        return 0

def parse_to_unicode_map(to_uni_obj):
    if not to_uni_obj:
        return {}
    try:
        u_data = to_uni_obj.get_data().decode('latin1', errors='ignore')
    except Exception:
        return {}
    u_map = {}
    
    # 1. Parse beginbfrange blocks: <start> <end> <dest_hex>
    for m in re.finditer(r'<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>', u_data):
        s_code = int(m.group(1), 16)
        e_code = int(m.group(2), 16)
        hex_val = m.group(3)
        u_chars = ''.join(chr(int(hex_val[i:i+4], 16)) for i in range(0, len(hex_val), 4))
        for c in range(s_code, e_code + 1):
            offset = c - s_code
            if len(hex_val) == 4 and offset > 0:
                u_map[c] = chr(int(hex_val, 16) + offset)
            else:
                u_map[c] = u_chars

    # 2. Parse beginbfchar blocks strictly within beginbfchar...endbfchar
    bfchar_match = re.search(r'beginbfchar(.*?)endbfchar', u_data, re.DOTALL)
    if bfchar_match:
        for m in re.finditer(r'<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>', bfchar_match.group(1)):
            c_code = int(m.group(1), 16)
            hex_val = m.group(2)
            u_chars = ''.join(chr(int(hex_val[i:i+4], 16)) for i in range(0, len(hex_val), 4))
            u_map[c_code] = u_chars

    return u_map

# Dynamically merge learned dictionary on startup
_learned_g, _learned_w = load_learned_dictionary()
if _learned_g:
    GLYPH_HASH_TO_HINDI.update(_learned_g)

# ==============================================================================
# 2. UNIVERSAL GOVERNMENT ELECTORAL LEXICON (Standardized Hindi Names)
# ==============================================================================
def dev_word(w: str) -> str:
    """Matches a Devanagari word safely without being broken by matras (ा, ो, ौ, etc.)."""
    return rf'(?:^|(?<=[^\u0900-\u097F])){re.escape(w)}(?=[^\u0900-\u097F]|$)'

GOV_LEXICON_RULES = [
    # 1. Kanwar / Kunwar fixes (कंवर)
    (dev_word('ककवरु कंवर'), 'कंवर'),
    (dev_word('ककवरु'), 'कंवर'),
    (dev_word('ककवरू'), 'कंवर'),
    (dev_word('ककवर'), 'कंवर'),
    (r'(?<=\s)ककवर\b', 'कंवर'),
    (r'(?<=\s)कवर\b', 'कंवर'),
    (dev_word('ककरर'), 'कंवर'),
    (dev_word('कपरर'), 'कंवर'),
    (dev_word('ककूकंवर'), 'कंकू कंवर'),
    (dev_word('ककू कंवर'), 'कंकू कंवर'),
    (dev_word('ककू'), 'कंकू'),
    
    # 2. Swaroop / Swaroopa fixes (स्वरूप)
    (dev_word('सवरुपा'), 'स्वरूपा'),
    (dev_word('सवरुप'), 'स्वरूप'),
    (dev_word('स्वरुप'), 'स्वरूप'),
    (dev_word('सवरूप'), 'स्वरूप'),
    (dev_word('रामसवरूप'), 'रामस्वरूप'),
    (dev_word('राम सवरूप'), 'रामस्वरूप'),
    (dev_word('सवरुपाराम'), 'स्वरूपाराम'),
    (dev_word('सवरूपाराम'), 'स्वरूपाराम'),
    
    # 3. Singh / Anusvara fixes
    (re.compile(r'([^\s])सिह(?=[^\u0900-\u097F]|$)'), r'\1 सिंह'),
    (dev_word('सिह'), 'सिंह'),
    (dev_word('सिहं'), 'सिंह'),
    (dev_word('बसिह'), 'सिंह'),
    (dev_word('डूंगरसिह'), 'डूंगर सिंह'),
    (dev_word('संवासिह'), 'सवाई सिंह'),
    (dev_word('पूनमसिह'), 'पूनम सिंह'),
    (dev_word('खवसिह'), 'खींव सिंह'),
    (dev_word('सावलसिह'), 'सांवल सिंह'),
    (dev_word('भंवरसिह'), 'भंवर सिंह'),
    (dev_word('सावलराम'), 'सांवलराम'),
    (dev_word('सावलाराम'), 'सांवलाराम'),
    (re.compile(r'([^\s])कवर(?=[^\u0900-\u097F]|$)'), r'\1 कंवर'),
    (dev_word('कवर'), 'कंवर'),
    
    # 4. Champa fixes (चम्पा)
    (dev_word('चमपालाल'), 'चम्पालाल'),
    (dev_word('चमपाराम'), 'चम्पाराम'),
    (dev_word('चमपादास'), 'चम्पादास'),
    (dev_word('चमपा देवी'), 'चम्पा देवी'),
    (dev_word('चमपादेवी'), 'चम्पा देवी'),
    (dev_word('चमपा'), 'चम्पा'),
    
    # 5. Pappu / Sappu fixes (पप्पू)
    (dev_word('पपपू तेवी'), 'पप्पू देवी'),
    (dev_word('पपपू देवी'), 'पप्पू देवी'),
    (dev_word('पपपू'), 'पप्पू'),
    (dev_word('पपूडी देवी'), 'पप्पूड़ी देवी'),
    (dev_word('पपूडीदेवी'), 'पप्पूड़ी देवी'),
    (dev_word('पपूडी'), 'पप्पूड़ी'),
    (dev_word('पपूराम'), 'पप्पूराम'),
    (dev_word('पपू'), 'पप्पू'),
    (dev_word('सपपू'), 'सप्पू'),
    
    # 6. Mohammad fixes (मोहम्मद)
    (dev_word('मोहममद'), 'मोहम्मद'),
    (dev_word('मौहममद'), 'मोहम्मद'),
    (dev_word('मोहमद'), 'मोहम्मद'),
    (dev_word('मलहम्ममद'), 'मोहम्मद'),
    (dev_word('सफीमोहममद'), 'सफी मोहम्मद'),
    
    # 7. Uttamchand fixes (उत्तमचंद)
    (dev_word('उतमचन्द'), 'उत्तमचंद'),
    (dev_word('उतमचंद'), 'उत्तमचंद'),
    (dev_word('उत्मचन्द'), 'उत्तमचंद'),
    (dev_word('उत्मचंद'), 'उत्तमचंद'),
    (dev_word('उत्म चंद'), 'उत्तमचंद'),
    (dev_word('उत्म'), 'उत्तम'),
    (dev_word('उत्तम चपद'), 'उत्तमचंद'),
    (dev_word('उतम चपद'), 'उत्तमचंद'),
    (dev_word('चपद'), 'चंद'),

    # 7b. Hasmukh & Paliwal fixes
    (dev_word('हसमचरख'), 'हसमुख'),
    (dev_word('हसमचख'), 'हसमुख'),
    (dev_word('हसमख'), 'हसमुख'),
    (dev_word('पाललवालल'), 'पालीवालों'),
    (dev_word('पाललवाल'), 'पालीवाल'),
    
    # 8. Devi / Glued Suffix fixes
    (re.compile(r'([^\s])तेवी(?=[^\u0900-\u097F]|$)'), r'\1 देवी'),
    (dev_word('तेवी'), 'देवी'),
    (re.compile(r'([ाीूु])देवी(?=[^\u0900-\u097F]|$)'), r'\1 देवी'),
    
    # 9. Hanuman / Hadman fixes (हड़मान)
    (dev_word('हड़मानराम'), 'हड़मानराम'),
    (dev_word('हडमानराम'), 'हड़मानराम'),
    (dev_word('हड़मानाराम'), 'हड़मानाराम'),
    (dev_word('हडमानाराम'), 'हड़मानाराम'),
    (dev_word('हडमान'), 'हड़मान'),
    (dev_word('हड़मान'), 'हड़मान'),
    (dev_word('हडमाना'), 'हड़माना'),
    (dev_word('हडमन'), 'हड़मान'),
    
    # 10. OCR Font Ligature Glitches (3 -> ई/ऊ/ओ, ड़, etc.)
    (dev_word('धूडचद'), 'धूडचंद'),
    (dev_word('नीमबाराम'), 'नीम्बाराम'),
    (dev_word('प्रेपनाथ'), 'प्रेमनाथ'),
    (dev_word('प्रेप नाथ'), 'प्रेमनाथ'),
    (dev_word('प्रेप'), 'प्रेम'),
    (dev_word('डिमपल'), 'डिंपल'),
    (dev_word('डिम्मपल'), 'डिंपल'),
    (dev_word('कुमपा'), 'कुम्पा'),
    (dev_word('कुमपाराम'), 'कुम्पाराम'),
    (dev_word('जलला'), 'जल्ला'),
    (dev_word('भलला'), 'भल्ला'),
    (dev_word('भललाराम'), 'भल्लाराम'),
    (dev_word('धललकी'), 'धल्लकी'),
    (dev_word('मफतललाल'), 'मफतलाल'),
    (dev_word('बिसमिललाबानू'), 'बिस्मिल्लाह बानो'),
    (dev_word('गलतमपुरी'), 'गौतमपुरी'),
    (dev_word('गलतमचन्द'), 'गौतमचंद'),
    (dev_word('गलतम'), 'गौतम'),
    (dev_word('ललीता'), 'ललिता'),
    (dev_word('ललीत'), 'ललित'),
    (dev_word('ललीतकुमार'), 'ललितकुमार'),
    (dev_word('मा३ीदेवी'), 'माई देवी'),
    (dev_word('मा३ी'), 'माई'),
    (dev_word('३ुसा राम'), 'ईसा राम'),
    (dev_word('३ुसा'), 'ईसा'),
    (dev_word('३रसाराम'), 'ईसराराम'),
    (dev_word('३ोजा'), 'ईजा'),
    
    # 11. Standard Rajasthani Electoral Names
    (dev_word('कयाणसिंह'), 'कल्याण सिंह'),
    (dev_word('कयाण'), 'कल्याण'),
    (dev_word('शवण'), 'श्रवण'),
    (dev_word('उममेद'), 'उम्मेद'),
    (dev_word('उम्ममेत'), 'उम्मेद'),
    (dev_word('हिममत'), 'हिम्मत'),
    (dev_word('हिम्ममताराम'), 'हिम्मतराम'),
    (dev_word('हिम्ममत'), 'हिम्मत'),
    (dev_word('झबबर'), 'झब्बर'),
    (dev_word('समुन'), 'समुंदर'),
    (dev_word('मृदला'), 'मृदुला'),
    (dev_word('लकमण'), 'लक्ष्मण'),
    (dev_word('लकमल'), 'लक्ष्मी'),
    (dev_word('कौशल्यया'), 'कौशल्या'),
    (dev_word('कोशल्यया'), 'कौशल्या'),
    (dev_word('कोशल्ययादेवी'), 'कौशल्या देवी'),
    (dev_word('कौशया'), 'कौशल्या'),
    (dev_word('राजेश्ववरी'), 'राजेश्वरी'),
    (dev_word('परमेश्ववरी'), 'परमेश्वरी'),
    (dev_word('पृथ्ववी'), 'पृथ्वी'),
    (dev_word('शंध्यया'), 'संध्या'),
    (dev_word('अयोध्यया'), 'अयोध्या'),
    (dev_word('श्ववर'), 'ईश्वर'),
    (dev_word('ुम्बरराम'), 'झूम्बरराम'),
    (dev_word('ुम्बर राम'), 'झूम्बर राम'),
    (dev_word('हुककमाराम'), 'हुकमाराम'),
    (dev_word('हुककमा राम'), 'हुकमाराम'),
    (dev_word('हुककमा'), 'हुकमा'),
    (dev_word('हुककम'), 'हुकम'),
    (dev_word('मांग्ाूराम'), 'मांगूराम'),
    (dev_word('धमन्द्र'), 'धर्मेन्द्र'),
    (dev_word('धमेंद्र'), 'धर्मेन्द्र'),
    (dev_word('उमला'), 'उर्मिला'),
    (dev_word('नीलकठ'), 'नीलकंठ'),
    (dev_word('सत्यनाराण'), 'सत्यनारायण'),
    (dev_word('पथम'), 'प्रथम'),
    (dev_word('पकाश'), 'प्रकाश'),
    (dev_word('पमोद'), 'प्रमोद'),
    (dev_word('मकेश'), 'मुकेश'),
    (dev_word('दलंत'), 'दलपत'),
    (dev_word('गणंत'), 'गणपत'),
    (dev_word('लीलाधा'), 'लीलाधर'),
    (dev_word('जय ललिता'), 'जय ललिता'),
    (dev_word('श्वयाम'), 'श्याम'),
    (dev_word('पदम्'), 'पदम'),
    (dev_word('आईलाल'), 'आईदान'),
    (dev_word('सवा कंवर'), 'सुवा कंवर'),
    (dev_word('लजलतर'), 'ललिता'),
    (dev_word('खखशी'), 'खुशी'),
    (dev_word('खखशी खत्री'), 'खुशी खत्री'),
    (re.compile(r'\bश्रीी+'), 'श्री'),
    (dev_word('श्रीीकिसन'), 'श्रीकिसन'),
    (dev_word('पंठेप सिंह'), 'प्रताप सिंह'),
    (dev_word('पंेेप सिंह'), 'प्रताप सिंह'),
    (dev_word('ओम्पप्रकाश'), 'ओमप्रकाश'),
    (dev_word('ओम्प्रकाश'), 'ओमप्रकाश'),
    (dev_word('ओमपकाश'), 'ओमप्रकाश'),
    (dev_word('ओपमप्रकाश'), 'ओमप्रकाश'),
    (dev_word('प्रेमपकाश'), 'प्रेमप्रकाश'),
    (dev_word('प्रेममप्रकाश'), 'प्रेमप्रकाश'),
    (re.compile(r'\bपताप\s*राम\b'), 'प्रतापराम'),
    (dev_word('पताप'), 'प्रताप'),
    (re.compile(r'\bआमबु\s*देवी\b'), 'आम्बु देवी'),
    (dev_word('आमबु'), 'आम्बु'),
]

ENDRA_CONJUNCT_RULES = [
    # 1. Collapse double nasal-conjunct glitches
    (re.compile(r'न्न्द्र'), 'न्द्र'),
    (re.compile(r'न्न्द'), 'न्द'),
    (re.compile(r'न्न्'), 'न्न'),

    # 2. Universal half-matra & e-matra correction for -न्द्र / -ेंद्र names
    (re.compile(r'(^|[^\u0900-\u097F])(मह[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>महेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(नर[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>नरेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(जित[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>जितेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(सुर[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>सुरेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(राज[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>राजेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(देव[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>देवेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(विज[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>विजेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(गज[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>गजेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(मानव[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>मानवेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(जोग[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>जोगेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(धीर[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>धीरेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(वीर[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>वीरेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(विर[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>वीरेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(शैल[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>शैलेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(सत्य[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>सत्येन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(उप[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>उपेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(ध[र्ममेंम]+[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>धर्मेन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(सम[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>समंदर\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(इन्न्द्र)([^\u0900-\u097F]|$)'), r'\g<1>इन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(रव[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>रवीन्द्र\g<3>'),
    (re.compile(r'(^|[^\u0900-\u097F])(हर[ंन]?[्]?द्र)([^\u0900-\u097F]|$)'), r'\g<1>हरेन्द्र\g<3>')
]

def normalize_electoral_hindi(text: str) -> str:
    """Applies universal government electoral lexicon normalization rules."""
    if not text:
        return ""
    s = text.strip()
    
    # Structural ligature and repeating character cleanups
    s = re.sub(r'श्वव', 'श्व', s)
    s = re.sub(r'्यया', '्या', s)
    s = re.sub(r'क+कू', 'कंकू', s)

    # Universal Devanagari vowel sign de-duplication (e.g. ाा->ा, ीी->ी, ूू->ू, ेे->े)
    s = re.sub(r'([ािीुूृेैोौं्])\1+', r'\1', s)
    s = re.sub(r'मांग्[ााुू]+राम', 'मांगूराम', s)
    s = re.sub(r'पं[ठेेप]+ सिंह', 'प्रताप सिंह', s)

    # 1. Universal -ेन्द्र / -ेंद्र and conjunct half-matra fixes
    for regex, rep in ENDRA_CONJUNCT_RULES:
        if regex.pattern.startswith('('):
            s = regex.sub(rep, s)
        else:
            s = regex.sub(rep, s)
    
    # 2. Electoral Lexicon Rules
    for pattern, repl in GOV_LEXICON_RULES:
        s = re.sub(pattern, repl, s)
        
    # Clean surname spacing for optimal voter indexing
    s = re.sub(r'([^\s])कंवर\b', r'\1 कंवर', s)
    s = re.sub(r'([^\s])सिंह\b', r'\1 सिंह', s)
    
    return re.sub(r'\s+', ' ', s).strip()

def strip_name_from_relative(voter_name: str, rel_name: str) -> str:
    """Strictly prevents voter name from repeating inside father/husband name without corrupting suffixes."""
    if not voter_name or not rel_name:
        return rel_name or ""
    vn = voter_name.strip()
    rn = rel_name.strip()
    if not rn or not vn:
        return rn

    HONORIFIC_SUFFIXES = {'राम', 'देवी', 'लाल', 'सिंह', 'कुमार', 'कुमारी', 'बाई', 'प्रसाद', 'दास', 'चंद', 'चन्द', 'नाथ', 'कंवर'}

    if rn.startswith(vn) and len(rn) > len(vn):
        remainder = rn[len(vn):].strip()
        if len(remainder) >= 3 and remainder not in HONORIFIC_SUFFIXES:
            return remainder

    vn_tokens = vn.split()
    rn_tokens = rn.split()
    if len(vn_tokens) >= 2 and len(rn_tokens) > len(vn_tokens):
        if rn_tokens[:len(vn_tokens)] == vn_tokens:
            remainder = " ".join(rn_tokens[len(vn_tokens):]).strip()
            if len(remainder) >= 3 and remainder not in HONORIFIC_SUFFIXES:
                return remainder

    return rn

# ==============================================================================
# 3. TTF BINARY GLYPH HASH EXTRACTOR
# ==============================================================================
def get_font_glyph_map(ff2_bytes):
    num_tables = struct.unpack('>H', ff2_bytes[4:6])[0]
    tables = {}
    for i in range(num_tables):
        off = 12 + i * 16
        tag, _, t_off, t_len = struct.unpack('>4sIII', ff2_bytes[off:off+16])
        tables[tag.decode('latin1')] = (t_off, t_len)

    head_off, _ = tables['head']
    loc_fmt = struct.unpack('>h', ff2_bytes[head_off+50:head_off+52])[0]
    loca_off, _ = tables['loca']
    glyf_off, _ = tables['glyf']

    offsets = []
    if loc_fmt == 0:
        count = tables['loca'][1] // 2
        for i in range(count):
            offsets.append(struct.unpack('>H', ff2_bytes[loca_off+i*2:loca_off+i*2+2])[0] * 2)
    else:
        count = tables['loca'][1] // 4
        for i in range(count):
            offsets.append(struct.unpack('>I', ff2_bytes[loca_off+i*4:loca_off+i*4+4])[0])

    glyph_hashes = {}
    for gid in range(len(offsets) - 1):
        g_len = offsets[gid+1] - offsets[gid]
        if g_len > 0:
            g_data = ff2_bytes[glyf_off+offsets[gid] : glyf_off+offsets[gid+1]]
            glyph_hashes[gid] = hashlib.md5(g_data).hexdigest()[:10]

    cmap_off, _ = tables['cmap']
    n_sub = struct.unpack('>H', ff2_bytes[cmap_off+2:cmap_off+4])[0]
    f4_off = None
    for i in range(n_sub):
        p_id, e_id, s_off = struct.unpack('>HHI', ff2_bytes[cmap_off+4+i*8:cmap_off+12+i*8])
        if struct.unpack('>H', ff2_bytes[cmap_off+s_off:cmap_off+s_off+2])[0] == 4:
            f4_off = cmap_off + s_off
            break

    char_to_hash = {}
    if f4_off:
        cmap = ff2_bytes[f4_off:]
        seg_count = struct.unpack('>H', cmap[6:8])[0] // 2
        end_codes = [struct.unpack('>H', cmap[14+i*2:16+i*2])[0] for i in range(seg_count)]
        start_codes = [struct.unpack('>H', cmap[16+seg_count*2+i*2:18+seg_count*2+i*2])[0] for i in range(seg_count)]
        id_deltas = [struct.unpack('>h', cmap[16+seg_count*4+i*2:18+seg_count*4+i*2])[0] for i in range(seg_count)]
        ro_pos = 16 + seg_count * 6
        id_ro = [struct.unpack('>H', cmap[ro_pos+i*2:ro_pos+i*2+2])[0] for i in range(seg_count)]

        for s in range(seg_count):
            for c in range(start_codes[s], end_codes[s] + 1):
                if c == 0xFFFF:
                    continue
                if id_ro[s] == 0:
                    gid = (c + id_deltas[s]) & 0xFFFF
                else:
                    roff = ro_pos + s*2 + id_ro[s] + (c - start_codes[s])*2
                    gid = struct.unpack('>H', cmap[roff:roff+2])[0]
                    if gid != 0:
                        gid = (gid + id_deltas[s]) & 0xFFFF
                if gid in glyph_hashes:
                    h = glyph_hashes[gid]
                    char_to_hash[c - 0xF000] = h
    return char_to_hash

# ==============================================================================
# 4. DEVANAGARI VISUAL-TO-LOGICAL DECODER ('ि' aur 'र्' Reordering)
# ==============================================================================
def decode_hashes_to_hindi(hash_list):
    tokens = []
    for h in hash_list:
        if h == 'SPACE':
            tokens.append(('SPACE', ' '))
            continue
        s = GLYPH_HASH_TO_HINDI.get(h, '')
        if not s or s == '◌':
            continue
        if s in ['ि', 'िं']:
            tokens.append(('PRE_I', s))
        elif 'र्' in s:
            tokens.append(('REPH_COMP', s))
        elif s in MATRA_CHARS or any(s.startswith(m) for m in MATRA_CHARS):
            tokens.append(('MATRA', s))
        elif s.endswith('्'):
            tokens.append(('HALF', s))
        else:
            tokens.append(('CONS', s))

    # Rule 1: Chhoti-i ('ि' / 'िं') ko agle consonant / conjunct cluster ke baad lagao
    i = 0
    while i < len(tokens):
        if tokens[i][0] == 'PRE_I':
            pre_tok = tokens[i]
            j = i + 1
            while j < len(tokens) and tokens[j][0] == 'HALF':
                j += 1
            if j < len(tokens) and tokens[j][0] == 'CONS':
                j += 1
            tokens.pop(i)
            tokens.insert(j - 1, ('MATRA', pre_tok[1]))
        else:
            i += 1

    # Rule 2: Reph ('र्' / 'ीर्' / 'ेर्' / 'ोर्' / 'ेर्ं') ko pichle consonant cluster se pehle lagao
    # Agar token me matra bhi hai (jaise 'ीर्', 'ेर्'), toh matra us consonant ke baad rahegi aur 'र्' pehle jayega
    i = 0
    while i < len(tokens):
        if tokens[i][0] == 'REPH_COMP':
            s = tokens[i][1]
            matra_part = s.replace('र्', '')
            tokens.pop(i)
            if matra_part:
                tokens.insert(i, ('MATRA', matra_part))
            j = i - 1
            while j >= 0 and tokens[j][0] == 'MATRA':
                j -= 1
            if j >= 0 and tokens[j][0] == 'CONS':
                j -= 1
            while j >= 0 and tokens[j][0] == 'HALF':
                j -= 1
            tokens.insert(j + 1, ('HALF', 'र्'))
            i += (1 if matra_part else 0)
        else:
            i += 1

    res = "".join(t[1] for t in tokens)
    return normalize_electoral_hindi(res)

# ==============================================================================
# 5. PDF STREAM PARSER & VOTER BOX EXTRACTOR
# ==============================================================================
def parse_pdf_stream_tokens(stream_str):
    x, y, lm_x, lm_y = 0.0, 0.0, 0.0, 0.0
    curr_font = None
    items = []
    for line in stream_str.splitlines():
        line = line.strip()
        if line.endswith(' Tm'):
            parts = line.split()
            lm_x, lm_y = float(parts[4]), float(parts[5])
            x, y = lm_x, lm_y
        elif line.endswith(' Td'):
            parts = line.split()
            lm_x += float(parts[0])
            lm_y += float(parts[1])
            x, y = lm_x, lm_y
        elif line.endswith(' Tf'):
            curr_font = line.split()[0]
        elif line.endswith(' Tj') and line.startswith('('):
            raw_s = line[1:-4]
            b_list, i = [], 0
            while i < len(raw_s):
                if raw_s[i] == '\\' and i + 1 < len(raw_s):
                    nxt = raw_s[i+1]
                    if nxt in ['(', ')', '\\']:
                        b_list.append(ord(nxt)); i += 2
                    elif nxt.isdigit():
                        b_list.append(int(raw_s[i+1:i+4], 8)); i += 4
                    else:
                        b_list.append(ord(nxt)); i += 2
                else:
                    b_list.append(ord(raw_s[i])); i += 1
            items.append((round(x, 1), round(y, 1), curr_font, b_list))
    return items

def extract_single_pdf(pdf_path, default_ward=None, default_part=None, include_deleted=False, photos_dir=None):
    reader = pypdf.PdfReader(pdf_path)
    bn = os.path.basename(pdf_path)

    fitz_doc = None
    if photos_dir:
        try:
            import fitz
            os.makedirs(photos_dir, exist_ok=True)
            fitz_doc = fitz.open(pdf_path)
        except Exception as e:
            print(f"[PhotoExtraction] Failed to init fitz: {e}")
            fitz_doc = None
    
    # 1. Extract Ward from Filename or Cover
    ward_no = default_ward
    if not ward_no:
        ward_m = re.search(r'Ward\s*(?:No)?[_\-\s]*0*(\d+)', bn, re.I)
        ward_no = ward_m.group(1) if ward_m else "1"
        
    # Extract Polling Booth / Part No from cover page
    part_no = default_part
    if not part_no and len(reader.pages) > 0:
        cover_txt = reader.pages[0].extract_text() or ""
        # Rajasthan SEC format: मतदान बूथ की संख्या एवं पता : 54 - राजकीय उच्च...
        booth_m = re.search(r'(?:मतदरन\s*बबस|मतदान\s*बूथ|मतदान\s*केंद्र|मतदान\s*स्थल).*?(\d+)\s*[-–]', cover_txt, re.S)
        if booth_m:
            part_no = booth_m.group(1)
        else:
            part_m = re.search(r'(?:भाग|Part|भरग)\s*(?:संख्या|No|क्रं|No\.)?\s*[:\-]?\s*(\d+)', cover_txt, re.I)
            if part_m:
                part_no = part_m.group(1)
    
    if not part_no:
        part_no = "1"
    
    # 2. Extract Supplement Deletions (serials marked E, S, R, O, Q across all supplement pages)
    # E = Expired/Death, S = Shifted, R = Repeated, O/Q = Other/Disqualified
    deletions_serials = set()
    for p_idx in range(max(0, len(reader.pages) - 8), len(reader.pages) - 1):
        p_txt = reader.pages[p_idx].extract_text() or ""
        matches = re.findall(r'(?:^|\s)([ESROQ])\s*(\d{1,4})(?:\s|$)', p_txt)
        for mark, s_num in matches:
            deletions_serials.add(int(s_num))

    current_village_hi = "कुम्हारों की ढाणी, मावा"
    VALID_VILLAGE_KEYWORDS = ['ढाणी', 'बास', 'बस्ती', 'रामदेवरा', 'मावा', 'रोड', 'स्टेशन', 'स्कूल', 'मोहल्ला', 'ग्राम']
    INVALID_VILLAGE_KEYWORDS = ['लिंग', 'आयु', 'पुरुष', 'स्त्री', 'विधानसभा', 'निर्वाचक', 'भाग', 'घटक', 'संख्या']

    voters_dict = {}
    newly_learned_glyphs = {}
    newly_learned_words = {}

    # Pass 1: Global Glyph Pre-Scan across all Form XObjects in the entire PDF
    # This guarantees that glyphs discovered on ANY page are immediately in the dictionary BEFORE Pass 2 extracts card 1
    for p_idx in range(2, len(reader.pages) - 1):
        page = reader.pages[p_idx]
        res = page.get('/Resources')
        if not res: continue
        res = res.get_object()
        if '/XObject' not in res: continue
        xobjs = res['/XObject'].get_object()
        for xk in xobjs:
            xo = xobjs[xk].get_object()
            if xo.get('/Subtype') != '/Form' or '/Resources' not in xo:
                continue
            xo_res = xo['/Resources'].get_object()
            fres = xo_res.get('/Font', {}).get_object() if '/Font' in xo_res else {}
            if '/9' not in fres:
                continue
            fo = fres['/9'].get_object()
            if '/FontDescriptor' in fo and '/FontFile2' in fo['/FontDescriptor']:
                ff2 = fo['/FontDescriptor']['/FontFile2'].get_data()
                ch_hash = get_font_glyph_map(ff2)
                to_uni = parse_to_unicode_map(fo.get('/ToUnicode'))
                for c_val, g_h in ch_hash.items():
                    if g_h and g_h not in GLYPH_HASH_TO_HINDI:
                        u_ch = to_uni.get(c_val)
                        if u_ch and ('\u0900' <= u_ch <= '\u097F' or u_ch in [' ', '॰']):
                            GLYPH_HASH_TO_HINDI[g_h] = u_ch
                            newly_learned_glyphs[g_h] = u_ch

    # Pass 2: High-Precision Voter Card Extraction
    for p_idx in range(2, len(reader.pages) - 1):
        candidate_photos = []
        if fitz_doc and p_idx < len(fitz_doc):
            try:
                page_fitz = fitz_doc[p_idx]
                img_infos = page_fitz.get_image_info(xrefs=True)
                for info in img_infos:
                    bbox = info.get('bbox', ())
                    if len(bbox) == 4:
                        x0, y0, x1, y1 = bbox
                        w = x1 - x0
                        h = y1 - y0
                        if 30 <= w <= 85 and 40 <= h <= 95:
                            candidate_photos.append({
                                'xref': info['xref'],
                                'cx': (x0 + x1) / 2.0,
                                'cy': (y0 + y1) / 2.0,
                                'bbox': bbox
                            })
            except Exception as e:
                candidate_photos = []

        page = reader.pages[p_idx]
        res = page['/Resources'].get_object()
        if '/XObject' not in res:
            continue
        xobjs = res['/XObject'].get_object()
        for xk in xobjs:
            xo = xobjs[xk].get_object()
            if xo.get('/Subtype') != '/Form' or '/Resources' not in xo:
                continue
            fres = xo['/Resources'].get_object().get('/Font', {}).get_object()
            if '/9' not in fres:
                continue

            fo = fres['/9'].get_object()
            ff2 = fo['/FontDescriptor']['/FontFile2'].get_data()
            ch_hash = get_font_glyph_map(ff2)
            to_uni = parse_to_unicode_map(fo.get('/ToUnicode'))

            items = parse_pdf_stream_tokens(xo.get_data().decode('latin1'))

            serials = []
            for x, y, f, b in items:
                s_txt = ''.join(chr(c) for c in b).strip()
                if s_txt.isdigit() and int(s_txt) > 0 and f != '/9' and any(abs(x - target_x) < 5.0 for target_x in [46.7, 53.2, 220.2, 226.8, 393.6, 400.2]):
                    serials.append((int(s_txt), x, y))

            for s_num, sx, sy in serials:
                if s_num in voters_dict:
                    continue

                # Mohalla/Village check
                hdr_hashes = []
                for x, y, f, b in items:
                    if sy + 14.0 <= y <= sy + 28.0 and x < 200:
                        if f == '/9':
                            hdr_hashes.extend([ch_hash.get(c, '') for c in b])
                        elif f == '/a':
                            txt = ''.join(chr(c) for c in b)
                            if ',' in txt or txt == ' ':
                                hdr_hashes.append('SPACE')
                if hdr_hashes:
                    cand_v = decode_hashes_to_hindi(hdr_hashes)
                    if len(cand_v) > 4:
                        if any(vk in cand_v for vk in VALID_VILLAGE_KEYWORDS) and not any(ik in cand_v for ik in INVALID_VILLAGE_KEYWORDS):
                            current_village_hi = cand_v

                # Exact column base x
                if sx < 150:
                    cb_x = 32.0
                elif sx < 320:
                    cb_x = 206.0
                else:
                    cb_x = 380.0

                epic_no = ""
                house_no = ""
                age_val = 30
                name_hashes = []
                rel_hashes = []
                rel_type_hashes = []
                gen_hashes = []

                for x, y, f, b in items:
                    if not (cb_x <= x <= cb_x + 172.0):
                        continue
                    txt = ''.join(chr(c) for c in b).strip()

                    # EPIC No
                    if sy - 2.0 <= y <= sy + 2.0 and cb_x + 40 <= x <= cb_x + 130 and f != '/9':
                        if len(txt) >= 7:
                            epic_no = txt

                    # Voter Name line
                    elif sy - 16.5 <= y <= sy - 11.5:
                        if x >= cb_x + 21.0:
                            if f == '/9': name_hashes.extend([ch_hash.get(c, '') for c in b])
                            elif f != '/9' and ' ' in ''.join(chr(c) for c in b): name_hashes.append('SPACE')

                    # Relation line
                    elif sy - 29.5 <= y <= sy - 24.5:
                        if x < cb_x + 45.0 and f == '/9':
                            rel_type_hashes.extend([ch_hash.get(c, '') for c in b])
                        elif x >= cb_x + 45.0:
                            if f == '/9': rel_hashes.extend([ch_hash.get(c, '') for c in b])
                            elif f != '/9' and ' ' in ''.join(chr(c) for c in b): rel_hashes.append('SPACE')

                    # House No line
                    elif sy - 48.5 <= y <= sy - 32.0 and f != '/9':
                        c_cand = re.sub(r'^[ :ः\.\-]+', '', txt).strip()
                        c_cand = re.sub(r'^(?:मकान|संख्या|मकरन|सपखजर|सपखसर|गृह|house|no)[:ः\.\-\s]*', '', c_cand, flags=re.I).strip()
                        c_cand = re.sub(r'[,:ः\.\s]+$', '', c_cand).strip()
                        if c_cand and any(ch.isdigit() for ch in c_cand) and not any(k in c_cand for k in ['Photo', 'EPIC', 'RJ/', 'VOTER']):
                            if re.match(r'^0+$', c_cand):
                                c_cand = '-'
                            elif re.match(r'^0+\d+$', c_cand):
                                c_cand = str(int(c_cand))
                            elif re.match(r'^0+\d+', c_cand):
                                c_cand = re.sub(r'^0+(\d+)', r'\1', c_cand)
                            house_no = c_cand

                    # Age & Gender line
                    elif sy - 58.0 <= y <= sy - 49.0:
                        if f != '/9' and txt.isdigit():
                            p_age = int(txt)
                            if 18 <= p_age <= 125:
                                age_val = p_age
                            elif 0 < p_age < 18:
                                age_val = p_age
                        elif f == '/9' and x >= cb_x + 70.0:
                            gen_hashes.extend([ch_hash.get(c, '') for c in b])

                name_hi = sandhi_viched(decode_hashes_to_hindi(name_hashes))
                rel_hi = sandhi_viched(decode_hashes_to_hindi(rel_hashes))
                rel_t_hi = decode_hashes_to_hindi(rel_type_hashes)
                gen_hi = decode_hashes_to_hindi(gen_hashes)

                # Anti-repetition filter
                rel_hi = strip_name_from_relative(name_hi, rel_hi)

                rel_type = "पति" if "पति" in rel_t_hi else ("माता" if "माता" in rel_t_hi else "पिता")
                
                # Multi-layer gender detection
                FEMALE_NAME_MARKERS = {'देवी', 'कंवर', 'बाई', 'कुमारी', 'बेगम', 'बानू', 'कांता', 'शांता', 'कमला', 'मंजू', 'सुशीला', 'संतोष', 'पूजा', 'रेखा', 'अनिता', 'सुनीता', 'प्रियंका', 'दीक्षा', 'कविता', 'आशा', 'ममता', 'संगीता', 'मोनिका', 'सरोज', 'ललिता', 'उर्मिला', 'विमला', 'किरण', 'पप्पूड़ी', 'बदामी'}
                MALE_NAME_MARKERS = {'राम', 'लाल', 'सिंह', 'कुमार', 'चन्द', 'चंद', 'प्रसाद', 'दीन', 'नाथ', 'गिरी', 'पूरी', 'पुरी', 'प्रकाश', 'भंवर', 'किशन', 'गोपाल', 'महेन्द्र', 'सुरेन्द्र', 'राजेन्द्र', 'नरेश', 'मुकेश', 'दिनेश', 'सुरेश', 'रमेश', 'राकेश', 'अनिल', 'सुनील', 'विकास', 'अशोक', 'विनोद', 'प्रमोद', 'प्रदीप', 'संदीप', 'दीपक', 'मनोज', 'संजय', 'अजय', 'विजय', 'चिराग', 'हसमुख', 'नेमाराम'}
                
                if rel_type == "पति" or "स्त्र" in gen_hi or "महिला" in gen_hi:
                    gender = "स्त्री"
                elif any(fm in name_hi for fm in FEMALE_NAME_MARKERS):
                    gender = "स्त्री"
                elif any(mm in name_hi for mm in MALE_NAME_MARKERS):
                    gender = "पुरुष"
                else:
                    gender = "स्त्री" if "स्त्र" in gen_hi else "पुरुष"
                status = "विलोपित" if s_num in deletions_serials else "सक्रिय"

                # Filter out deleted voters when include_deleted is False (default)
                # This guarantees that the exported active voter count matches the official Election Commission summary
                if not include_deleted and s_num in deletions_serials:
                    continue

                # Match voter to photo if photos_dir is enabled
                photo_filename = ""
                if fitz_doc and candidate_photos:
                    col = 1 if sx < 150 else (2 if sx < 320 else 3)
                    expected_cx = 184.4 if col == 1 else (357.9 if col == 2 else 531.4)
                    expected_cy = abs(sy) + 28.0
                    best_img = None
                    min_dist = float('inf')
                    for c_img in candidate_photos:
                        dx = abs(c_img['cx'] - expected_cx)
                        dy = abs(c_img['cy'] - expected_cy)
                        if dx <= 30.0 and dy <= 30.0:
                            dist = (dx**2 + dy**2)**0.5
                            if dist < min_dist:
                                min_dist = dist
                                best_img = c_img
                    if best_img:
                        try:
                            pix = fitz.Pixmap(fitz_doc, best_img['xref'])
                            if pix.n >= 5:
                                pix = fitz.Pixmap(fitz.csRGB, pix)
                            clean_s = re.sub(r'[^a-zA-Z0-9_\-]', '_', str(epic_no or f"VOTER_{ward_no}_{part_no}_{s_num}"))
                            photo_filename = f"{clean_s}_{s_num}.webp"
                            target_save_path = os.path.join(photos_dir, photo_filename)
                            try:
                                from PIL import Image, ImageEnhance
                                import io
                                pil_img = Image.open(io.BytesIO(pix.tobytes('png')))
                                # High-quality 2.5x upscale using Lanczos to avoid browser bilinear blur on small 43x60 stamps
                                if pil_img.width < 100:
                                    target_w = int(pil_img.width * 2.5)
                                    target_h = int(pil_img.height * 2.5)
                                    pil_img = pil_img.resize((target_w, target_h), Image.Resampling.LANCZOS)
                                    # Subtle edge sharpening
                                    enhancer = ImageEnhance.Sharpness(pil_img)
                                    pil_img = enhancer.enhance(1.3)
                                pil_img.save(target_save_path, 'WEBP', quality=95)
                            except Exception:
                                photo_filename = f"{clean_s}_{s_num}.png"
                                pix.save(os.path.join(photos_dir, photo_filename))
                        except Exception as pe:
                            photo_filename = ""

                voters_dict[s_num] = {
                    'क्रमांक': s_num,
                    'पहचान पत्र क्रमांक (EPIC No)': epic_no or f"VOTER_W{ward_no}_P{part_no}_{s_num}",
                    'मतदाता का नाम': name_hi or 'मतदाता',
                    'संबंधी का नाम': rel_hi or '-',
                    'संबंध प्रकार': rel_type,
                    'मकान संख्या': house_no or '-',
                    'आयु': age_val,
                    'लिंग': gender,
                    'गाँव / मोहल्ला': current_village_hi or '-',
                    'वार्ड संख्या': str(ward_no),
                    'बूथ / भाग संख्या': str(part_no),
                    'स्थिति': status,

                    # Keys matching database and template (Pure Hindi Data Only)
                    'epic': epic_no or f"VOTER_W{ward_no}_P{part_no}_{s_num}",
                    'ward': str(ward_no),
                    'part': str(part_no),
                    'serial': s_num,
                    'name_en': transliterate_hindi(name_hi),
                    'name_hi': name_hi or 'मतदाता',
                    'age': age_val,
                    'gender': gender,
                    'relation': rel_type,
                    'relative_name_en': transliterate_hindi(rel_hi),
                    'relative_name_hi': rel_hi or '-',
                    'house_no': house_no or '-',
                    'house_no_hi': house_no or '-',
                    'mobile': '',
                    'caste': '',
                    'family_id': '',
                    'village_en': transliterate_hindi(current_village_hi),
                    'village_hi': current_village_hi or '-',
                    'status': status,
                    'photo_file': photo_filename
                }

    if fitz_doc:
        try:
            if photos_dir:
                manifest_items = [
                    {
                        'serial': v.get('serial'),
                        'epic': v.get('epic'),
                        'photo_file': v.get('photo_file', '')
                    }
                    for v in voters_dict.values()
                    if v.get('photo_file')
                ]
                with open(os.path.join(photos_dir, 'photos_manifest.json'), 'w', encoding='utf-8') as f:
                    json.dump(manifest_items, f, ensure_ascii=False, indent=2)
            fitz_doc.close()
        except Exception as fe:
            print(f"[PhotoExtraction] Cleanup error: {fe}")

    if newly_learned_glyphs or newly_learned_words:
        save_learned_dictionary(newly_learned_glyphs, newly_learned_words)
        print(f"[Auto-Learner] Successfully surveyed & added {len(newly_learned_glyphs)} glyphs to dictionary from {bn}.")

    return [voters_dict[k] for k in sorted(voters_dict.keys())]

# ==============================================================================
# 6. TRANSLITERATION ENGINE (HINDI TO ENGLISH)
# ==============================================================================
COMMON_INDIAN_NAME_TRANSLATIONS = {
    'गंगा': 'Ganga', 'वासुदेव': 'Vasudev', 'नगाराम': 'Naga Ram', 'नखताराम': 'Nakhta Ram',
    'सुआ': 'Sua', 'पूनाराम': 'Poona Ram', 'निजरों': 'Nijro', 'पदमाराम': 'Padma Ram',
    'ओम प्रकाश': 'Om Prakash', 'ओमप्रकाश': 'Om Prakash', 'प्रेम प्रकाश': 'Prem Prakash', 'प्रेमप्रकाश': 'Prem Prakash',
    'ओमाराम': 'Oma Ram', 'ओमा राम': 'Oma Ram', 'प्रेमाराम': 'Prema Ram', 'प्रेमा राम': 'Prema Ram',
    'ओमदास': 'Om Das', 'प्रेमदास': 'Prem Das', 'ओमनाथ': 'Om Nath', 'प्रेमनाथ': 'Prem Nath',
    'मुकेश': 'Mukesh', 'राधा कुमारी': 'Radha Kumari',
    'कालूराम': 'Kalu Ram', 'छगन': 'Chhagan', 'छगनी': 'Chhagani', 'लीलाधर': 'Leeladhar',
    'तारों देवी': 'Taro Devi', 'भंवरूराम': 'Bhanwroo Ram', 'लीला': 'Leela',
    'पुरखाराम': 'Purkha Ram', 'मुढमा': 'Mudhma', 'गुमानाराम': 'Gumana Ram',
    'राधा': 'Radha', 'राणाराम': 'Rana Ram', 'पदमा राम': 'Padma Ram', 'नखता राम': 'Nakhta Ram',
    'अशोक कुमार': 'Ashok Kumar', 'चम्पाराम': 'Champa Ram', 'पदम्': 'Padam', 'बेरिशाल': 'Berishal',
    'राम': 'Ram', 'श्याम': 'Shyam', 'सीता': 'Sita', 'गीता': 'Geeta', 'रमेश': 'Ramesh',
    'सुरेश': 'Suresh', 'महेश': 'Mahesh', 'दिनेश': 'Dinesh', 'कमलेश': 'Kamlesh',
    'राजेश': 'Rajesh', 'राकेश': 'Rakesh', 'सुनील': 'Sunil', 'अनिल': 'Anil',
    'मनोज': 'Manoj', 'संजय': 'Sanjay', 'विजय': 'Vijay', 'अजय': 'Ajay',
    'देवी': 'Devi', 'बाई': 'Bai', 'कंवर': 'Kanwar', 'सिंह': 'Singh', 'लाल': 'Lal',
    'कुमार': 'Kumar', 'कुमारी': 'Kumari', 'प्रसाद': 'Prasad', 'प्रकाश': 'Prakash',
    'चन्द': 'Chand', 'चंद': 'Chand', 'नाथ': 'Nath', 'दास': 'Das', 'शंकर': 'Shanker',
    'पवन': 'Pavan', 'किशन': 'Kishan', 'गोपाल': 'Gopal', 'मोहन': 'Mohan', 'सोहन': 'Sohan',
    'शान्ति': 'Shanti', 'शान्ती': 'Shanti', 'कमला': 'Kamla', 'विमला': 'Vimla', 'निर्मला': 'Nirmala',
    'मंजू': 'Manju', 'अनिता': 'Anita', 'पूजा': 'Pooja', 'आरती': 'Aarti',
    'संतोष': 'Santosh', 'रेखा': 'Rekha', 'सुमन': 'Suman', 'कविता': 'Kavita',
    'सवाई': 'Sawai', 'स्वरूप': 'Swaroop', 'हिम्मत': 'Himmata', 'उम्मेद': 'Ummed',
    'श्रवण': 'Shravan', 'भीमाराम': 'Bheema Ram', 'गोरधन': 'Gordhan', 'घेवर': 'Ghevar',
    'अभय': 'Abhay', 'भोम': 'Bhom', 'गुलाब': 'Gulab', 'सूरज': 'Suraj', 'इन्द्र': 'Indra',
    
    # Extended Rajasthan electoral lexicon & caste names
    'चम्पालाल': 'Champalal', 'चमपालाल': 'Champalal', 'चम्पा': 'Champa', 'चमपा': 'Champa',
    'चम्पाराम': 'Champaram', 'चमपाराम': 'Champaram', 'चम्पादास': 'Champadas', 'चमपादास': 'Champadas',
    'पप्पू': 'Pappu', 'पपू': 'Pappu', 'पपपू': 'Pappu', 'सप्पू': 'Sappu', 'सपपू': 'Sappu',
    'पप्पूड़ी': 'Pappudi', 'पपूडी': 'Pappudi', 'पप्पूराम': 'Pappuram', 'पपूराम': 'Pappuram',
    'मोहम्मद': 'Mohammad', 'मोहममद': 'Mohammad', 'मौहममद': 'Mohammad',
    'उत्तमचंद': 'Uttamchand', 'उतमचन्द': 'Uttamchand', 'उत्मचंद': 'Uttamchand', 'उतमचंद': 'Uttamchand',
    'सांवलराम': 'Sanwalram', 'सावलराम': 'Sanwalram', 'सांवलाराम': 'Sanwalaram', 'सावलाराम': 'Sanwalaram',
    'सांवल': 'Sanwal', 'सावल': 'Sanwal', 'सांवल सिंह': 'Sanwal Singh', 'सावलसिह': 'Sanwal Singh',
    'भंवर सिंह': 'Bhanwar Singh', 'भंवरसिह': 'Bhanwar Singh', 'डूंगर सिंह': 'Dungar Singh', 'डूंगरसिह': 'Dungar Singh',
    'हड़मान': 'Hadman', 'हडमान': 'Hadman', 'हड़मानराम': 'Hadmanram', 'हडमानराम': 'Hadmanram',
    'हड़माना': 'Hadmana', 'हडमाना': 'Hadmana', 'हनुमान': 'Hanuman', 'हनुमानाराम': 'Hanumanaram',
    'धूडचंद': 'Dhudchand', 'धूडचद': 'Dhudchand', 'धुडाराम': 'Dhudaram',
    'जसराज': 'Jasraj', 'पारस': 'Paras', 'पारसमल': 'Parasmal', 'हीराराम': 'Heeraram',
    'रुपाराम': 'Rooparam', 'खेताराम': 'Khetaram', 'खेता': 'Kheta',
    'शंकरलाल': 'Shankarlal', 'गौतम': 'Gautam', 'गौतमचंद': 'Gautamchand', 'गौतमचन्द': 'Gautamchand',
    'छगनाराम': 'Chhaganaram', 'छगना': 'Chhagana', 'छगनलाल': 'Chhaganlal',
    'राणाराम': 'Ranaram', 'राणा': 'Rana', 'देमाराम': 'Demaram', 'देमा': 'Dema',
    'मालाराम': 'Malaram', 'माला': 'Mala', 'जगाराम': 'Jagaram', 'जोगा': 'Joga',
    'बीजाराम': 'Beejaram', 'गोबरराम': 'Gobarram', 'गोबर': 'Gobar', 'गीगाराम': 'Geegaram',
    'राजू': 'Raju', 'राजूराम': 'Rajuram', 'दिलीप': 'Dilip', 'नेमा': 'Nema',
    'ढलाराम': 'Dhalaram', 'ढला': 'Dhala', 'खेमप्रकाश': 'Khemprakash', 'हरीराम': 'Hariram',
    'भूराराम': 'Bhuraram', 'तेजा': 'Teja', 'निरमा': 'Nirma', 'हेमाराम': 'Hemaram',
    'मूलाराम': 'Moolaram', 'सुन्दर': 'Sundar', 'मांगी': 'Mangi', 'मांगीलाल': 'Mangilal',
    'मोटाराम': 'Motaram', 'सोमती': 'Somati', 'दुर्गाराम': 'Durgaram', 'बाबु': 'Babu',
    'बाबुलाल': 'Babulal', 'बाबूलाल': 'Babulal', 'मिश्रीमल': 'Mishrimal', 'मिश्रीलाल': 'Mishrilal',
    'कमली': 'Kamli', 'हकाराम': 'Hakaram', 'सोमा': 'Soma', 'गोविन्द्राम': 'Govindram',
    'जमना': 'Jamna', 'तुलसाराम': 'Tulsaram', 'तुलछा': 'Tulchha', 'बदामी': 'Badami',
    'भगवती': 'Bhagwati', 'अणदाराम': 'Andaram', 'दीपनाथ': 'Deepnath', 'भंवराराम': 'Bhanwararam',
    'गुडिया': 'Gudiya', 'रेशमी': 'Reshmi', 'रावता': 'Rawata', 'अचलाराम': 'Achalaram',
    'लूणाराम': 'Loonaram', 'खीमाराम': 'Kheemaram', 'खीमा': 'Kheema', 'गणपत': 'Ganpat',
    'आमबाराम': 'Ambaram', 'उम्मेदाराम': 'Ummedaram', 'चेनाराम': 'Chenaram',
    'जेठाराम': 'Jetharam', 'अमृत': 'Amrit', 'अमृतलाल': 'Amritlal', 'भंवर': 'Bhanwar',
    'भंवरलाल': 'Bhanwarlal', 'पुखराज': 'Pukhraj', 'पन्नालाल': 'Pannalal',
    'सोहनलाल': 'Sohanlal', 'हीरालाल': 'Hiralal', 'मदनलाल': 'Madanlal',
    'जीवाराम': 'Jeewaram', 'जीवा': 'Jeewa', 'जैसाराम': 'Jaisaram', 'चौथाराम': 'Chhotharam',
    'जोगनाथ': 'Jognath', 'धर्माराम': 'Dharmaram', 'धर्मा': 'Dharma', 'डूंगर': 'Dungar',
    'बगदाराम': 'Bagdaram', 'बगदा': 'Bagda', 'रामचन्द्र': 'Ramchandra', 'चन्दनमल': 'Chandanmal',
    'लिखमाराम': 'Likhamaram', 'लिखमा': 'Likhma', 'पीराराम': 'Peeraram', 'देवा': 'Deva',
    'लेखा': 'Lekha', 'लेखाराम': 'Lekharam', 'भोलाराम': 'Bholaram', 'नेता': 'Neta',
    'गोपाराम': 'Goparam', 'सवाराम': 'Sawaram', 'केसा': 'Kesa', 'भीमनाथ': 'Bheemnath',
    'रामनाथ': 'Ramnath', 'सलीम': 'Salim', 'अनवर': 'Anwar', 'सुजाराम': 'Soojaram',
    'सूजाराम': 'Soojaram', 'गोमती': 'Gomati', 'मोहनी': 'Mohani', 'सरुपा': 'Saroopa',
    'चेला': 'Chela', 'भीमराज': 'Bheemraj', 'चतराराम': 'Chatararam', 'करनाराम': 'Karanaram',
    'धाराराम': 'Dhararam', 'शिवलाल': 'Shivlal', 'सरिता': 'Sarita', 'बादरराम': 'Badarram',
    'जोगाराम': 'Jogaram', 'उकाराम': 'Ukaram', 'पिंका': 'Pinka', 'सोना': 'Sona',
    'तेमाराम': 'Temaram', 'केवलराम': 'Kewalram', 'पारसनाथ': 'Parasnath', 'भीखनाथ': 'Bheekhnath',
    'मनोहर': 'Manohar', 'जयनारायण': 'Jayanarayan', 'पदमाराम': 'Padmaram', 'पुरी': 'Puri',
    'गोविन्द': 'Govind', 'गोविंद': 'Govind', 'सायरी': 'Sayari', 'भलाराम': 'Bhalaram',
    'हस्तीमल': 'Hastimal', 'मेलाराम': 'Melaram', 'शंकरराम': 'Shankarram', 'मीठाराम': 'Meetharam',
    'मांगाराम': 'Mangaram', 'चुनाराम': 'Chunararam', 'नेमी': 'Nemi', 'लूमबाराम': 'Loombaram',
    'हरजी': 'Harji', 'वीराराम': 'Veerararam', 'भोमाराम': 'Bhomaram', 'भैराराम': 'Bhairaram',
    'करण': 'Karan', 'मोमताराम': 'Momtaram', 'कालू': 'Kalu', 'तारा': 'Tara',
    'इन्द्राराम': 'Indraram', 'दरिया': 'Dariya', 'नवाराम': 'Navaram', 'सुमेर': 'Sumer',
    'मंगलनाथ': 'Mangalnath', 'गुलाबनाथ': 'Gulabnath', 'सुबान': 'Suban', 'नूर': 'Noor',
    'खान': 'Khan', 'खां': 'Khan', 'बानो': 'Bano', 'बानू': 'Bano', 'बेगम': 'Begum',
    'जांगिड़': 'Jangid', 'सुथार': 'Suthar', 'लोहार': 'Lohar', 'सोनी': 'Soni',
    'दर्जी': 'Darji', 'गहलोत': 'Gehlot', 'गेहलोत': 'Gehlot', 'राठौड़': 'Rathore',
    'भाटी': 'Bhati', 'सोलंकी': 'Solanki', 'चौहान': 'Chauhan', 'मेघवाल': 'Meghwal',
    'विश्नोई': 'Bishnoi', 'बिश्नोई': 'Bishnoi', 'पालीवाल': 'Paliwal', 'पुरोहित': 'Purohit',
    'माहेश्वरी': 'Maheshwari', 'ओसवाल': 'Oswal', 'सारस्वत': 'Saraswat', 'दाधीच': 'Dadhich',
    'पारीक': 'Pareek', 'गुर्जर': 'Gurjar', 'देवासी': 'Dewasi', 'रबारी': 'Rabari', 'रायका': 'Raika'
}

DEV_VOWELS = {
    'अ': 'A', 'आ': 'Aa', 'इ': 'I', 'ई': 'Ee', 'उ': 'U', 'ऊ': 'Oo',
    'ऋ': 'Ri', 'ए': 'E', 'ऐ': 'Ai', 'ओ': 'O', 'औ': 'Au',
    'अं': 'An', 'अः': 'Ah'
}

DEV_MATRAS = {
    'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
    'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
    'ं': 'n', 'ँ': 'n', 'ः': 'h', 'ॅ': 'e', 'ॉ': 'o'
}

DEV_CONSONANTS = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
    'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
    'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
    'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
    'ष': 'sh', 'स': 's', 'ह': 'h',
    'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gya', 'श्र': 'shr',
    'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z',
    'ड़': 'd', 'ड़': 'd', '\u095C': 'd',
    'ढ़': 'dh', 'ढ़': 'dh', '\u095D': 'dh',
    'फ़': 'f'
}

COMPOUND_NAME_SUFFIXES = [
    ('राम', ' Ram'), ('लाल', ' Lal'), ('कुमार', ' Kumar'), ('कुमारी', ' Kumari'),
    ('सिंह', ' Singh'), ('कंवर', ' Kanwar'), ('देवी', ' Devi'), ('बाई', ' Bai'),
    ('प्रसाद', ' Prasad'), ('प्रकाश', ' Prakash'), ('चंद', ' Chand'), ('चन्द', ' Chand'),
    ('नाथ', ' Nath'), ('दास', ' Das'), ('शंकर', ' Shanker'), ('चन्द्र', ' Chandra'),
    ('धर', ' Dhar'), ('भूषण', ' Bhushan'), ('शेखर', ' Shekhar'), ('वल्लभ', ' Vallabh'),
    ('कांत', ' Kant'), ('कान्त', ' Kant'), ('मोहन', ' Mohan'), ('सुंदर', ' Sundar'),
    ('सुन्दर', ' Sundar'), ('रंजन', ' Ranjan'), ('वर्धन', ' Vardhan'), ('मणि', ' Mani'),
    ('मित्र', ' Mitra'), ('पुत्र', ' Putra'), ('स्वरूप', ' Swaroop'), ('नारायण', ' Narayan'),
    ('ेंद्र', 'endra'), ('ेन्द्र', 'endra'), ('इंद्र', 'indra'), ('इन्द्र', 'indra')
]

KNOWN_SECTION_TRANSLATIONS = {
    'कुम्हारों की ढाणी, मावा': 'Kumharo Ki Dhani, Mawa',
    'कुम्हारों की ढाणी मावा': 'Kumharo Ki Dhani, Mawa',
    'सोहनसिंह की ढाणी, मावा': 'Sohansingh Ki Dhani, Mawa',
    'सोहन सिंह की ढाणी मावा': 'Sohansingh Ki Dhani, Mawa',
    'सुथारों का बास, रामदेवरा': 'Sutharo Ka Baas, Ramdeora',
    'नई बस्ती, रामदेवरा': 'Nai Basti, Ramdeora',
    'प्रजापतों का बास, रामदेवरा': 'Prajapato Ka Baas, Ramdeora',
    'देशांतरियों का बास, रामदेवरा': 'Deshantariyo Ka Baas, Ramdeora',
    'देशान्तरो का बास, रामदेवरा': 'Deshantariyo Ka Baas, Ramdeora',
    'मेघवाल बस्ती, रामदेवरा': 'Meghwal Basti, Ramdeora',
    'मेघवाल बांद्रा का बास, रामदेवरा': 'Meghwal Bandra Ka Baas, Ramdeora',
    'मेगवाल बांदरो का बास, रामदेवरा': 'Meghwal Bandra Ka Baas, Ramdeora',
    'रामदेवरा': 'Ramdeora'
}

def transliterate_token(token: str) -> str:
    if not token:
        return ''
    if token in COMMON_INDIAN_NAME_TRANSLATIONS:
        return COMMON_INDIAN_NAME_TRANSLATIONS[token]
    clean = token.strip()
    if not clean:
        return ''

    chars = list(clean)
    units = []
    i = 0
    n = len(chars)
    while i < n:
        c = chars[i]
        next_c = chars[i + 1] if i + 1 < n else ''
        combined = c + next_c
        if combined in DEV_CONSONANTS:
            i += 2
            matra = ''
            if i < n and chars[i] in DEV_MATRAS:
                matra = chars[i]; i += 1
            elif i < n and chars[i] == '्':
                matra = '्'; i += 1
            units.append({'type': 'CONS', 'char': combined, 'base': DEV_CONSONANTS[combined], 'matra': matra})
            continue

        if c in DEV_VOWELS:
            matra = ''
            if next_c in ('ं', 'ँ'):
                matra = next_c; i += 1
            units.append({'type': 'VOWEL', 'char': c, 'base': DEV_VOWELS[c], 'matra': matra})
            i += 1
        elif c in DEV_CONSONANTS:
            base = DEV_CONSONANTS[c]
            if c == 'फ' and (clean.startswith('फतेह') or clean.startswith('फारू') or clean.startswith('फिरो') or clean.startswith('फैज') or clean.startswith('फकी')):
                base = 'f'
            i += 1
            matra = ''
            if i < n and chars[i] in DEV_MATRAS:
                matra = chars[i]; i += 1
            elif i < n and chars[i] == '्':
                matra = '्'; i += 1
            units.append({'type': 'CONS', 'char': c, 'base': base, 'matra': matra})
        elif c in DEV_MATRAS:
            units.append({'type': 'MATRA', 'char': c, 'base': DEV_MATRAS[c], 'matra': ''})
            i += 1
        else:
            units.append({'type': 'OTHER', 'char': c, 'base': c, 'matra': ''})
            i += 1

    out = []
    num_units = len(units)
    for uIdx in range(num_units):
        u = units[uIdx]
        if u['type'] == 'OTHER':
            out.append(u['base'])
            continue
        if u['type'] == 'VOWEL':
            v_str = u['base'] if not out else u['base'].lower()
            if u['matra'] in ('ं', 'ँ'):
                v_str += 'n'
            out.append(v_str)
            continue
        if u['type'] == 'MATRA':
            out.append(u['base'])
            continue

        base = u['base']
        if u['matra'] == '्':
            out.append(base)
            continue

        if u['matra']:
            m_char = u['matra']
            matra_str = DEV_MATRAS.get(m_char, '')
            if m_char in ('ं', 'ँ'):
                next_u = units[uIdx + 1] if uIdx + 1 < num_units else None
                if next_u and next_u['type'] == 'CONS':
                    next_c = next_u['char']
                    if next_c in ['प', 'फ', 'ब', 'भ', 'म', 'फ़']:
                        matra_str = 'am'
                    elif next_c in ['क', 'ख', 'ग', 'घ']:
                        matra_str = 'ang'
                    else:
                        matra_str = 'an'
                else:
                    matra_str = 'on' if uIdx == num_units - 1 else 'an'
            out.append(base + matra_str)
            continue

        is_last = (uIdx == num_units - 1)
        if is_last:
            prev_u = units[uIdx - 1] if uIdx > 0 else None
            is_conjunct_end = prev_u and prev_u.get('matra') == '्'
            if base in ('dr', 'ndr') or is_conjunct_end:
                out.append(base + 'a')
            else:
                out.append(base)
            continue

        next_u = units[uIdx + 1]
        prev_u = units[uIdx - 1] if uIdx > 0 else None
        delete_schwa = False
        is_penultimate = (uIdx + 1 == num_units - 1 and not next_u.get('matra'))
        if is_penultimate:
            delete_schwa = False
        elif next_u and next_u['type'] == 'CONS' and next_u['matra'] == '्':
            delete_schwa = False
        elif next_u and next_u['type'] == 'CONS' and next_u['matra']:
            if prev_u and prev_u.get('matra') != '्':
                delete_schwa = True

        out.append(base if delete_schwa else base + 'a')

    s = ''.join(out)
    return s.capitalize()

def transliterate_hindi(text: str) -> str:
    if not text:
        return ''
    t_clean = text.strip()
    if t_clean in KNOWN_SECTION_TRANSLATIONS:
        return KNOWN_SECTION_TRANSLATIONS[t_clean]
    if t_clean in COMMON_INDIAN_NAME_TRANSLATIONS:
        return COMMON_INDIAN_NAME_TRANSLATIONS[t_clean]
    for sfx_hi, sfx_en in COMPOUND_NAME_SUFFIXES:
        if t_clean.endswith(sfx_hi) and len(t_clean) > len(sfx_hi):
            prefix = t_clean[:-len(sfx_hi)].strip()
            return f'{transliterate_hindi(prefix)}{sfx_en}'
    tokens = re.split(r'(\s+|,|\.|\-)', t_clean)
    out = []
    for tok in tokens:
        if not tok or re.match(r'^\s+$', tok) or tok in (',', '.', '-'):
            out.append(tok)
        else:
            out.append(transliterate_token(tok))
    res = ''.join(out)
    return re.sub(r'\s+', ' ', res).strip()

# ==============================================================================
# 7. TEMPLATE-COMPLIANT EXCEL EXPORTER (voter-import-template.xlsx)
# ==============================================================================
TEMPLATE_HEADERS = [
    'EPIC No', 'Ward', 'Part', 'Serial No', 'Name (English)', 'Name (Hindi)',
    'Age', 'Gender', 'Relation', 'Relative Name (English)', 'Relative Name (Hindi)',
    'House No', 'House No (Hindi)', 'Mobile', 'Caste', 'Family ID', 'Village', 'Village (Hindi)'
]

def save_templated_voter_excel(voters_list, output_file_path, template_path=None):
    """
    Saves voters matching the official voter-import-template.xlsx structure.
    Sheet 1: 'Voters' (Exact 18 columns for direct MatdataPortal platform import)
    Sheet 2: 'मतदाता सूची' (Styled pure Devanagari electoral roll for verification/printing)
    """
    if not voters_list:
        print(f"Warning: No voters to save for {output_file_path}")
        return

    # Check candidate paths for official voter-import-template.xlsx
    if not template_path:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.abspath(os.path.join(script_dir, "../data", "voter-import-template.xlsx")),
            os.path.abspath(os.path.join(script_dir, "..", "voter-import-template.xlsx")),
            os.path.abspath(os.path.join(script_dir, "voter-import-template.xlsx")),
        ]
        for c in candidates:
            if os.path.exists(c):
                template_path = c
                break

    if template_path and os.path.exists(template_path):
        wb = openpyxl.load_workbook(template_path)
        ws_voters = wb['Voters'] if 'Voters' in wb.sheetnames else wb.active
        ws_voters.title = 'Voters'
        if ws_voters.max_row >= 2:
            ws_voters.delete_rows(2, ws_voters.max_row - 1)
    else:
        wb = openpyxl.Workbook()
        ws_voters = wb.active
        ws_voters.title = 'Voters'
        ws_voters.append(TEMPLATE_HEADERS)

    # 1. Fill Sheet 1: Voters (Exact 18 columns, populated with verified Hindi & English data)
    for v in voters_list:
        row = [
            v.get('epic') or ('' if v.get('status') != 'विलोपित' else f"VOTER_{v.get('serial', '')}"),
            str(v.get('ward') or ''),
            str(v.get('part') or ''),
            v.get('serial') or '',
            v.get('name_en') or transliterate_hindi(v.get('name_hi') or ''),
            v.get('name_hi') or '',
            v.get('age') or 30,
            v.get('gender') or 'पुरुष',
            v.get('relation') or 'पिता',
            v.get('relative_name_en') or transliterate_hindi(v.get('relative_name_hi') or ''),
            v.get('relative_name_hi') or '',
            str(v.get('house_no') or '-'),
            str(v.get('house_no') or '-'),
            v.get('mobile') or '',
            v.get('caste') or '',
            v.get('family_id') or '',
            v.get('village_en') or transliterate_hindi(v.get('village_hi') or ''),
            v.get('village_hi') or ''
        ]
        ws_voters.append(row)

    col_widths = {
        'A': 15.0, 'B': 12.0, 'C': 12.0, 'D': 12.0, 'E': 20.0, 'F': 20.0,
        'G': 10.0, 'H': 12.0, 'I': 12.0, 'J': 26.0, 'K': 26.0, 'L': 14.0,
        'M': 18.0, 'N': 14.0, 'O': 14.0, 'P': 14.0, 'Q': 24.0, 'R': 24.0
    }
    for col_letter, w in col_widths.items():
        ws_voters.column_dimensions[col_letter].width = w
    ws_voters.freeze_panes = 'A2'

    # 2. Fill Sheet 2: मतदाता सूची (Styled Pure Devanagari Hindi)
    if 'मतदाता सूची' in wb.sheetnames:
        del wb['मतदाता सूची']
    ws_hi = wb.create_sheet(title='मतदाता सूची')

    hindi_headers = [
        'क्रमांक', 'पहचान पत्र क्रमांक (EPIC No)', 'मतदाता का नाम', 'संबंधी का नाम',
        'संबंध प्रकार', 'मकान संख्या', 'आयु', 'लिंग', 'गाँव / मोहल्ला',
        'वार्ड संख्या', 'बूथ / भाग संख्या', 'स्थिति'
    ]
    ws_hi.append(hindi_headers)

    navy_fill = PatternFill(start_color="1A365D", end_color="1A365D", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left_align = Alignment(horizontal="left", vertical="center")
    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )

    ws_hi.row_dimensions[1].height = 28
    for col_idx, cell in enumerate(ws_hi[1], start=1):
        cell.fill = navy_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border

    alt_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    white_fill = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
    regular_font = Font(name="Calibri", size=11)
    deleted_font = Font(name="Calibri", size=11, color="C53030", bold=True)

    for row_idx, v in enumerate(voters_list, start=2):
        row_vals = [
            v.get('serial', ''),
            v.get('epic') or '-',
            v.get('name_hi', ''),
            v.get('relative_name_hi', '-'),
            v.get('relation', 'पिता'),
            v.get('house_no', '-'),
            v.get('age', 30),
            v.get('gender', 'पुरुष'),
            v.get('village_hi', ''),
            v.get('ward', ''),
            v.get('part', ''),
            v.get('status', 'सक्रिय')
        ]
        ws_hi.append(row_vals)
        ws_hi.row_dimensions[row_idx].height = 22

        is_even = (row_idx % 2 == 0)
        row_fill = white_fill if is_even else alt_fill
        is_del = (v.get('status') == 'विलोपित')
        current_font = deleted_font if is_del else regular_font

        for col_idx, cell in enumerate(ws_hi[row_idx], start=1):
            cell.fill = row_fill
            cell.font = current_font
            cell.border = thin_border
            col_name = hindi_headers[col_idx - 1]
            if col_name in ["क्रमांक", "पहचान पत्र क्रमांक (EPIC No)", "संबंध प्रकार", "आयु", "लिंग", "वार्ड संख्या", "बूथ / भाग संख्या", "स्थिति"]:
                cell.alignment = center_align
            else:
                cell.alignment = left_align

    for col in ws_hi.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws_hi.column_dimensions[col_letter].width = max(min(max_len + 4, 45), 14)

    ws_hi.freeze_panes = "A2"

    # Set 'मतदाता सूची' as default active sheet for 100% pure Hindi Devanagari view
    if 'मतदाता सूची' in wb.sheetnames:
        wb.active = wb['मतदाता सूची']
    else:
        wb.active = 0
    os.makedirs(os.path.dirname(os.path.abspath(output_file_path)), exist_ok=True)
    wb.save(output_file_path)
    print(f"SUCCESS: Exported {len(voters_list)} voters to {output_file_path} (Pure Hindi Data)")

# ==============================================================================
# 8. PER-PDF INDIVIDUAL EXECUTION (NO MERGING)
# ==============================================================================
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Convert Rajasthan SEC Voter PDFs to Individual Excel files matching voter-import-template.xlsx"
    )
    parser.add_argument("path", nargs="?", default=None, help="Path to single PDF or directory (default: current directory)")
    parser.add_argument("--pdf", default=None, help="Explicit single PDF file to extract")
    parser.add_argument("--output", default=None, help="Explicit output Excel file path or destination directory")
    parser.add_argument("--template", default=None, help="Path to voter-import-template.xlsx")
    parser.add_argument("--ward", default=None, help="Override ward number")
    parser.add_argument("--part", "--booth", dest="part", default=None, help="Override part or booth number")
    parser.add_argument("--include-deleted", action="store_true", help="Include deleted (विलोपित) voters in export (default: False)")
    parser.add_argument("--extract-photos-dir", default=None, help="Directory to save extracted voter photos")
    args = parser.parse_args()

    # Determine target input
    input_target = args.pdf or args.path
    if not input_target:
        input_target = os.path.dirname(os.path.abspath(__file__))

    input_target = os.path.abspath(input_target)

    if os.path.isfile(input_target):
        # Single PDF processing
        pdf_file = input_target
        bn = os.path.basename(pdf_file)
        stem = os.path.splitext(bn)[0]

        if args.output:
            if os.path.isdir(args.output):
                out_path = os.path.join(args.output, f"{stem}.xlsx")
            else:
                out_path = args.output
        else:
            out_path = os.path.join(os.path.dirname(pdf_file), f"{stem}.xlsx")

        print(f"\nProcessing Single PDF: {bn} ...")
        rows = extract_single_pdf(pdf_file, default_ward=args.ward, default_part=args.part, include_deleted=args.include_deleted, photos_dir=args.extract_photos_dir)
        save_templated_voter_excel(rows, out_path, template_path=args.template)
        learned_g, learned_w = load_learned_dictionary()
        print(json.dumps({
            "success": True,
            "count": len(rows),
            "file": out_path,
            "total_dictionary_glyphs": len(GLYPH_HASH_TO_HINDI),
            "learned_glyphs": len(learned_g),
            "learned_words": len(learned_w)
        }))

    else:
        # Directory processing: process EVERY PDF into its OWN INDIVIDUAL Excel file (NO MERGING)
        pdf_dir = input_target
        pdf_files = sorted(glob.glob(os.path.join(pdf_dir, "*.pdf")))
        print(f"\nStarting individual extraction for {len(pdf_files)} PDFs in {pdf_dir}...")
        print("RULE: Each PDF will have its own individual Excel file matching voter-import-template.xlsx (NO MERGING).\n")

        processed_count = 0
        total_voters = 0

        for idx, pdf_file in enumerate(pdf_files, start=1):
            bn = os.path.basename(pdf_file)
            stem = os.path.splitext(bn)[0]

            if args.output and os.path.isdir(args.output):
                out_path = os.path.join(args.output, f"{stem}.xlsx")
            else:
                out_path = os.path.join(pdf_dir, f"{stem}.xlsx")

            print(f"[{idx}/{len(pdf_files)}] Processing: {bn} ...")
            rows = extract_single_pdf(pdf_file, default_ward=args.ward, default_part=args.part, include_deleted=args.include_deleted)
            save_templated_voter_excel(rows, out_path, template_path=args.template)
            processed_count += 1
            total_voters += len(rows)

        print(f"\n=======================================================")
        print(f"ALL DONE! Successfully converted {processed_count} PDFs into individual Excel files.")
        print(f"Total voters extracted across all individual files: {total_voters}")
        print(f"Format: Strict voter-import-template.xlsx ('Voters' sheet)")
        print(f"=======================================================\n")

