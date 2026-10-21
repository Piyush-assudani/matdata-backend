const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * Generate a beautifully formatted Excel (.xlsx) file from an array of voter records
 * 
 * @param {Array} voters - Array of extracted voter records
 * @param {string} outputPath - Full destination path for .xlsx file
 * @param {Object} metadata - Optional metadata (title, ward, booth)
 * @returns {Promise<string>} - Returns the output file path
 */
async function generateVoterExcel(voters, outputPath, metadata = {}) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Matdata Portal Electoral Intelligence';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('मतदाता सूची (Voter List)', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  // Define Columns (Pure Hindi Electoral Data)
  sheet.columns = [
    { header: 'क्रमांक', key: 'serialNo', width: 10 },
    { header: 'पहचान पत्र (EPIC No)', key: 'epic', width: 22 },
    { header: 'मतदाता का नाम', key: 'nameHi', width: 26 },
    { header: 'संबंधी का नाम', key: 'relativeNameHi', width: 26 },
    { header: 'संबंध प्रकार', key: 'relationType', width: 14 },
    { header: 'मकान संख्या', key: 'houseNo', width: 16 },
    { header: 'आयु', key: 'age', width: 10 },
    { header: 'लिंग', key: 'gender', width: 12 },
    { header: 'गाँव / मोहल्ला', key: 'villageNameHi', width: 28 },
    { header: 'स्थिति', key: 'status', width: 12 },
    { header: 'वार्ड संख्या', key: 'wardNo', width: 14 },
    { header: 'बूथ / भाग संख्या', key: 'partNo', width: 16 }
  ];

  // Style Header Row (Emerald Green #00875A, White text, Bold)
  const headerRow = sheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00875A' }
    };
    cell.font = {
      name: 'Segoe UI',
      color: { argb: 'FFFFFFFF' },
      bold: true,
      size: 11
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: false
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF006644' } },
      bottom: { style: 'medium', color: { argb: 'FF005538' } },
      left: { style: 'thin', color: { argb: 'FF006644' } },
      right: { style: 'thin', color: { argb: 'FF006644' } }
    };
  });

  // Populate Data Rows (Pure Hindi Data)
  voters.forEach((v, index) => {
    const row = sheet.addRow({
      serialNo: v.serialNo || index + 1,
      epic: v.epic || '',
      nameHi: v.nameHi || '',
      relativeNameHi: v.relativeNameHi || '',
      relationType: v.relationType || 'पिता',
      houseNo: v.houseNo || '',
      age: v.age || '',
      gender: v.gender || 'अन्य',
      villageNameHi: v.villageNameHi || v.villageName || '',
      status: v.status || 'Active',
      wardNo: v.wardNo || metadata.wardNo || '',
      partNo: v.partNo || metadata.boothNo || ''
    });

    row.height = 22;

    const isEven = index % 2 === 0;
    const bgArgb = isEven ? 'FFFFFFFF' : 'FFF8FAF9';

    row.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bgArgb }
      };
      cell.font = {
        name: 'Segoe UI',
        size: 10,
        color: { argb: 'FF1A2620' }
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE4EAE5' } },
        right: { style: 'thin', color: { argb: 'FFE4EAE5' } },
        left: { style: 'thin', color: { argb: 'FFE4EAE5' } },
        top: { style: 'thin', color: { argb: 'FFE4EAE5' } }
      };

      // Alignment rules: center for numbers & short codes, left for names and locations
      if ([1, 2, 7, 9, 10, 13, 14, 15].includes(colNumber)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }

      // Highlight Deleted voters
      if (colNumber === 13 && cell.value === 'Deleted') {
        cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FFD93025' }, bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE8E6' } };
      }
    });
  });

  // Also create Sheet 2: 'Voters' (exact match with voter-import-template.xlsx)
  const votersSheet = workbook.addWorksheet('Voters', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  votersSheet.columns = [
    { header: 'EPIC No', key: 'epic', width: 20 },
    { header: 'Ward', key: 'wardNo', width: 12 },
    { header: 'Part', key: 'partNo', width: 12 },
    { header: 'Serial No', key: 'serialNo', width: 12 },
    { header: 'Name (English)', key: 'nameEn', width: 26 },
    { header: 'Name (Hindi)', key: 'nameHi', width: 26 },
    { header: 'Age', key: 'age', width: 10 },
    { header: 'Gender', key: 'gender', width: 12 },
    { header: 'Relation', key: 'relationType', width: 14 },
    { header: 'Relative Name (English)', key: 'relativeNameEn', width: 26 },
    { header: 'Relative Name (Hindi)', key: 'relativeNameHi', width: 26 },
    { header: 'House No', key: 'houseNo', width: 14 },
    { header: 'House No (Hindi)', key: 'houseNoHi', width: 16 },
    { header: 'Mobile', key: 'mobileNo', width: 16 },
    { header: 'Caste', key: 'caste', width: 14 },
    { header: 'Family ID', key: 'familyId', width: 16 },
    { header: 'Village', key: 'villageName', width: 26 },
    { header: 'Village (Hindi)', key: 'villageNameHi', width: 26 }
  ];

  const vHeaderRow = votersSheet.getRow(1);
  vHeaderRow.height = 28;
  vHeaderRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00875A' } };
    cell.font = { name: 'Segoe UI', color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  voters.forEach((v, index) => {
    votersSheet.addRow({
      epic: v.epic || '',
      wardNo: v.wardNo || metadata.wardNo || '1',
      partNo: v.partNo || metadata.boothNo || '1',
      serialNo: v.serialNo || index + 1,
      nameEn: '', // Pure Hindi Only
      nameHi: v.nameHi || '',
      age: v.age || '',
      gender: v.gender || 'अन्य',
      relationType: v.relationType || 'पिता',
      relativeNameEn: '', // Pure Hindi Only
      relativeNameHi: v.relativeNameHi || '',
      houseNo: v.houseNo || '',
      houseNoHi: v.houseNo || '',
      mobileNo: v.mobileNo || '',
      caste: v.caste || '',
      familyId: v.familyId || '',
      villageName: '', // Pure Hindi Only
      villageNameHi: v.villageNameHi || v.villageName || ''
    });
  });

  await workbook.xlsx.writeFile(outputPath);
  console.log(`Excel file generated successfully: ${outputPath} (${voters.length} rows)`);
  return outputPath;
}

module.exports = { generateVoterExcel };
