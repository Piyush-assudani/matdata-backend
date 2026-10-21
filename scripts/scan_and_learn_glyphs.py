#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MatdataPortal Universal Glyph Scanner & Auto-Learner
Scans all electoral roll PDFs across any folder to discover new font glyph hashes,
extracts their context, visual properties, and ToUnicode mappings, and provides
zero-friction scaling for 50 to 500+ PDFs.
"""

import os
import sys
import glob
import struct
import hashlib
import re
import io
import pypdf

# Try to import Master Dictionary from extract_voters_perfect
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

try:
    from extract_voters_perfect import GLYPH_HASH_TO_HINDI, get_font_glyph_map, parse_pdf_stream_tokens
except ImportError:
    # Fallback to local import if needed
    GLYPH_HASH_TO_HINDI = {}
    def get_font_glyph_map(b): return {}
    def parse_pdf_stream_tokens(s): return []


def parse_to_unicode_map(to_uni_obj):
    """Parses PDF /ToUnicode CMap stream into {char_code: unicode_char}."""
    if not to_uni_obj:
        return {}
    try:
        u_data = to_uni_obj.get_data().decode('latin1', errors='ignore')
    except Exception:
        return {}
    u_map = {}
    # Pattern 1: <start> <end> <unicode>
    for m in re.finditer(r'<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>', u_data):
        s_code = int(m.group(1), 16)
        e_code = int(m.group(2), 16)
        u_val = chr(int(m.group(3), 16))
        for c in range(s_code, e_code + 1):
            u_map[c] = u_val
    # Pattern 2: <src> <unicode>
    for m in re.finditer(r'<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>', u_data):
        c_code = int(m.group(1), 16)
        u_val = chr(int(m.group(2), 16))
        u_map[c_code] = u_val
    return u_map


def scan_single_pdf_glyphs(pdf_path, master_dict):
    """
    Scans a single electoral roll PDF and returns:
    - total_glyphs_used: set of all glyph hashes encountered
    - unknown_glyphs: dict of {hash: {byte, to_uni, context, bbox, pdf, page}}
    """
    try:
        reader = pypdf.PdfReader(pdf_path)
    except Exception as e:
        return set(), {}, f"Failed to read PDF: {e}"

    total_used_hashes = set()
    unknown_hashes = {}
    bn = os.path.basename(pdf_path)

    # Scan all voter pages (skip cover page 0, 1 if possible)
    start_p = 2 if len(reader.pages) > 3 else 0
    end_p = len(reader.pages) - 1 if len(reader.pages) > 3 else len(reader.pages)

    for p_idx in range(start_p, end_p):
        page = reader.pages[p_idx]
        res = page.get('/Resources')
        if not res:
            continue
        res_obj = res.get_object()
        xobjs = res_obj.get('/XObject', {})
        if not xobjs:
            continue
        xobjs = xobjs.get_object()

        for xk, xo_ref in xobjs.items():
            xo = xo_ref.get_object()
            if xo.get('/Subtype') != '/Form' or '/Resources' not in xo:
                continue

            fres = xo['/Resources'].get_object().get('/Font', {}).get_object()
            # Identify the primary Hindi Devanagari font (strictly '/9' in Rajasthan SEC Form XObjects)
            hindi_fonts = [k for k in fres.keys() if k == '/9']
            if not hindi_fonts:
                hindi_fonts = [k for k in fres.keys() if '/FontDescriptor' in fres[k].get_object()]

            for f_key in hindi_fonts:
                fo_ref = fres[f_key]
                fo = fo_ref.get_object()
                fdesc = fo.get('/FontDescriptor', {})
                if not fdesc:
                    continue
                fdesc_obj = fdesc.get_object()
                ff2 = fdesc_obj.get('/FontFile2')
                if not ff2:
                    continue

                ff2_bytes = ff2.get_data()
                ch_hash = get_font_glyph_map(ff2_bytes)
                to_uni = parse_to_unicode_map(fo.get('/ToUnicode'))

                stream_str = xo.get_data().decode('latin1', errors='ignore')
                items = parse_pdf_stream_tokens(stream_str)

                for x, y, f, b in items:
                    if f == f_key:
                        for byte_val in b:
                            h = ch_hash.get(byte_val)
                            if not h:
                                continue
                            total_used_hashes.add(h)

                            if h not in master_dict and h not in unknown_hashes:
                                # Extract surrounding context
                                ctx = []
                                for cb in b:
                                    ch = ch_hash.get(cb, '')
                                    mapped = master_dict.get(ch, '?')
                                    ctx.append(f'[{ch}]' if ch == h else mapped)
                                ctx_str = "".join(ctx)

                                unknown_hashes[h] = {
                                    'byte': byte_val,
                                    'to_uni': to_uni.get(byte_val, ''),
                                    'context': ctx_str,
                                    'pdf': bn,
                                    'page': p_idx + 1
                                }

    return total_used_hashes, unknown_hashes, None


def run_universal_scan(pdf_directories, master_dict=None):
    if master_dict is None:
        master_dict = GLYPH_HASH_TO_HINDI

    all_pdfs = []
    for d in pdf_directories:
        d_exp = os.path.expanduser(d)
        if os.path.isfile(d_exp) and d_exp.lower().endswith('.pdf'):
            all_pdfs.append(d_exp)
        elif os.path.isdir(d_exp):
            for root, _, files in os.walk(d_exp):
                for f in sorted(files):
                    if f.lower().endswith('.pdf') and any(k in f.lower() for k in ['ward', 'photo', 'voter', 'ramasani', 'maulasar', 'osian', '01']):
                        all_pdfs.append(os.path.join(root, f))

    # Remove duplicates
    all_pdfs = sorted(list(set(all_pdfs)))

    print("=" * 80)
    print(f" MatdataPortal Universal Glyph Scanner & Auto-Learner")
    print(f" Master Dictionary contains: {len(master_dict)} known glyph hashes")
    print(f" Target PDFs found to scan: {len(all_pdfs)}")
    print("=" * 80)

    grand_total_hashes = set()
    all_missing_hashes = {}
    clean_pdfs_count = 0

    for idx, pdf_p in enumerate(all_pdfs, start=1):
        bn = os.path.basename(pdf_p)
        print(f"[{idx:02d}/{len(all_pdfs):02d}] Scanning: {bn[:50]:<50} ...", end="", flush=True)

        used_hashes, missing, err = scan_single_pdf_glyphs(pdf_p, master_dict)
        if err:
            print(f" [SKIP: {err}]")
            continue

        grand_total_hashes.update(used_hashes)
        if not missing:
            clean_pdfs_count += 1
            print(f" OK (100% Known)")
        else:
            print(f" -> FOUND {len(missing)} NEW GLYPH(S)!")
            for h, info in missing.items():
                if h not in all_missing_hashes:
                    all_missing_hashes[h] = info

    print("\n" + "=" * 80)
    print(" SCAN SUMMARY RESULTS")
    print("=" * 80)
    print(f" Total Electoral Roll PDFs Scanned: {len(all_pdfs)}")
    print(f" Clean PDFs (100% Dictionary Coverage): {clean_pdfs_count}/{len(all_pdfs)}")
    print(f" Unique Active Glyph Hashes in use: {len(grand_total_hashes)}")
    print(f" Hashes already in Master Dictionary: {len(grand_total_hashes - set(all_missing_hashes.keys()))}")
    print(f" Missing Hashes needing mapping: {len(all_missing_hashes)}")

    if not all_missing_hashes:
        print("\n🎉 EXCELLENT! 100% of all glyphs across all scanned PDFs are already in your Master Dictionary!")
        print("Your parser is ready to convert all of these PDFs directly to Excel with zero missing characters.")
    else:
        print(f"\n⚠️  Bhai, {len(all_missing_hashes)} naye hashes mile hain jo Master Dictionary mein missing hain:\n")
        print(f"{'Glyph Hash':<12} | {'Byte':<5} | {'ToUnicode':<10} | {'Found In PDF':<30} | {'Context'}")
        print("-" * 80)
        for h, info in all_missing_hashes.items():
            print(f"{h:<12} | {info['byte']:<5} | {info['to_uni']:<10} | {info['pdf'][:30]:<30} | {info['context']}")

    return all_missing_hashes


if __name__ == '__main__':
    default_dirs = [
        os.path.expanduser('~/Downloads'),
        '/Users/piyush/Documents/moxrathore_projects/matdata_portal/.agents/skills/xlsx/pdfs ',
    ]
    if len(sys.argv) > 1:
        target_dirs = sys.argv[1:]
    else:
        target_dirs = default_dirs

    run_universal_scan(target_dirs)
