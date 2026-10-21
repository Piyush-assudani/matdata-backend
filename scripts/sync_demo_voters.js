const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Voter, Organization } = require('../models/index');

async function syncDb() {
  await mongoose.connect(process.env.MONGO_URI);

  const orgId = 'org_demo_election_2025';

  // 1. Delete corrupted voters
  const delRes = await Voter.deleteMany({ organizationId: orgId });
  console.log('Deleted old corrupted demo voters:', delRes.deletedCount);

  // 2. Read new Excel
  const excelPath = path.join(__dirname, '../uploads/excels/WithPhoto_RAMDEORA-Ward No-006_converted.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(excelPath);
  const ws = wb.getWorksheet('Voters') || wb.worksheets[0];

  const headerRow = ws.getRow(1);
  const colMap = {};
  headerRow.eachCell((cell, col) => {
    const val = String(cell.value || '').trim();
    colMap[val] = col;
  });

  const voters = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const c = (colName) => {
      const idx = colMap[colName];
      if (!idx) return '';
      const cell = row.getCell(idx);
      if (!cell || cell.value === null || cell.value === undefined) return '';
      return String(cell.value).trim();
    };

    const epic = c('EPIC No');
    const nameHi = c('Name (Hindi)');
    if (!nameHi) return;

    voters.push({
      _id: 'voter_' + crypto.randomUUID(),
      organizationId: orgId,
      epic: epic || ('VOTER_' + c('Serial No')),
      wardNo: c('Ward') || '6',
      partNo: c('Part') || '1',
      serialNo: parseInt(c('Serial No'), 10) || rowNumber - 1,
      nameHi: nameHi,
      nameEn: c('Name (English)') || nameHi,
      relativeNameHi: c('Relative Name (Hindi)'),
      relativeNameEn: c('Relative Name (English)'),
      relationType: c('Relation') || 'पिता',
      houseNo: c('House No') || '105',
      houseNoHi: c('House No (Hindi)') || '105',
      age: parseInt(c('Age'), 10) || 30,
      gender: c('Gender') || 'पुरुष',
      villageName: c('Village'),
      villageNameHi: c('Village (Hindi)'),
      status: 'Active'
    });
  });

  console.log('Extracted voters to insert:', voters.length);
  if (voters.length > 0) {
    const insRes = await Voter.insertMany(voters);
    console.log('Successfully inserted clean voters:', insRes.length);
  }

  // Update Org wards
  await Organization.updateOne(
    { _id: orgId },
    { $addToSet: { allowedWards: '6', wards: '6' } }
  );
  console.log('Updated Org wards with Ward 6');

  const count = await Voter.countDocuments({ organizationId: orgId });
  console.log('Final DB count for demo org:', count);

  const sample = await Voter.find({ organizationId: orgId }).sort({ serialNo: 1 }).limit(10);
  console.log('\nSample clean voters in DB:');
  sample.forEach(v => {
    console.log(`- #${v.serialNo} ${v.nameHi} (${v.nameEn}) | ${v.relationType}: ${v.relativeNameHi} (${v.relativeNameEn}) | Ward ${v.wardNo} Part ${v.partNo} | ${v.villageNameHi}`);
  });

  await mongoose.disconnect();
}

syncDb().catch(console.error);
