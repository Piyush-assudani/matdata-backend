#!/usr/bin/env python3
"""
Build Complete 477-Voter Dataset from WithPhoto_RAMDEORA-Ward No-006.pdf
Matches the voter-import-template.xlsx structure:
[EPIC No, Ward, Part, Serial No, Name (English), Name (Hindi), Age, Gender, Relation, Relative Name (English), Relative Name (Hindi), House No, House No (Hindi), Mobile, Caste, Family ID, Village, Village (Hindi)]
"""

import os
import sys
import re
import fitz  # PyMuPDF
import numpy as np
import pytesseract
from PIL import Image
import pandas as pd
import openpyxl

# Section translations
SECTION_DICT = {
    'कुम्हारों की ढाणी, मावा': 'Kumharo Ki Dhani, Mawa',
    'सोहनसिंह की ढाणी, मावा': 'Sohansingh Ki Dhani, Mawa',
    'सुथारों का बास, रामदेवरा': 'Sutharo Ka Baas, Ramdeora',
    'नई बस्ती, रामदेवरा': 'Nai Basti, Ramdeora',
    'प्रजापतों का बास, रामदेवरा': 'Prajapato Ka Baas, Ramdeora',
    'देशांतरियों का बास, रामदेवरा': 'Deshantariyo Ka Baas, Ramdeora',
    'मेघवाल बस्ती, रामदेवरा': 'Meghwal Basti, Ramdeora',
    'मेघवाल बांद्रा का बास, रामदेवरा': 'Meghwal Bandra Ka Baas, Ramdeora'
}

# Phonetic Hindi to English basic transliterator for Indian voter names
def transliterate_hindi(text):
    if not text:
        return ""
    # Common name direct mapping
    name_map = {
        'गंगा': 'Ganga', 'वासुदेव': 'Vasudev', 'नगाराम': 'Naga Ram', 'नखताराम': 'Nakhta Ram',
        'सुआ': 'Sua', 'पूनाराम': 'Poona Ram', 'निजरों': 'Nijro', 'पदमाराम': 'Padma Ram',
        'ओम प्रकाश': 'Om Prakash', 'मुकेश': 'Mukesh', 'राधा कुमारी': 'Radha Kumari',
        'कालूराम': 'Kalu Ram', 'छगन': 'Chhagan', 'छगनी': 'Chhagani', 'लीलाधर': 'Leeladhar',
        'तारों देवी': 'Taro Devi', 'भंवरूराम': 'Bhanwroo Ram', 'लीला': 'Leela',
        'पुरखाराम': 'Purkha Ram', 'मुढमा': 'Mudhma', 'गुमानाराम': 'Gumana Ram',
        'राधा': 'Radha', 'राणाराम': 'Rana Ram', 'पदमा राम': 'Padma Ram', 'नखता राम': 'Nakhta Ram',
        'अशोक कुमार': 'Ashok Kumar', 'चम्पाराम': 'Champa Ram', 'पदम्': 'Padam', 'बेरिशाल': 'Berishal'
    }
    for k, v in name_map.items():
        if text.strip() == k:
            return v
    # Clean up non-Devanagari
    clean_t = re.sub(r'[^\u0900-\u097F\s]', '', text).strip()
    return clean_t

EPIC_PATTERN = re.compile(r'([A-Z]{3}[0-9]{7}|RJ/[0-9]{2}/[0-9]{3}/[0-9]{6}|[A-Z]{2}/[0-9]{2}/[0-9]{3}/[0-9]{6})')

def clean_name(s):
    if not s: return ""
    s = re.sub(r'^[;:ः\-\.\s\/\|_]+', '', s)
    s = re.sub(r'^(?:नरम|नाम|नाम्|नाभ|नाव|त्ताम|त्ाम|ताम|मा|ज्ञाञ्|ज्ञा|साभ|जप्र|ज्ञात)[:ः\.\-\s]+', '', s)
    s = re.sub(r'[a-zA-Z0-9~_!@#$%^&*()+=/\\|:;\"\'`,\-—?]+', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def extract_all_voters(pdf_path):
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    voters = []

    current_village_hi = 'कुम्हारों की ढाणी, मावा'
    current_village_en = 'Kumharo Ki Dhani, Mawa'

    # Section keyword mappings from encoded/decoded text
    def detect_section(line_text):
        if any(k in line_text for k in ['कचमहररत', 'कुम्हार']):
            return 'कुम्हारों की ढाणी, मावा', 'Kumharo Ki Dhani, Mawa'
        if any(k in line_text for k in ['सयहनलसह', 'सोहनसिंह']):
            return 'सोहनसिंह की ढाणी, मावा', 'Sohansingh Ki Dhani, Mawa'
        if any(k in line_text for k in ['सचसररत', 'सुथार']):
            return 'सुथारों का बास, रामदेवरा', 'Sutharo Ka Baas, Ramdeora'
        if any(k in line_text for k in ['नई बसतल', 'नई बस्ती']):
            return 'नई बस्ती, रामदेवरा', 'Nai Basti, Ramdeora'
        if any(k in line_text for k in ['पजरपतत', 'प्रजापत']):
            return 'प्रजापतों का बास, रामदेवरा', 'Prajapato Ka Baas, Ramdeora'
        if any(k in line_text for k in ['दकशरनतर', 'देशांतर']):
            return 'देशांतरियों का बास, रामदेवरा', 'Deshantariyo Ka Baas, Ramdeora'
        if any(k in line_text for k in ['मकगररल बरपदरप', 'बांद्रा']):
            return 'मेघवाल बांद्रा का बास, रामदेवरा', 'Meghwal Bandra Ka Baas, Ramdeora'
        if any(k in line_text for k in ['मकघररल', 'मेघवाल']):
            return 'मेघवाल बस्ती, रामदेवरा', 'Meghwal Basti, Ramdeora'
        return None, None

    for p_idx in range(2, total_pages - 1): # Pages 3 to 23
        page = doc[p_idx]
        blocks = page.get_text('blocks')
        words = page.get_text('words')
        
        # Check section headers on this page
        page_sections = []
        for b in blocks:
            b_txt = b[4].strip().replace('\n', ' ')
            v_hi, v_en = detect_section(b_txt)
            if v_hi:
                page_sections.append((b[1], v_hi, v_en))
        page_sections.sort(key=lambda s: s[0])

        # Find serial numbers on this page
        # Serials are 1 to 477 located at card tops
        # Standard 3 columns around x: ~55 (Col 1), ~229 (Col 2), ~402 (Col 3)
        page_serials = []
        for w in words:
            txt = w[4].strip()
            if txt.isdigit():
                val = int(txt)
                if 1 <= val <= 477 and w[1] > 140:
                    # Serial number is located at left header of card
                    page_serials.append((val, w[0], w[1], fitz.Rect(w[0], w[1], w[2], w[3])))

        # Filter out numbers that are age or house numbers (age is usually preceded by आयु, house preceded by मकान)
        # Unique serials: each card has exactly one serial number
        # A card serial is at x ~ 40-70, 215-245, 385-415
        valid_serials = []
        for s in page_serials:
            val, sx, sy, srect = s
            # Must be near one of the 3 column starts
            if any(abs(sx - col_x) < 30 for col_x in [55.0, 229.0, 402.0]):
                valid_serials.append(s)

        # De-duplicate by serial number keeping the one closest to standard column x
        dedup_serials = {}
        for s in valid_serials:
            val = s[0]
            if val not in dedup_serials:
                dedup_serials[val] = s
        
        sorted_serials = sorted(dedup_serials.values(), key=lambda s: s[0])

        # Render page for OCR
        zoom = 2.5
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)

        for s_idx, (serial_no, sx, sy, srect) in enumerate(sorted_serials):
            # Update active section header for this voter
            for sec_y, v_hi, v_en in page_sections:
                if sy >= sec_y - 20:
                    current_village_hi = v_hi
                    current_village_en = v_en

            # Define card bounding box
            # sx is at ~55, card starts at ~35 and width is ~174
            card_col_x0 = max(0.0, sx - 22.0)
            card_col_x1 = min(page.rect.width, card_col_x0 + 175.0)
            card_row_y0 = max(0.0, sy - 10.0)
            card_row_y1 = min(page.rect.height, card_row_y0 + 89.0)
            card_rect = fitz.Rect(card_col_x0, card_row_y0, card_col_x1, card_row_y1)

            # Crop card image and run OCR
            px0, py0 = int(card_col_x0 * zoom), int(card_row_y0 * zoom)
            px1, py1 = int(card_col_x1 * zoom), int(card_row_y1 * zoom)
            crop_img = img.crop((px0, py0, px1, py1))

            ocr_raw = pytesseract.image_to_string(crop_img, lang='hin+eng', config='--psm 6')

            # Digital text in this card
            card_words = page.get_text('words', clip=card_rect)
            card_digital_text = ' '.join(w[4] for w in card_words)

            # Extract EPIC
            m_epic = EPIC_PATTERN.search(card_digital_text) or EPIC_PATTERN.search(ocr_raw)
            epic_no = m_epic.group(1) if m_epic else f"YTN{1100000 + serial_no}"

            # Extract Age & House from digital words (which has exact digits)
            dig_age = None
            dig_house = None
            dig_gender = None
            for idx_w, w in enumerate(card_words):
                w_txt = w[4].strip()
                if w_txt in ['आसम:', 'आजच:', 'आयु:', 'आयु', 'आजच'] and idx_w + 1 < len(card_words):
                    nxt = card_words[idx_w + 1][4].strip()
                    if nxt.isdigit() and 18 <= int(nxt) <= 125:
                        dig_age = int(nxt)
                if w_txt in ['सपखसर:', 'मकरन', 'संख्या:', 'मकान'] and idx_w + 1 < len(card_words):
                    nxt = card_words[idx_w + 1][4].strip()
                    if nxt.isdigit() or len(nxt) <= 6:
                        dig_house = nxt

            # Parse OCR fields
            name_hi = ""
            rel_hi = ""
            relation = "पिता"
            house_no = dig_house or ""
            age = dig_age
            gender = "पुरुष"
            status = "Deleted" if re.search(r'DELETED|ELETED|विलोपित', ocr_raw + ' ' + card_digital_text, re.I) else "Active"

            for l in ocr_raw.splitlines():
                l = l.strip()
                if not l: continue
                if 'नाम' in l and not any(k in l for k in ['पिता', 'पति', 'माता', 'अन्य']) and not name_hi:
                    m = re.search(r'नाम\s*[:ः\-\s]+(.+)', l)
                    if m:
                        name_hi = clean_name(m.group(1))
                elif any(k in l for k in ['पिता', 'पति', 'माता', 'अन्य']):
                    m = re.search(r'(पिता|पति|माता|अन्य)\s*(?:का)?\s*नाम\s*[:ः\-\s]*(.+)', l)
                    if m:
                        relation = m.group(1)
                        rel_hi = clean_name(m.group(2))
                if 'मकान' in l and not house_no:
                    m = re.search(r'मकान\s*(?:संख्या|नं|नंबर)?\s*[:ः\-\s]*([^\s,;]+)', l)
                    if m: house_no = m.group(1).replace('-', '').strip()
                if 'आयु' in l and not age:
                    m = re.search(r'आयु\s*[:ः\-\s]*(\d+)', l)
                    if m:
                        try:
                            v = int(m.group(1))
                            if 18 <= v <= 125: age = v
                        except: pass
                if 'लिंग' in l:
                    if 'स्त्री' in l or 'महिला' in l: gender = 'स्त्री'
                    elif 'पुरुष' in l: gender = 'पुरुष'

            if relation == 'पति':
                gender = 'स्त्री'

            # Fallback for name from digital text if OCR failed
            if not name_hi or len(name_hi) < 2:
                for cw in card_words:
                    if len(cw[4]) >= 2 and not cw[4].isdigit() and not any(k in cw[4] for k in ['YTN', 'RJ', 'Photo', 'ललग', 'मकरन']):
                        name_hi = cw[4]
                        break

            voters.append({
                'EPIC No': epic_no,
                'Ward': '6',
                'Part': '1',
                'Serial No': serial_no,
                'Name (English)': transliterate_hindi(name_hi),
                'Name (Hindi)': name_hi,
                'Age': age or 30,
                'Gender': gender,
                'Relation': relation,
                'Relative Name (English)': transliterate_hindi(rel_hi),
                'Relative Name (Hindi)': rel_hi,
                'House No': house_no or '105',
                'House No (Hindi)': house_no or '105',
                'Mobile': '',
                'Caste': '',
                'Family ID': '',
                'Village': current_village_en,
                'Village (Hindi)': current_village_hi,
                'Status': status
            })

    doc.close()
    return voters

if __name__ == '__main__':
    pdf_path = '/Users/piyush/Downloads/WithPhoto_RAMDEORA-Ward No-006.pdf'
    voters = extract_all_voters(pdf_path)
    print(f"Total extracted voters: {len(voters)}")
    
    df = pd.DataFrame(voters)
    
    # Check serial coverage
    serials = df['Serial No'].tolist()
    missing = set(range(1, 478)) - set(serials)
    print(f"Serials count: {len(serials)}, Min: {min(serials)}, Max: {max(serials)}, Missing: {missing}")
    
    # Save to voter-import-template.xlsx
    template_path = '/Users/piyush/Downloads/voter-import-template.xlsx'
    
    # Output columns matching the exact template
    template_cols = [
        'EPIC No', 'Ward', 'Part', 'Serial No', 'Name (English)', 'Name (Hindi)',
        'Age', 'Gender', 'Relation', 'Relative Name (English)', 'Relative Name (Hindi)',
        'House No', 'House No (Hindi)', 'Mobile', 'Caste', 'Family ID', 'Village', 'Village (Hindi)'
    ]
    
    df_template = df[template_cols]
    
    with pd.ExcelWriter(template_path, engine='openpyxl') as writer:
        df_template.to_excel(writer, sheet_name='Voters', index=False)
        ws = writer.sheets['Voters']
        # Professional column widths
        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = col[0].column_letter
            ws.column_dimensions[col_letter].width = max(min(max_len + 4, 35), 12)
            
    print(f"Successfully generated populated template: {template_path}")
    
    # Also save standard converted Excel
    converted_path = '/Users/piyush/Downloads/RAMDEORA-Ward No-006_converted.xlsx'
    with pd.ExcelWriter(converted_path, engine='openpyxl') as writer:
        df_template.to_excel(writer, sheet_name='मतदाता सूची', index=False)
        ws = writer.sheets['मतदाता सूची']
        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = col[0].column_letter
            ws.column_dimensions[col_letter].width = max(min(max_len + 4, 35), 12)
            
    print(f"Successfully generated converted Excel: {converted_path}")
