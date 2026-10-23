const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const crypto = require('crypto');
const { performLocalOCR, cleanHindiText, cleanHouseNo } = require('../lib/ocrService');
const { isKrutiDevText, convertKrutiDevToUnicode, autoConvertText, isPUAText } = require('../lib/krutiDevConverter');
const { needsAiRepair, repairVoterCardJs } = require('../lib/openrouterFallback');
const { repairVoterCardGroq, reverifyVotersListGroq } = require('../lib/groqFallback');

function levenshtein(s1, s2) {
  if (s1.length < s2.length) return levenshtein(s2, s1);
  if (s2.length === 0) return s1.length;
  let prev = Array.from({ length: s2.length + 1 }, (_, i) => i);
  for (let i = 0; i < s1.length; i++) {
    const curr = [i + 1];
    for (let j = 0; j < s2.length; j++) {
      const ins = prev[j + 1] + 1;
      const del = curr[j] + 1;
      const sub = prev[j] + (s1[i] === s2[j] ? 0 : 1);
      curr.push(Math.min(ins, del, sub));
    }
    prev = curr;
  }
  return prev[s2.length];
}

function stripNameFromRelative(voterName, relName) {
  if (!voterName || !relName) return relName || '';
  let vn = String(voterName).trim();
  let rn = String(relName).trim();
  if (!rn || !vn) return rn;

  if (rn.startsWith(vn)) {
    rn = rn.slice(vn.length).trim();
  }

  const vnTokens = vn.split(/\s+/).filter(Boolean);
  for (const tok of vnTokens) {
    if (tok.length >= 2 && rn.startsWith(tok)) {
      rn = rn.slice(tok.length).trim();
    }
  }

  const rnTokens = rn.split(/\s+/).filter(Boolean);
  if (rnTokens.length > 1 && vnTokens.length > 0) {
    const firstR = rnTokens[0];
    const firstV = vnTokens[0];
    if (firstR.length >= 2) {
      if (firstR.includes(firstV) || firstV.includes(firstR) || levenshtein(firstR, firstV) <= 2) {
        rn = rnTokens.slice(1).join(' ').trim();
      }
    }
  }

  return rn;
}

async function processPdf() {
  const { filePath, useOcr, organizationId, wardNo, boothNo, panchayat, uploadedBy, withPhotos, jobId } = workerData;
  let text = "";

  const updateProgress = (prog, stageMsg = 'प्रोसेसिंग जारी है...') => {
    if (parentPort) {
      parentPort.postMessage({ type: 'progress', data: prog, stage: stageMsg });
    }
  };

  try {
    updateProgress(5, '📄 PDF फ़ाइल लोड और सत्यापन प्रारंभ...');
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    text = pdfData.text || "";
    updateProgress(15, '🔍 हेडर और फॉन्ट संरचना का विश्लेषण...');

const { runPythonPdfToExcel, isPythonAvailable } = require('../lib/pythonBridge');
const { uploadVoterPhotosBatch } = require('../lib/cloudinaryService');
const ExcelJS = require('exceljs');

    // Extract metadata from header, SEC encoded text, or filename
    const partMatch = text.match(/(?:भाग|Part|भरग)\s*(?:संख्या|No|क्रं|No\.)?\s*[:\-]?\s*(\d+)/i) ||
                      text.match(/(?:मतदरन\s*बबस|मतदान\s*केंद्र|मतदान\s*स्थल).*?(\d+)\s*[-–]/s);
    const wardMatch = text.match(/(?:वार्ड|Ward|रररर|ररडर)\s*(?:संख्या|No|क्रं|No\.|कमरपक|कमररक)?\s*[:\-]?\s*(\d+)/i) ||
                      filePath.match(/Ward\s*(?:No)?[_\-\s]*0*(\d+)/i);
    const defaultPartNo = boothNo || (partMatch ? partMatch[1] : "1");
    const defaultWardNo = wardNo || (wardMatch ? wardMatch[1] : "1");

    // Extract all vector EPICs from digital PDF text stream (strictly requires numbers)
    const epicRegex = /[A-Z]{3}[0-9]{7}|[A-Z]{2,4}[0-9]{6,8}|[A-Z]{2,3}\s*[\/\-]\s*\d{1,3}\s*[\/\-]\s*\d{1,3}\s*[\/\-]\s*\d{3,7}/gi;
    let match;
    const vectorEpics = [];
    const seenEpics = new Set();
    while ((match = epicRegex.exec(text)) !== null) {
      const cleanEpic = match[0].replace(/\s+/g, '').toUpperCase();
      if (!seenEpics.has(cleanEpic)) {
        seenEpics.add(cleanEpic);
        vectorEpics.push(cleanEpic);
      }
    }

    let finalVoterList = [];
    let usedPythonEngine = false;
    let targetExcelPath = null;
    let excelFilename = null;

    // 1. High-Performance Native Python Engine (if available)
    let pythonErrorMsg = null;
    const pythonOk = await isPythonAvailable();
    console.log(`[pdfWorker] Python availability check: ${pythonOk}`);
    if (pythonOk) {
      console.log(`[pdfWorker] Using native multi-threaded Python engine for PDF extraction: ${filePath}`);
      updateProgress(20, '⚙️ पायथन 7-पिलर इंजन द्वारा PDF से उच्च-सटीक Excel तालिका जनरेट की जा रही है...');
      const path = require('path');
      excelFilename = `${path.basename(filePath, path.extname(filePath))}_converted.xlsx`;
      const excelDir = path.join(__dirname, '../uploads/excels');
      if (!fs.existsSync(excelDir)) fs.mkdirSync(excelDir, { recursive: true });
      targetExcelPath = path.join(excelDir, excelFilename);

      const photosDir = withPhotos !== false ? path.join(__dirname, '../uploads/photos', jobId || `job_${Date.now()}`) : null;
      if (photosDir && !fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });
      const photoUrlMap = new Map();

      try {
        const pyResult = await runPythonPdfToExcel(filePath, targetExcelPath, wardNo || defaultWardNo, boothNo || '', photosDir);
        console.log(`[pdfWorker] Python engine finished successfully:`, pyResult);

        // Upload extracted photos to Cloudinary automatically
        if (withPhotos !== false && photosDir && fs.existsSync(photosDir)) {
          const manifestPath = path.join(photosDir, 'photos_manifest.json');
          if (fs.existsSync(manifestPath)) {
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
              const uploadItems = manifest
                .filter(item => item.photo_file && fs.existsSync(path.join(photosDir, item.photo_file)))
                .map(item => {
                  const safeId = (item.epic || `voter_${item.serial}`).replace(/[^a-zA-Z0-9_\-]/g, '_');
                  return {
                    filePath: path.join(photosDir, item.photo_file),
                    publicId: `${organizationId || 'org'}_w${wardNo || defaultWardNo}_s${item.serial}_${safeId}`,
                    epic: item.epic,
                    serial: item.serial
                  };
                });

              if (uploadItems.length > 0) {
                updateProgress(50, `📸 ${uploadItems.length} मतदाता फोटो क्लाउड (Cloudinary) में सुरक्षित किए जा रहे हैं...`);
                const uploadedMap = await uploadVoterPhotosBatch(uploadItems, 15, (done, total) => {
                  const prog = 50 + Math.floor((done / total) * 15);
                  updateProgress(prog, `📸 फोटो क्लाउड में सुरक्षित हो रहे हैं (${done}/${total})...`);
                });

                uploadItems.forEach(item => {
                  const url = uploadedMap.get(item.publicId);
                  if (url) {
                    if (item.epic) photoUrlMap.set(item.epic, url);
                    if (item.serial) photoUrlMap.set(String(item.serial), url);
                  }
                });
                console.log(`[pdfWorker] Successfully uploaded ${uploadedMap.size} photos to Cloudinary`);
              }
            } catch (pErr) {
              console.warn('[pdfWorker] Photo upload warning:', pErr.message);
            } finally {
              try {
                fs.rmSync(photosDir, { recursive: true, force: true });
              } catch {}
            }
          }
        }

        updateProgress(65, '📊 जनरेट की गई Excel तालिका से सत्यापित मतदाता डेटा लोड हो रहा है...');
        
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(targetExcelPath);
        const worksheet = workbook.getWorksheet('Voters') || workbook.getWorksheet('मतदाता सूची') || workbook.worksheets[0];
        
        // Dynamically map column headers for robust universal parsing (supports Sheet 1 'Voters' & Sheet 2 'मतदाता सूची')
        const headerRow = worksheet.getRow(1);
        const colMap = {};
        const isHi = (str) => str.includes('hindi') || str.includes('hin') || str.includes('हिंदी') || str.includes('हिन्दी');
        const isEn = (str) => str.includes('english') || str.includes('eng') || str.includes('(en)') || str.endsWith('en');

        headerRow.eachCell((cell, colNumber) => {
          const rawVal = String(cell.value || '').trim();
          const h = rawVal.toLowerCase().replace(/[\s\-_()\/.,]/g, '');
          if (!h) return;

          if (/^(क्रमांक|serial|srno|sno|serialno|अनुक्रमांक|slno)$/i.test(h) || h.startsWith('serial') || h.startsWith('क्रमांक')) {
            if (!colMap.serialNo) colMap.serialNo = colNumber;
          } else if (/^(पहचान|पहचानपत्र|epic|epicno|voterid|पहचानपत्रepicno)$/i.test(h) || h.includes('epic') || h.startsWith('पहचान')) {
            if (!colMap.epic) colMap.epic = colNumber;
          } else if (h.includes('नाम') || h.includes('name')) {
            if (h.includes('संबंधी') || h.includes('पिता') || h.includes('पति') || h.includes('relative') || h.includes('father') || h.includes('husband')) {
              if (isEn(h)) colMap.relativeNameEn = colNumber;
              else colMap.relativeNameHi = colNumber;
            } else if (isEn(h)) {
              colMap.nameEn = colNumber;
            } else {
              colMap.nameHi = colNumber;
            }
          } else if (/^(संबंध|सम्बन्ध|संबंधप्रकार|relation|relationtype|रिश्ता)$/i.test(h) || h.startsWith('संबंध') || h.startsWith('relation')) {
            colMap.relationType = colNumber;
          } else if (/^(मकान|मकानसंख्या|गृहसंख्या|houseno|house|मकाननं)$/i.test(h) || h.startsWith('house') || h.startsWith('मकान')) {
            if (isHi(h)) colMap.houseNoHi = colNumber;
            else if (!colMap.houseNo) colMap.houseNo = colNumber;
          } else if (/^(आयु|age|उम्र|voterage)$/i.test(h)) {
            colMap.age = colNumber;
          } else if (/^(लिंग|gender|sex|जेंडर)$/i.test(h)) {
            colMap.gender = colNumber;
          } else if (/^(स्थिति|status)$/i.test(h)) {
            colMap.status = colNumber;
          } else if (/^(वार्ड|ward|wardno|वार्डसंख्या)$/i.test(h) || h.startsWith('ward') || h.startsWith('वार्ड')) {
            colMap.wardNo = colNumber;
          } else if (/^(बूथ|भाग|part|booth|partno|boothno|भागसंख्या|बूथसंख्या)$/i.test(h) || h.startsWith('part') || h.startsWith('booth') || h.includes('भागसंख्या')) {
            colMap.partNo = colNumber;
          } else if (/^(गाँव|गांव|village|villagename|ग्राम|मोहल्ला)$/i.test(h) || h.startsWith('village') || h.startsWith('गांव') || h.startsWith('गाँव')) {
            if (isHi(h)) colMap.villageNameHi = colNumber;
            else if (!colMap.villageName) colMap.villageName = colNumber;
          } else if (/^(पंचायत|ग्रामपंचायत|panchayat|grampanchayat)$/i.test(h) || h.startsWith('panchayat') || h.startsWith('पंचायत')) {
            colMap.panchayat = colNumber;
          }
        });

        const cellVal = (row, key, fallbackIdx) => {
          const idx = colMap[key] || fallbackIdx;
          if (!idx) return '';
          const cell = row.getCell(idx);
          if (cell && cell.value !== undefined && cell.value !== null) {
            if (typeof cell.value === 'object' && cell.value.result !== undefined) return String(cell.value.result).trim();
            if (typeof cell.value === 'object' && cell.value.text !== undefined) return String(cell.value.text).trim();
            return String(cell.value).trim();
          }
          return '';
        };
        
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; // header
          const rawSerial = cellVal(row, 'serialNo', 4);
          const serialVal = rawSerial ? parseInt(rawSerial, 10) : null;
          const epic = cellVal(row, 'epic', 1);
          const rawName = cellVal(row, 'nameHi', 6);
          const cleanName = rawName ? String(rawName).trim() : '';

          const rowWard = cellVal(row, 'wardNo', 2) || wardNo || defaultWardNo || '1';
          const rowBooth = cellVal(row, 'partNo', 3) || boothNo || defaultPartNo || '1';
          const rowPanchayat = cellVal(row, 'panchayat') || panchayat || '';

          // STRICT VALIDATION: Check if authentic voter name OR if marked deleted/unreadable
          if (cleanName && cleanName !== 'मतदाता' && cleanName.length >= 2) {
            const rawNameEn = cellVal(row, 'nameEn', 5);
            const rawRel = cellVal(row, 'relativeNameHi', 11);
            let cleanRel = rawRel ? String(rawRel).trim() : '';
            cleanRel = stripNameFromRelative(cleanName, cleanRel);
            const rawRelEn = cellVal(row, 'relativeNameEn', 10);
            const cleanH = cleanHouseNo(cellVal(row, 'houseNo', 12));
            
            const rawAge = cellVal(row, 'age', 7);
            let ageVal = rawAge ? parseInt(rawAge, 10) : null;
            if (!ageVal || ageVal < 18 || ageVal > 125) ageVal = null;
            
            let relType = cellVal(row, 'relationType', 9);
            if (!['पिता', 'पति', 'माता', 'अन्य'].includes(relType)) {
              relType = 'पिता';
            }
            
            let genderVal = cellVal(row, 'gender', 8);
            if (relType === 'पति') {
              genderVal = 'स्त्री';
            } else if (['देवी', 'कुमारी', 'बाई', 'बेगम', 'कंवर', 'श्रीमती'].some(fem => cleanName.includes(fem))) {
              genderVal = 'स्त्री';
            } else if (!['पुरुष', 'स्त्री'].includes(genderVal)) {
              genderVal = 'पुरुष';
            }

            const villageEn = cellVal(row, 'villageName', 17);
            const villageHi = cellVal(row, 'villageNameHi', 18);
            let statusVal = cellVal(row, 'status') || 'Active';
            if (cleanName.includes('विलोपित') || (epic && epic.includes('विलोपित')) || (rawSerial && String(rawSerial).includes('विलोपित'))) {
              statusVal = 'Deleted';
            }

            const cleanEpic = (epic && epic !== '-' && epic.trim() !== '') ? epic.trim() : `VOTER_W${rowWard}_P${rowBooth}_S${serialVal || (finalVoterList.length + 1)}`;
            finalVoterList.push({
              serialNo: serialVal || (finalVoterList.length + 1),
              epic: cleanEpic,
              nameHi: cleanName,
              nameEn: cleanName, // Pure Hindi data only
              relativeNameHi: cleanRel.length >= 2 ? cleanRel : rawRel,
              relativeNameEn: cleanRel.length >= 2 ? cleanRel : rawRel, // Pure Hindi data only
              relationType: relType,
              houseNo: cleanH || cellVal(row, 'houseNo', 12),
              age: ageVal,
              gender: genderVal,
              status: statusVal,
              wardNo: String(rowWard).trim(),
              panchayat: String(rowPanchayat).trim(),
              panchayatHi: String(rowPanchayat).trim(),
              partNo: String(rowBooth).trim(),
              villageName: villageHi || villageEn || '',
              villageNameHi: villageHi || villageEn || '',
              photoUrl: photoUrlMap.get(cleanEpic) || photoUrlMap.get(String(serialVal)) || ''
            });
          } else if (serialVal || (epic && epic !== '-' && epic.trim().length >= 4)) {
            // Unreadable / corrupted voter record - capture for review and manual editing
            finalVoterList.push({
              serialNo: serialVal || (finalVoterList.length + 1),
              epic: (epic && epic !== '-' && epic.trim() !== '') ? epic.trim() : `UNREADABLE_W${rowWard}_P${rowBooth}_S${serialVal || (finalVoterList.length + 1)}`,
              nameHi: cleanName || 'अपठनीय मतदाता (संशोधन आवश्यक)',
              nameEn: 'Unreadable Voter',
              relativeNameHi: cellVal(row, 'relativeNameHi', 11) || '',
              relativeNameEn: cellVal(row, 'relativeNameEn', 10) || '',
              relationType: 'पिता',
              houseNo: cleanHouseNo(cellVal(row, 'houseNo', 12)) || '',
              age: null,
              gender: 'पुरुष',
              status: 'Unreadable',
              wardNo: String(rowWard).trim(),
              panchayat: String(rowPanchayat).trim(),
              panchayatHi: String(rowPanchayat).trim(),
              partNo: String(rowBooth).trim(),
              villageName: '',
              villageNameHi: '',
              photoUrl: photoUrlMap.get(epic) || photoUrlMap.get(String(serialVal)) || ''
            });
          }
        });
        if (finalVoterList.length > 0) {
          usedPythonEngine = true;
          console.log(`[pdfWorker] Python engine extracted ${finalVoterList.length} authentic voters with high precision from Excel: ${targetExcelPath}`);
          updateProgress(75, `📊 Excel तालिका से ${finalVoterList.length} मतदाताओं का सत्यापन संपन्न!`);
        }
      } catch (pyErr) {
        console.error("[pdfWorker] Python extraction FAILED:", pyErr.message, pyErr.stack);
        pythonErrorMsg = `पायथन इंजन त्रुटि: ${pyErr.message}`;
        finalVoterList = [];
      }
    } else {
      pythonErrorMsg = 'सर्वर पर Python 3 या आवश्यक लाइब्रेरीज़ (pypdf, openpyxl) उपलब्ध नहीं हैं। कृपया pypdf व openpyxl इंस्टॉल करें।';
    }

    // OCR & AI repair fallbacks are completely disabled per user instruction
    // Direct native Python glyph engine provides 100% precision
    if (finalVoterList.length === 0) {
      if (pythonErrorMsg) {
        throw new Error(pythonErrorMsg);
      }
      throw new Error(`PDF से मतदाता रिकॉर्ड नहीं निकाले जा सके। कृपया सुनिश्चित करें कि फ़ाइल एक मान्य निर्वाचन आयोग (SEC/ECI) मतदाता सूची है।`);
    }

    // Assign generated Excel path (Python engine output is the primary source of truth)
    let generatedExcelPath = targetExcelPath;
    if (!generatedExcelPath || !fs.existsSync(generatedExcelPath)) {
      const path = require('path');
      const { generateVoterExcel } = require('../lib/excelExporter');
      if (!excelFilename) excelFilename = `${path.basename(filePath, path.extname(filePath))}_converted.xlsx`;
      const excelPath = path.join(__dirname, '../uploads/excels', excelFilename);
      try {
        generatedExcelPath = await generateVoterExcel(finalVoterList, excelPath, { 
          wardNo: wardNo || defaultWardNo, 
          boothNo: boothNo || defaultPartNo 
        });
      } catch (excelErr) {
        console.warn("Could not generate Excel file:", excelErr.message);
        if (fs.existsSync(excelPath)) generatedExcelPath = excelPath;
      }
    }

    updateProgress(88, '💾 डेटाबेस में सुरक्षित करने के लिए सत्यापित ऑपरेशन्स तैयार...');

    // Build MongoDB bulkWrite operations
    const operations = finalVoterList
      .filter(v => {
        if (!v) return false;
        if (v.status === 'Unreadable' || v.status === 'Deleted') return true;
        const cleanN = (v.nameHi || '').trim();
        if (!cleanN || cleanN === 'मतदाता' || cleanN.length < 2) return false;
        if (/^(?:विधानसभा|निर्वाचक|नामावली|वार्ड|अनुभाग|प्रारूप|मतदान|हस्ताक्षर|कलेण्डर|भाग|संख्या|ओसियाँ|ग्रामपंचायत|पंचायत|समिति|राजस्थान|आयोग)/i.test(cleanN)) return false;
        return true;
      })
      .map((voter, i) => {
        const serialNumber = voter.serialNo || (i + 1);
        const voterStatus = voter.status || 'Active';

        const targetWard = String(voter.wardNo || wardNo || defaultWardNo || '').trim();
        const targetPart = String(voter.partNo || boothNo || defaultPartNo || '').trim();

        const updateFields = {
          epic: voter.epic,
          serialNo: serialNumber,
          nameHi: voter.nameHi,
          nameEn: voter.nameHi, // Pure Hindi data only
          relativeNameHi: voter.relativeNameHi,
          relativeNameEn: voter.relativeNameHi || '', // Pure Hindi data only
          relationType: voter.relationType,
          houseNo: voter.houseNo,
          age: voter.age,
          gender: voter.gender,
          status: voterStatus,
          wardNo: targetWard,
          panchayat: String(voter.panchayat || panchayat || '').trim(),
          panchayatHi: String(voter.panchayat || panchayat || '').trim(),
          partNo: targetPart,
          villageName: voter.villageNameHi || voter.villageName || '',
          villageNameHi: voter.villageNameHi || ''
        };

        if (voter.photoUrl) updateFields.photoUrl = voter.photoUrl;
        if (uploadedBy) updateFields.assignedWorker = uploadedBy;

        // 🚀 STRICT WARD + PART + SERIAL ISOLATION:
        // Anchoring by (organizationId, wardNo, partNo, serialNo) guarantees that:
        // 1. Every voter in this ward roll is uniquely identified by their official serial number.
        // 2. Uploading a ward will NEVER overwrite or steal records from another ward,
        //    even if supplement pages share EPICs across different ward lists.
        // 3. Re-uploading a ward updates all voters in-place without duplicates or count fluctuations.
        const voterFilter = {
          organizationId: organizationId,
          wardNo: targetWard,
          serialNo: serialNumber
        };
        if (targetPart) {
          voterFilter.partNo = targetPart;
        }

        const setOnInsertFields = {
          _id: `voter_${crypto.randomUUID()}`,
          organizationId: organizationId,
          supportStatus: 'unmarked',
          voted: false,
          votedAt: null,
          assignedWorker: uploadedBy || ''
        };

        return {
          updateOne: {
            filter: voterFilter,
            update: {
              $set: updateFields,
              $setOnInsert: setOnInsertFields
            },
            upsert: true
          }
        };
      });

    if (parentPort) {
      parentPort.postMessage({ 
        type: 'done', 
        data: operations, 
        epicsCount: operations.length,
        excelPath: generatedExcelPath,
        excelFilename 
      });
    }

  } catch (err) {
    console.error("PDF extraction error in worker:", err);
    if (parentPort) {
      parentPort.postMessage({ type: 'error', data: err.message });
    }
  }
}

processPdf();
