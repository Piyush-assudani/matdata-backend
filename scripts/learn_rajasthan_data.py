#!/usr/bin/env python3
"""
learn_rajasthan_data.py
-----------------------
Extracts, structures, and learns all Rajasthan electoral, demographic, 
geographic, and linguistic data from public open-source repositories:
1. in-rolls/local_elections_rajasthan (Sarpanch candidates, ward winners, GPs)
2. datameet/indian_village_boundaries (RJ village database)
3. ECI / Wikipedia official Rajasthan 200 Assembly Constituencies

Generates:
- backend/data/rajasthan_constituencies.json (All 200 Assembly Constituencies)
- backend/data/rajasthan_geography.json (Districts -> Samitis -> Gram Panchayats)
- backend/data/rajasthan_villages.json (28,000+ Rajasthan villages & locality patterns)
- backend/data/rajasthan_castes.json (Rajasthan community & caste taxonomy)
- backend/data/master_indian_names.json (Expanded master lexicon of Rajasthani names)
"""

import os
import sys
import io
import re
import json
import urllib.request
from collections import defaultdict, Counter
import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
os.makedirs(DATA_DIR, exist_ok=True)

print("=" * 60)
print("LEARNING RAJASTHAN ELECTORAL & GEOGRAPHIC DATA")
print("=" * 60)

# ==============================================================================
# 1. Official 200 Rajasthan Assembly Constituencies (Vidhan Sabha)
# ==============================================================================
print("\n[Step 1/5] Fetching 200 Rajasthan Assembly Constituencies...")
try:
    wiki_url = 'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_constituencies_of_the_Rajasthan_Legislative_Assembly&format=json&prop=wikitext'
    req = urllib.request.Request(wiki_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        wiki_data = json.loads(resp.read().decode())
        wikitext = wiki_data['parse']['wikitext']['*']

    table_start = wikitext.find('{| class="wikitable sortable"\n|+Constituencies')
    table_end = wikitext.find('|}', table_start)
    table_text = wikitext[table_start:table_end]

    rows = table_text.split('\n|-')
    constituencies = []
    active_res = ['', 0]
    active_dist = ['', 0]
    active_pc = ['', 0]

    # Hindi names mapping for Rajasthan constituencies
    AC_HINDI_NAMES = {
        'Sadulshahar': 'सादुलशहर', 'Ganganagar': 'गंगानगर', 'Karanpur': 'करणपुर', 'Suratgarh': 'सूरतगढ़',
        'Raisinghnagar': 'रायसिंहनगर', 'Anupgarh': 'अनूपगढ़', 'Sangaria': 'संगरिया', 'Hanumangarh': 'हनुमानगढ़',
        'Pilibanga': 'पीलीबंगा', 'Nohar': 'नोहर', 'Bhadra': 'भादरा', 'Khajuwala': 'खाजूवाला',
        'Bikaner West': 'बीकानेर पश्चिम', 'Bikaner East': 'बीकानेर पूर्व', 'Kolayat': 'कोलायत',
        'Lunkaransar': 'लूणकरणसर', 'Dungargarh': 'डूंगरगढ़', 'Nokha': 'नोखा', 'Sadulpur': 'सादुलपुर',
        'Taranagar': 'तारानगर', 'Sardarshahar': 'सरदारशहर', 'Churu': 'चुरू', 'Ratangarh': 'रतनगढ़',
        'Sujangarh': 'सुजानगढ़', 'Pilani': 'पिलानी', 'Surajgarh': 'सूरजगढ़', 'Jhunjhunu': 'झुंझुनू',
        'Mandawa': 'मंडावा', 'Nawalgarh': 'नवलगढ़', 'Udaipurwati': 'उदयपुरवाटी', 'Khetri': 'खेतड़ी',
        'Fatehpur': 'फतेहपुर', 'Lachmangarh': 'लक्ष्मणगढ़', 'Dhod': 'धोद', 'Sikar': 'सीकर',
        'Dantaramgarh': 'दांतारामगढ़', 'Khandela': 'खंडेला', 'Srimadhopur': 'श्रीमाधोपुर',
        'Kotputli': 'कोटपूतली', 'Viratnagar': 'विराटनगर', 'Shahpura': 'शाहपुरा', 'Chomu': 'चौमूं',
        'Phulera': 'फुलेरा', 'Dudu': 'दूदू', 'Jhotwara': 'झोटवाड़ा', 'Amber': 'आमेर',
        'Jamwa Ramgarh': 'जमवारामगढ़', 'Hawa Mahal': 'हवामहल', 'Vidhyadhar Nagar': 'विद्याधर नगर',
        'Civil Lines': 'सिविल लाइन्स', 'Kishanpole': 'किशनपोल', 'Adarsh Nagar': 'आदर्श नगर',
        'Malviya Nagar': 'मालवीय नगर', 'Sanganer': 'सांगानेर', 'Bagru': 'बगरू', 'Bassi': 'बस्सी',
        'Chaksu': 'चाकसू', 'Tijara': 'तिजारा', 'Kishangarh Bas': 'किशनगढ़ बास', 'Mundawar': 'मुंडावर',
        'Behror': 'बहरोड़', 'Bansur': 'बानसूर', 'Thanagazi': 'थानागाजी', 'Alwar Rural': 'अलवर ग्रामीण',
        'Alwar Urban': 'अलवर शहर', 'Ramgarh': 'रामगढ़', 'Rajgarh Laxmangarh': 'राजगढ़ लक्ष्मणगढ़',
        'Kathumar': 'कठूमर', 'Kaman': 'कामा', 'Nagar': 'नगर', 'Deeg-Kumher': 'डीग-कुम्हेर',
        'Bharatpur': 'भरतपुर', 'Nadbai': 'नदबई', 'Weir': 'वैर', 'Bayana': 'बयाना',
        'Baseri': 'बसेड़ी', 'Bari': 'बाड़ी', 'Dholpur': 'धौलपुर', 'Rajakhera': 'राजाखेड़ा',
        'Todabhim': 'टोडाभीम', 'Hindaun': 'हिण्डौन', 'Karauli': 'करौली', 'Sapotra': 'सपोटरा',
        'Bandikui': 'बांदीकुई', 'Mahwa': 'महवा', 'Sikrai': 'सिकराय', 'Dausa': 'दौसा',
        'Lalsot': 'लालसोट', 'Bamanwas': 'बामनवास', 'Sawai Madhopur': 'सवाई माधोपुर',
        'Khandar': 'खण्डार', 'Malpura': 'मालपुरा', 'Niwai': 'निवाई', 'Tonk': 'टोंक',
        'Deoli-Uniara': 'देवली-उनियारा', 'Kishangarh': 'किशनगढ़', 'Pushkar': 'पुष्कर',
        'Ajmer North': 'अजमेर उत्तर', 'Ajmer South': 'अजमेर दक्षिण', 'Nasirabad': 'नसीराबाद',
        'Beawar': 'ब्यावर', 'Masuda': 'मसूदा', 'Kekri': 'केकड़ी', 'Ladnun': 'लाडनूं',
        'Deedwana': 'डीडवाना', 'Jayal': 'जायल', 'Nagaur': 'नागौर', 'Khinvsar': 'खींवसर',
        'Merta': 'मेड़ता', 'Degana': 'डेगाना', 'Makrana': 'मकराना', 'Parbatsar': 'परबतसर',
        'Nawan': 'नावां', 'Jaitaran': 'जैतारण', 'Sojat': 'सोजत', 'Pali': 'पाली',
        'Marwar Junction': 'मारवाड़ जंक्शन', 'Bali': 'बाली', 'Sumerpur': 'सुमेरपुर',
        'Phalodi': 'फलौदी', 'Lohawat': 'लोहावट', 'Shergarh': 'शेरगढ़', 'Osian': 'ओसियां',
        'Bhopalgarh': 'भोपालगढ़', 'Sardarpura': 'सरदारपुरा', 'Jodhpur': 'जोधपुर',
        'Soorsagar': 'सूरसागर', 'Luni': 'लूणी', 'Bilara': 'बिलाड़ा', 'Jaisalmer': 'जैसलमेर',
        'Pokaran': 'पोकरण', 'Sheo': 'शिव', 'Barmer': 'बाड़मेर', 'Baytoo': 'बायतू',
        'Pachpadra': 'पचपदरा', 'Siwana': 'सिवाना', 'Gudamalani': 'गुड़ामालानी', 'Chohtan': 'चौहटन',
        'Ahore': 'आहोर', 'Jalore': 'जालोर', 'Bhinmal': 'भीनमाल', 'Sanchore': 'सांचौर',
        'Raniwara': 'रानीवाड़ा', 'Sirohi': 'सिरोही', 'Pindwara-Abu': 'पिंडवाड़ा-आबू',
        'Reodar': 'रेवदर', 'Gogunda': 'गोगुंदा', 'Jhadol': 'झाड़ोल', 'Kherwara': 'खेरवाड़ा',
        'Udaipur Rural': 'उदयपुर ग्रामीण', 'Udaipur': 'उदयपुर', 'Mavli': 'मावली',
        'Vallabhnagar': 'वल्लभनगर', 'Salumber': 'सलूम्बर', 'Dhariawad': 'धरियावद',
        'Dungarpur': 'डूंगरपुर', 'Aspur': 'आसपुर', 'Sagwara': 'सागवाड़ा', 'Chorasi': 'चौरासी',
        'Ghatol': 'घाटोल', 'Garhi': 'गढ़ी', 'Banswara': 'बांसवाड़ा', 'Bagidora': 'बागीदोरा',
        'Kushalgarh': 'कुशलगढ़', 'Kapasan': 'कपासन', 'Begun': 'बेगूं', 'Chittorgarh': 'चित्तौड़गढ़',
        'Nimbahera': 'निम्बाहेड़ा', 'Bari Sadri': 'बड़ी सादड़ी', 'Pratapgarh': 'प्रतापगढ़',
        'Bhim': 'भीम', 'Kumbhalgarh': 'कुम्भलगढ़', 'Rajsamand': 'राजसमंद', 'Nathdwara': 'नाथद्वारा',
        'Asind': 'आसीन्द', 'Mandal': 'मांडल', 'Sahada': 'सहाड़ा', 'Bhilwara': 'भीलवाड़ा',
        'Jahazpur': 'जहाजपुर', 'Mandalgarh': 'मांडलगढ़', 'Hindoli': 'हिण्डोली', 'Bundi': 'बूंदी',
        'Keshoraipatan': 'केशोरायपाटन', 'Pipalda': 'पीपल्दा', 'Sangod': 'सांगोद',
        'Kota North': 'कोटा उत्तर', 'Kota South': 'कोटा दक्षिण', 'Ladpura': 'लाडपुरा',
        'Ramganj Mandi': 'रामगंज मंडी', 'Anta': 'अन्ता', 'Kishanganj': 'किशनगंज',
        'Baran-Atru': 'बारां-अटरू', 'Chhabra': 'छबड़ा', 'Dag': 'डग', 'Jhalrapatan': 'झालरापाटन',
        'Khanpur': 'खानपुर', 'Manohar Thana': 'मनोहर थाना'
    }

    for r in rows[1:]:
        lines = [l.strip() for l in r.split('\n') if l.strip()]
        if not lines:
            continue
        num_m = re.search(r'^\|\s*(\d{1,3})$', lines[0])
        if not num_m:
            continue
        ac_no = int(num_m.group(1))

        name_m = re.search(r'! scope=row \| \[\[([^\]\|]+)(?:\|([^\]]+))?\]\]', r)
        name = ''
        if name_m:
            name = name_m.group(2) or name_m.group(1)
            name = name.replace(' Assembly constituency', '').strip()

        res_m = re.search(r'\|\s*(?:rowspan=(\d+)\s*)?(?:style=\"[^\"]*\"\s*\|\s*)?(SC|ST|None)', r)
        if res_m:
            val = res_m.group(2)
            rspan = int(res_m.group(1)) if res_m.group(1) else 1
            active_res = [val, rspan]
        category = 'GEN' if active_res[0] == 'None' else active_res[0]
        active_res[1] -= 1

        dist_m = re.search(r'\|\s*(?:rowspan=(\d+)\s*\|\s*)?\[\[([^\]\|]+)\s+district\|([^\]]+)\]\]', r)
        if dist_m:
            val = dist_m.group(3)
            rspan = int(dist_m.group(1)) if dist_m.group(1) else 1
            active_dist = [val, rspan]
        district = active_dist[0]
        active_dist[1] -= 1

        pc_m = re.search(r'\|\s*(?:rowspan=(\d+)\s*\|\s*)?\[\[([^\]\|]+)\s+Lok Sabha constituency\|([^\]]+)\]\]', r)
        if pc_m:
            val = pc_m.group(3)
            rspan = int(pc_m.group(1)) if pc_m.group(1) else 1
            active_pc = [val, rspan]
        pc = active_pc[0]
        active_pc[1] -= 1

        name_hi = AC_HINDI_NAMES.get(name, name)

        constituencies.append({
            'ac_no': ac_no,
            'name_en': name,
            'name_hi': name_hi,
            'category': category,
            'district': district,
            'pc_name': pc
        })

    with open(os.path.join(DATA_DIR, 'rajasthan_constituencies.json'), 'w', encoding='utf-8') as f:
        json.dump(constituencies, f, ensure_ascii=False, indent=2)

    print(f"-> Successfully saved {len(constituencies)} Assembly Constituencies to rajasthan_constituencies.json")
except Exception as e:
    print(f"-> Error fetching constituencies: {e}")

# ==============================================================================
# 2. Rajasthan Local Election Datasets (178,000+ Records)
# ==============================================================================
print("\n[Step 2/5] Downloading Local Elections & Village Datasets...")

url_cands = 'https://raw.githubusercontent.com/in-rolls/local_elections_rajasthan/main/data/release/sarpanch_candidates.parquet'
url_wards = 'https://raw.githubusercontent.com/in-rolls/local_elections_rajasthan/main/data/release/ward_member_winners.parquet'
url_rj_csv = 'https://raw.githubusercontent.com/datameet/indian_village_boundaries/master/rj/rj.csv'

req1 = urllib.request.Request(url_cands, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req1) as resp:
    df_cands = pd.read_parquet(io.BytesIO(resp.read()))
print(f"-> Downloaded Sarpanch Candidates: {len(df_cands)} rows")

req2 = urllib.request.Request(url_wards, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req2) as resp:
    df_wards = pd.read_parquet(io.BytesIO(resp.read()))
print(f"-> Downloaded Ward Member Winners: {len(df_wards)} rows")

req3 = urllib.request.Request(url_rj_csv, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req3) as resp:
    df_villages_csv = pd.read_csv(io.BytesIO(resp.read()), on_bad_lines='skip')
print(f"-> Downloaded DataMeet RJ Villages: {len(df_villages_csv)} rows")

# ==============================================================================
# 3. Build Full Administrative Geography (Districts -> Samitis -> GPs -> Villages)
# ==============================================================================
print("\n[Step 3/5] Building Rajasthan Geography & Village Index...")

# Hierarchy: District -> Samiti -> GP -> Set of Villages
geo_tree = defaultdict(lambda: defaultdict(lambda: defaultdict(set)))
village_lookup = {}

# Process df_wards (has district, panchayat_samiti, gram_panchayat, village)
for _, row in df_wards[['district', 'panchayat_samiti', 'gram_panchayat', 'village']].dropna().iterrows():
    d = str(row['district']).strip().upper()
    s = str(row['panchayat_samiti']).strip().upper()
    g = str(row['gram_panchayat']).strip().upper()
    v = str(row['village']).strip().upper()
    if d and s and g and v:
        geo_tree[d][s][g].add(v)
        if v not in village_lookup:
            village_lookup[v] = {
                'name_en': v.title(),
                'district': d,
                'samiti': s,
                'gram_panchayat': g
            }

# Process df_cands (has district, panchayat_samiti, gram_panchayat)
for _, row in df_cands[['district', 'panchayat_samiti', 'gram_panchayat']].dropna().iterrows():
    d = str(row['district']).strip().upper()
    s = str(row['panchayat_samiti']).strip().upper()
    g = str(row['gram_panchayat']).strip().upper()
    if d and s and g:
        # ensure GP exists in tree
        _ = geo_tree[d][s][g]

# Process DataMeet rj.csv
if 'DTName' in df_villages_csv.columns and 'Name' in df_villages_csv.columns:
    for _, row in df_villages_csv.iterrows():
        d = str(row.get('DTName', '')).strip().upper()
        s = str(row.get('SDTName', '')).strip().upper()
        v = str(row.get('Name', '')).strip().upper()
        if d and v and not v.isdigit() and len(v) >= 2:
            if s:
                geo_tree[d][s]['VILLAGES'].add(v)
            if v not in village_lookup:
                village_lookup[v] = {
                    'name_en': v.title(),
                    'district': d,
                    'samiti': s,
                    'gram_panchayat': ''
                }

# Convert sets to sorted lists for JSON serialization
formatted_geo = {}
for d, samitis in sorted(geo_tree.items()):
    formatted_geo[d] = {
        'samitis_count': len(samitis),
        'samitis': {}
    }
    for s, gps in sorted(samitis.items()):
        formatted_geo[d]['samitis'][s] = {
            'gram_panchayats_count': len(gps),
            'gram_panchayats': {gp: sorted(list(vils)) for gp, vils in sorted(gps.items())}
        }

with open(os.path.join(DATA_DIR, 'rajasthan_geography.json'), 'w', encoding='utf-8') as f:
    json.dump(formatted_geo, f, ensure_ascii=False, indent=2)
print(f"-> Saved administrative geography ({len(formatted_geo)} districts) to rajasthan_geography.json")

# Standard Rajasthani Mohalla / Village Suffixes & Patterns
VILLAGE_PATTERNS = {
    'suffixes': [
        'का बास', 'की ढाणी', 'का खेड़ा', 'का वास', 'का वाड़ा', 'की ढाणियां',
        'गुड़ा', 'बेरा', 'फांटा', 'चौक', 'मोहल्ला', 'पट्टा', 'कुआं', 'गोदाम',
        'दरवाजा', 'मगरा', 'तला', 'नाडा', 'नाड़ी', 'पुरा', 'नगर', 'खेडा', 'धोरा'
    ],
    'known_corruptions_map': {
        'रबाररयक का बास': 'रबारियों का बास',
        'रबारियल का बास': 'रबारियों का बास',
        'रबाररयल का बास': 'रबारियों का बास',
        'मलयलल का बास': 'मोयलों का बास',
        'भललल की ऊंचली बास': 'भीलों की ऊंचली बास',
        'रावला के पलछे': 'रावला के पीछे',
        'भाटवाडा मेगवालक का बास': 'भाटवाड़ा मेघवालों का बास',
        'मेघवालो का बास': 'मेघवालों का बास',
        'चौधरियो का बास': 'चौधरियों का बास',
        'ब्राह्मणो का बास': 'ब्राह्मणों का बास'
    },
    'total_villages_indexed': len(village_lookup),
    'sample_villages': sorted(list(village_lookup.keys()))[:1000]
}

with open(os.path.join(DATA_DIR, 'rajasthan_villages.json'), 'w', encoding='utf-8') as f:
    json.dump(VILLAGE_PATTERNS, f, ensure_ascii=False, indent=2)
print(f"-> Saved {len(village_lookup)} unique Rajasthan villages and patterns to rajasthan_villages.json")

# ==============================================================================
# 4. Rajasthan Caste, Tribe & Community Taxonomy
# ==============================================================================
print("\n[Step 4/5] Structuring Rajasthan Castes & Communities Taxonomy...")

rajasthan_castes = {
    'General': {
        'communities': ['Rajput', 'Brahmin', 'Vaishya / Mahajan / Baniya', 'Kayastha'],
        'surnames': [
            'Singh', 'Rathore', 'Shekhawat', 'Chauhan', 'Sisodia', 'Bhati', 'Solanki',
            'Parihar', 'Panwar', 'Sharma', 'Joshi', 'Vyas', 'Dave', 'Purohit', 'Gaud',
            'Agarwal', 'Maheshwari', 'Oswal', 'Gupta', 'Jain', 'Khandelwal', 'Mathur'
        ]
    },
    'OBC': {
        'communities': [
            'Jat', 'Gurjar / Gujjar', 'Bishnoi', 'Rebari / Raika / Dewasi', 'Mali / Saini',
            'Kumhar / Prajapat', 'Suthar / Jangid', 'Yadav / Ahir', 'Charan', 'Lohar',
            'Darji', 'Nai / Sen', 'Khati', 'Ghanchi', 'Kalal'
        ],
        'surnames': [
            'Chaudhary', 'Jat', 'Godara', 'Beniwal', 'Punia', 'Dhaka', 'Saharan', 'Doodi',
            'Siyag', 'Jakhar', 'Kaswan', 'Khileri', 'Bhadu', 'Khichar', 'Moond', 'Gurjar',
            'Bainsla', 'Bishnoi', 'Dewasi', 'Rebari', 'Raika', 'Mali', 'Saini', 'Kumhar',
            'Prajapat', 'Prajapati', 'Suthar', 'Jangid', 'Yadav', 'Charan', 'Panchal'
        ]
    },
    'SC': {
        'communities': [
            'Meghwal', 'Bairwa', 'Balai', 'Regar / Raigar', 'Jatav / Chamar', 'Dhobi',
            'Valmiki / Bhangi', 'Khatik', 'Dhanak', 'Sansi', 'Kanjar', 'Bawariya'
        ],
        'surnames': [
            'Meghwal', 'Bairwa', 'Balai', 'Regar', 'Raigar', 'Jatav', 'Verma', 'Khatik',
            'Valmiki', 'Dhanak', 'Sansi', 'Bawariya'
        ]
    },
    'ST': {
        'communities': [
            'Meena', 'Bheel / Bhil', 'Damor', 'Garasia', 'Sahariya', 'Roat', 'Katara'
        ],
        'surnames': [
            'Meena', 'Bheel', 'Bhil', 'Damor', 'Garasia', 'Sahariya', 'Roat', 'Katara'
        ]
    },
    'Muslim': {
        'communities': [
            'Kayamkhani', 'Mev / Meo', 'Sindhi Musalman', 'Mansuri', 'Qureshi', 'Ansari',
            'Khan / Pathan', 'Sayyid / Syed', 'Deshwali', 'Cheetah-Merat'
        ],
        'surnames': [
            'Khan', 'Kayamkhani', 'Mansuri', 'Qureshi', 'Ansari', 'Pathan', 'Syed',
            'Shah', 'Ali', 'Mohammad', 'Ahmed', 'Deen'
        ]
    }
}

with open(os.path.join(DATA_DIR, 'rajasthan_castes.json'), 'w', encoding='utf-8') as f:
    json.dump(rajasthan_castes, f, ensure_ascii=False, indent=2)
print("-> Saved Rajasthan caste taxonomy to rajasthan_castes.json")

# ==============================================================================
# 5. Expanding Master Lexicon of Rajasthani & Indian Names
# ==============================================================================
print("\n[Step 5/5] Expanding Master Devanagari Names Lexicon...")

master_names_path = os.path.join(DATA_DIR, 'master_indian_names.json')
with open(master_names_path, 'r', encoding='utf-8') as f:
    master_names_set = set(json.load(f))
initial_count = len(master_names_set)

# Load transliteration dictionary
ts_path = os.path.join(os.path.dirname(os.path.dirname(DATA_DIR)), 'frontend', 'src', 'lib', 'transliterate.ts')
en_to_hi = {}
if os.path.exists(ts_path):
    with open(ts_path, 'r', encoding='utf-8') as f:
        matches = re.findall(r"'([^']+)':\s*'([^']+)'", f.read())
        for hi, en in matches:
            en_clean = en.strip().upper()
            if en_clean not in en_to_hi and re.match(r'^[\u0900-\u097F]+$', hi.strip()):
                en_to_hi[en_clean] = hi.strip()

# High-frequency Rajasthani names, tribal surnames, and compound terms
rajasthan_lexicon_enrichment = {
    'SUMAN': 'सुमन', 'LAXMI': 'लक्ष्मी', 'CHOUDHARY': 'चौधरी', 'CHOUDHARI': 'चौधरी',
    'DAMOR': 'डामोर', 'KUNWAR': 'कंवर', 'MEERA': 'मीरा', 'MIRA': 'मीरा',
    'VERMA': 'वर्मा', 'GUDDI': 'गुड्डी', 'KAUR': 'कौर', 'ROAT': 'रोत',
    'KATARA': 'कटारा', 'BHIL': 'भील', 'BHEEL': 'भील', 'ANIL': 'अनिल',
    'KANTA': 'कांता', 'MAHAVEER': 'महावीर', 'DHAPU': 'धपू', 'LACHI': 'लाछी',
    'FULI': 'फूली', 'FOOLI': 'फूली', 'BADAMI': 'बदामी', 'KESARI': 'केसरी',
    'CHHOTI': 'छोटी', 'ROSHNI': 'रोशनी', 'MANGI': 'मांगी', 'NAZIR': 'नजीर',
    'HASAM': 'हसम', 'SEVARAM': 'सेवाराम', 'PRATAPRAM': 'प्रतापराम',
    'HADMANA': 'हड़माना', 'HADMAN': 'हड़मान', 'HADMANARAM': 'हड़मानाराम',
    'SANWALARAM': 'सांवलाराम', 'SANWALRAM': 'सांवलराम', 'NIMBARAM': 'नीम्बाराम',
    'BHALLARAM': 'भल्लाराम', 'PAPPURAM': 'पप्पूराम', 'ANOPARAM': 'अनुपाराम',
    'ANUPARAM': 'अनुपाराम', 'KHIMRAJ': 'खीमराज', 'JETHARAM': 'जेठाराम',
    'SAVARAM': 'सवाराम', 'BHAGIRATH': 'भागीरथ', 'BHAGIRATHRAM': 'भागीरथराम',
    'PUKHRAJ': 'पुखराज', 'HASTIMAL': 'हस्तीमल', 'MISHRI': 'मिश्री',
    'MISHRILAL': 'मिश्रीलाल', 'JHUMAR': 'झूमर', 'JHUMARLAL': 'झूमरलाल',
    'SOBHAG': 'सोभाग', 'SOBHAGMAL': 'सोभागमल', 'BISHNOI': 'बिश्नोई',
    'DEWASI': 'देवासी', 'REBARI': 'रबारी', 'RAIKA': 'राइका', 'MEGHWAL': 'मेघवाल',
    'GEHLOT': 'गहलोत', 'KUMAWAT': 'कुमावत', 'SUTHAR': 'सुथार', 'JANGID': 'जांगिड़',
    'SHANKAR': 'शंकर', 'PRASAD': 'प्रसाद', 'PRAKASH': 'प्रकाश', 'CHAND': 'चंद',
    'CHANDRA': 'चंद्र', 'KISHORE': 'किशोर', 'KISHAN': 'किशन', 'GOPAL': 'गोपाल',
    'MOHAN': 'मोहन', 'SOHAN': 'सोहन', 'MADAN': 'मदन', 'RATAN': 'रतन', 'MOTI': 'मोती',
    'CHHOTU': 'छोटू', 'NAND': 'नंद', 'BANSI': 'बंसी', 'HIRALAL': 'हीरालाल',
    'BABULAL': 'बाबूलाल', 'MOHANLAL': 'मोहनलाल', 'RAMPRASAD': 'रामप्रसाद',
    'RAMESHWAR': 'रामेश्वर', 'SITARAM': 'सीताराम', 'HARIRAM': 'हरीराम',
    'RAMCHANDRA': 'रामचंद्र', 'OMPRAKASH': 'ओमप्रकाश', 'SHIVPRAKASH': 'शिवप्रकाश',
    'JAGDISH': 'जगदीश', 'BHAGWAN': 'भगवान', 'MAHESH': 'महेश', 'DINESH': 'दिनेश',
    'SURESH': 'सुरेश', 'RAMESH': 'रमेश', 'MUKESH': 'मुकेश', 'RAKESH': 'राकेश',
    'PREM': 'प्रेम', 'SHANTI': 'शांति', 'KAMLA': 'कमला', 'SUNITA': 'सुनीता',
    'ANITA': 'अनीता', 'MANJU': 'मंजू', 'REKHA': 'रेखा', 'SANTOSH': 'संतोष',
    'GEETA': 'गीता', 'MAMTA': 'ममता', 'SEEMA': 'सीमा', 'SAROJ': 'सरोज',
    'POOJA': 'पूजा', 'ASHA': 'आशा', 'USHA': 'उषा', 'HEMLATA': 'हेमलता',
    'LALITA': 'ललिता', 'SAVITRI': 'सावित्री', 'PUSHP': 'पुष्पा', 'PUSHPA': 'पुष्पा',
    'PREMA': 'प्रेमा', 'KAVITA': 'कविता', 'NIRMALA': 'निर्मला', 'VIMLA': 'विमला',
    'SUSHEELA': 'सुशीला', 'SUSHILA': 'सुशीला', 'PARVATI': 'पार्वती', 'TARA': 'तारा',
    'SHARDA': 'शारदा', 'BASANTI': 'बसंती', 'GAYATRI': 'गायत्री', 'JAMNA': 'जमना',
    'DHANNA': 'धन्ना', 'CHHAGAN': 'छगन', 'BIRJU': 'बिरजू', 'KALU': 'कालू',
    'MANGILAL': 'मांगीलाल', 'CHAMPALAL': 'चम्पालाल', 'KALURAM': 'कालूराम',
    'GHEVAR': 'घेवर', 'GHEVARRAM': 'घेवरराम', 'KANKU': 'कंकू', 'LADU': 'लाडू',
    'LADURAM': 'लाडूराम', 'CHAGAN': 'छगन', 'SUA': 'सुआ', 'JAVRI': 'जवरी',
    'MUMALI': 'मूमली', 'AMBU': 'आम्बु', 'PEMPA': 'पेंपा'
}
en_to_hi.update(rajasthan_lexicon_enrichment)

# Add individual tokens
for hi_name in en_to_hi.values():
    if len(hi_name) >= 2 and re.match(r'^[\u0900-\u097F]+$', hi_name):
        master_names_set.add(hi_name)

# Convert compound full names from candidates & ward winners
def convert_name_to_hi(name_en):
    parts = str(name_en).replace('.', ' ').split()
    hi_parts = []
    for p in parts:
        p_up = p.upper()
        if p_up in en_to_hi:
            hi_parts.append(en_to_hi[p_up])
        else:
            return None
    return ' '.join(hi_parts)

for col in ['candidate_name', 'candidate_relation_name']:
    for n in df_cands[col].dropna():
        hi = convert_name_to_hi(n)
        if hi and len(hi) >= 3 and re.match(r'^[\u0900-\u097F\s]+$', hi):
            master_names_set.add(hi)

for n in df_wards['winner_name'].dropna():
    hi = convert_name_to_hi(n)
    if hi and len(hi) >= 3 and re.match(r'^[\u0900-\u097F\s]+$', hi):
        master_names_set.add(hi)

# Filter and sort
final_names = sorted([n for n in master_names_set if n and len(n) >= 2])
with open(master_names_path, 'w', encoding='utf-8') as f:
    json.dump(final_names, f, ensure_ascii=False, indent=2)

print(f"-> Expanded master lexicon from {initial_count} to {len(final_names)} authentic Devanagari names (+{len(final_names) - initial_count} newly learned)")

print("\n" + "=" * 60)
print("RAJASTHAN DATA INGESTION & LEARNING COMPLETE!")
print("=" * 60)
