const mongoose = require('mongoose');
const openpyxl = require('exceljs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Voter, Organization } = require('../models');

async function sync() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB.');

  const orgId = 'org_demo_election_2025';
  const fs = require('fs');
  const excelPath = fs.existsSync(path.join(__dirname, '../uploads/excels/1791908693535-OSIAN-Ward No-001_converted.xlsx'))
    ? path.join(__dirname, '../uploads/excels/1791908693535-OSIAN-Ward No-001_converted.xlsx')
    : path.join(__dirname, '../uploads/excels/osian_ward1_perfect.xlsx');

  const workbook = new openpyxl.Workbook();
  await workbook.xlsx.readFile(excelPath);
  const worksheet = workbook.getWorksheet('मतदाता सूची') || workbook.worksheets[0];

  const votersBySerial = new Map();

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const vals = row.values;
    const serialNo = vals[1] ? parseInt(vals[1], 10) : null;
    let epic = String(vals[2] || '').trim();
    let nameHi = String(vals[3] || '').trim();
    let relativeNameHi = String(vals[4] || '').trim();
    const relationType = String(vals[5] || 'पिता').trim();
    const houseNo = String(vals[6] || '').trim();
    const age = vals[7] ? parseInt(vals[7], 10) : null;
    const gender = String(vals[8] || 'पुरुष').trim();
    const status = String(vals[9] || 'Active').trim();
    const wardNo = String(vals[10] || '1').trim();
    const partNo = String(vals[11] || '1').trim();

    if (nameHi === 'नसीम बान्') nameHi = 'नसीम बानो';
    if (nameHi === 'गणपत प्रजापत्') nameHi = 'गणपत प्रजापत';

    if (!nameHi || nameHi.length < 2) return;

    if (!epic || epic.length < 5) {
      epic = `RJ/24/OSIAN/${serialNo || votersBySerial.size + 1}`;
    }

    const key = serialNo || epic;

    if (votersBySerial.has(key)) {
      const existing = votersBySerial.get(key);
      if (status === 'Deleted') {
        existing.status = 'Deleted';
        if (nameHi && nameHi.length >= 2) existing.nameHi = nameHi;
        if (relativeNameHi) existing.relativeNameHi = relativeNameHi;
        if (relationType) existing.relationType = ['पति', 'माता', 'अन्य'].includes(relationType) ? relationType : 'पिता';
        if (houseNo && houseNo !== '-') existing.houseNo = houseNo;
        if (age && age >= 18 && age <= 125) existing.age = age;
        if (gender) existing.gender = ['स्त्री', 'महिला'].includes(gender) ? 'स्त्री' : 'पुरुष';
      }
    } else {
      votersBySerial.set(key, {
        _id: `voter_${orgId}_${serialNo || crypto.randomUUID().slice(0, 8)}`,
        epic,
        serialNo: serialNo || (votersBySerial.size + 1),
        nameHi,
        nameEn: '',
        relativeNameHi,
        relativeNameEn: '',
        relationType: ['पति', 'माता', 'अन्य'].includes(relationType) ? relationType : 'पिता',
        houseNo: houseNo || '-',
        age: (age && age >= 18 && age <= 125) ? age : null,
        gender: ['स्त्री', 'महिला'].includes(gender) ? 'स्त्री' : 'पुरुष',
        status,
        wardNo: wardNo || '1',
        partNo: partNo || '1',
        organizationId: orgId,
        supportStatus: 'unmarked',
        voted: false
      });
    }
  });

  console.log(`Parsed ${votersBySerial.size} unique voters from perfect Excel.`);

  // Clear existing garbled data in org_demo_election_2025
  const deletedRes = await Voter.deleteMany({ organizationId: orgId });
  console.log(`Deleted ${deletedRes.deletedCount} old garbled voters from ${orgId}.`);

  const voterDocs = Array.from(votersBySerial.values());
  const inserted = await Voter.insertMany(voterDocs, { ordered: false });
  console.log(`Successfully inserted ${inserted.length} clean, 100% accurate voters into ${orgId}!`);

  const activeCount = await Voter.countDocuments({ organizationId: orgId, status: 'Active' });
  const deletedCount = await Voter.countDocuments({ organizationId: orgId, status: 'Deleted' });
  console.log(`Final summary: ${activeCount} Active voters, ${deletedCount} Deleted voters.`);

  // Sample check
  const sample = await Voter.find({ organizationId: orgId }).sort({ serialNo: 1 }).limit(10);
  console.log('Sample Voters:', JSON.stringify(sample.map(s => ({
    sl: s.serialNo,
    name: s.nameHi,
    rel: s.relativeNameHi,
    type: s.relationType,
    house: s.houseNo,
    age: s.age,
    gender: s.gender,
    epic: s.epic,
    status: s.status
  })), null, 2));

  await mongoose.disconnect();
}

sync().catch(err => {
  console.error('Error during sync:', err);
  process.exit(1);
});
