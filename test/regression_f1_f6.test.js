const assert = require('node:assert/strict');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Voter, Organization } = require('../models');
const { cleanHouseNo } = require('../lib/ocrService');

async function runRegressionSuite() {
  console.log('--- RUNNING F1-F6 REGRESSION TEST SUITE ---');

  // Test F3: House number strict numeric & allowed Devanagari suffix rules
  console.log('Testing F3: House number strict rules...');
  assert.equal(cleanHouseNo('11ग'), '11ग', 'F3 failed: 11ग must be preserved');
  assert.equal(cleanHouseNo('12क'), '12क', 'F3 failed: 12क must be preserved');
  assert.equal(cleanHouseNo('15/ख'), '15/ख', 'F3 failed: 15/ख must be preserved');
  assert.equal(cleanHouseNo('क-12'), 'क-12', 'F3 failed: क-12 must be preserved');
  assert.equal(cleanHouseNo('4लि'), '4', 'F3 failed: 4लि attached noise must become 4');
  assert.equal(cleanHouseNo('2मका'), '2', 'F3 failed: 2मका attached noise must become 2');
  assert.equal(cleanHouseNo('000ju'), '000', 'F3 failed: 000ju english must become 000');
  assert.equal(cleanHouseNo('2kh'), '2', 'F3 failed: english kh must be stripped');
  assert.equal(cleanHouseNo('मका'), '-', 'F3 failed: non-numeric मका must become -');
  assert.equal(cleanHouseNo('. आईसीआईसीआई'), '-', 'F3 failed: non-numeric bank text must become -');
  assert.equal(cleanHouseNo('. नि लि'), '-', 'F3 failed: non-numeric abbreviations must become -');
  assert.equal(cleanHouseNo('मकान संख्या: 2क'), '2क', 'F3 failed: label stripped but 2क preserved');
  console.log('✓ F3 House Number tests passed successfully.');

  // Connect to MongoDB to verify F1, F2, F4, F5, F6
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB. Verifying Osian Ward 1 voters...');

  const orgId = 'org_demo_election_2025';
  const voters = await Voter.find({
    organizationId: orgId,
    serialNo: { $in: [16, 18, 20, 21, 22, 24, 36, 37, 38, 39, 40, 41] }
  }).lean();

  const voterMap = new Map(voters.map(v => [v.serialNo, v]));

  // Regression cases:
  // F6.1: serial 16 हेमलता (पति दुर्गाराम, 1, 67)
  const v16 = voterMap.get(16);
  assert.ok(v16, 'Serial 16 missing');
  assert.equal(v16.nameHi, 'हेमलता', 'Serial 16 name must be हेमलता');
  assert.equal(v16.relativeNameHi, 'दुर्गाराम', 'Serial 16 relative must be दुर्गाराम');
  assert.equal(v16.relationType, 'पति', 'Serial 16 relationType must be पति');
  assert.equal(v16.houseNo, '1', 'Serial 16 houseNo must be 1');
  assert.equal(v16.age, 67, 'Serial 16 age must be 67');
  assert.equal(v16.gender, 'स्त्री', 'Serial 16 gender must be स्त्री');
  console.log('✓ Serial 16 हेमलता passed.');

  // F6.2: serial 18 तेज प्रकाश (पिता दुर्गाराम, 1, 37)
  const v18 = voterMap.get(18);
  assert.ok(v18, 'Serial 18 missing');
  assert.equal(v18.nameHi, 'तेज प्रकाश', 'Serial 18 name must be तेज प्रकाश');
  assert.equal(v18.relativeNameHi, 'दुर्गाराम', 'Serial 18 relative must be दुर्गाराम without mangling');
  assert.equal(v18.relationType, 'पिता', 'Serial 18 relationType must be पिता');
  assert.equal(v18.houseNo, '1', 'Serial 18 houseNo must be 1');
  assert.equal(v18.age, 37, 'Serial 18 age must be 37');
  console.log('✓ Serial 18 तेज प्रकाश passed.');

  // F6.3: serial 20 हितेषकुमार (पिता दुर्गाराम, 1, 31)
  const v20 = voterMap.get(20);
  assert.ok(v20, 'Serial 20 missing');
  assert.equal(v20.nameHi, 'हितेषकुमार', 'Serial 20 name must be हितेषकुमार');
  assert.equal(v20.relativeNameHi, 'दुर्गाराम', 'Serial 20 relative must be दुर्गाराम without mangling');
  assert.equal(v20.relationType, 'पिता', 'Serial 20 relationType must be पिता');
  assert.equal(v20.houseNo, '1', 'Serial 20 houseNo must be 1');
  assert.equal(v20.age, 31, 'Serial 20 age must be 31');
  console.log('✓ Serial 20 हितेषकुमार passed.');

  // F2.1: serial 21 गीता (पति हितेश कुमार, मकान 1, उम्र 29)
  const v21 = voterMap.get(21);
  assert.ok(v21, 'Serial 21 missing');
  assert.equal(v21.nameHi, 'गीता', 'Serial 21 name must be गीता');
  assert.equal(v21.relativeNameHi, 'हितेश कुमार', 'Serial 21 relative must be हितेश कुमार');
  assert.equal(v21.relationType, 'पति', 'Serial 21 relationType must be पति');
  assert.equal(v21.houseNo, '1', 'Serial 21 houseNo must be 1 from clean supplement');
  assert.equal(v21.age, 29, 'Serial 21 age must be 29 from clean supplement');
  assert.equal(v21.status, 'Deleted', 'Serial 21 status must be Deleted');
  console.log('✓ Serial 21 गीता (Supplement Deletion) passed.');

  // F2.2: serial 22 दीपिका रानी (पिता मुकेश कुमार, मकान 1, उम्र 22)
  const v22 = voterMap.get(22);
  assert.ok(v22, 'Serial 22 missing');
  assert.equal(v22.nameHi, 'दीपिका रानी', 'Serial 22 name must be दीपिका रानी');
  assert.equal(v22.relativeNameHi, 'मुकेश कुमार', 'Serial 22 relative must be मुकेश कुमार');
  assert.equal(v22.relationType, 'पिता', 'Serial 22 relationType must be पिता');
  assert.equal(v22.houseNo, '1', 'Serial 22 houseNo must be 1 from clean supplement');
  assert.equal(v22.age, 22, 'Serial 22 age must be 22 from clean supplement');
  assert.equal(v22.status, 'Deleted', 'Serial 22 status must be Deleted');
  console.log('✓ Serial 22 दीपिका रानी (Supplement Deletion) passed.');

  // F2.3: serial 24 रामूराम (पिता पाबूराम, मकान 2, उम्र 68)
  const v24 = voterMap.get(24);
  assert.ok(v24, 'Serial 24 missing');
  assert.equal(v24.nameHi, 'रामूराम', 'Serial 24 name must be रामूराम');
  assert.equal(v24.relativeNameHi, 'पाबूराम', 'Serial 24 relative must be पाबूराम');
  assert.equal(v24.relationType, 'पिता', 'Serial 24 relationType must be पिता');
  assert.equal(v24.houseNo, '2', 'Serial 24 houseNo must be 2 from clean supplement');
  assert.equal(v24.age, 68, 'Serial 24 age must be 68 from clean supplement');
  assert.equal(v24.status, 'Deleted', 'Serial 24 status must be Deleted');
  console.log('✓ Serial 24 रामूराम (Supplement Deletion) passed.');

  // F6.4: serial 36 अनुपा राम (2, 27)
  const v36 = voterMap.get(36);
  assert.ok(v36, 'Serial 36 missing');
  assert.equal(v36.nameHi, 'अनुपा राम', 'Serial 36 name must be अनुपा राम');
  assert.equal(v36.relativeNameHi, 'हरी राम', 'Serial 36 relative must be हरी राम');
  assert.equal(v36.houseNo, '2', 'Serial 36 houseNo must be 2 (latin kh stripped)');
  assert.equal(v36.age, 27, 'Serial 36 age must be 27');
  console.log('✓ Serial 36 अनुपा राम passed.');

  // F6.5: serial 37 सुमित्रा जांगिड़ (2, 26)
  const v37 = voterMap.get(37);
  assert.ok(v37, 'Serial 37 missing');
  assert.equal(v37.nameHi, 'सुमित्रा जांगिड़', 'Serial 37 name must be सुमित्रा जांगिड़ without rogue nuktas');
  assert.equal(v37.relativeNameHi, 'अनुपा राम', 'Serial 37 relative must be अनुपा राम');
  assert.equal(v37.relationType, 'पति', 'Serial 37 relationType must be पति');
  assert.equal(v37.houseNo, '2', 'Serial 37 houseNo must be 2 (latin kh stripped)');
  assert.equal(v37.age, 26, 'Serial 37 age must be 26');
  console.log('✓ Serial 37 सुमित्रा जांगिड़ passed.');

  // F6.6: serial 38 श्रवण (2, 22)
  const v38 = voterMap.get(38);
  assert.ok(v38, 'Serial 38 missing');
  assert.equal(v38.nameHi, 'श्रवण', 'Serial 38 name must be श्रवण');
  assert.equal(v38.relativeNameHi, 'हरी राम', 'Serial 38 relative must be हरी राम without duplicate ह');
  assert.equal(v38.houseNo, '2', 'Serial 38 houseNo must be 2 (latin kh stripped)');
  assert.equal(v38.age, 22, 'Serial 38 age must be 22');
  console.log('✓ Serial 38 श्रवण passed.');

  // F6.7: serial 39 उषा सुतार (2kh, 20)
  const v39 = voterMap.get(39);
  assert.ok(v39, 'Serial 39 missing');
  assert.equal(v39.nameHi, 'उषा सुतार', 'Serial 39 name must be उषा सुतार (not उषा सतार)');
  assert.equal(v39.relativeNameHi, 'श्रवण', 'Serial 39 relative must be श्रवण');
  assert.equal(v39.relationType, 'पति', 'Serial 39 relationType must be पति');
  assert.equal(v39.houseNo, '2', 'Serial 39 houseNo must be 2 (latin kh stripped)');
  assert.equal(v39.age, 20, 'Serial 39 age must be 20');
  console.log('✓ Serial 39 उषा सुतार passed.');

  // F6.8: serial 40 बंसीलाल (2, 20)
  const v40 = voterMap.get(40);
  assert.ok(v40, 'Serial 40 missing');
  assert.equal(v40.nameHi, 'बंसीलाल', 'Serial 40 name must be बंसीलाल');
  assert.equal(v40.relativeNameHi, 'हरी राम', 'Serial 40 relative must be हरी राम');
  assert.equal(v40.houseNo, '2', 'Serial 40 houseNo must be 2 (latin kh stripped)');
  assert.equal(v40.age, 20, 'Serial 40 age must be 20');
  console.log('✓ Serial 40 बंसीलाल passed.');

  // F6.9: serial 41 जेठाराम (पिता केसूराम, 3, 52)
  const v41 = voterMap.get(41);
  assert.ok(v41, 'Serial 41 missing');
  assert.equal(v41.nameHi, 'जेठाराम', 'Serial 41 name must be जेठाराम');
  assert.equal(v41.relativeNameHi, 'केसूराम', 'Serial 41 relative must be केसूराम');
  assert.equal(v41.relationType, 'पिता', 'Serial 41 relationType must be पिता');
  assert.equal(v41.houseNo, '3', 'Serial 41 houseNo must be 3');
  assert.equal(v41.age, 52, 'Serial 41 age must be 52');
  console.log('✓ Serial 41 जेठाराम passed.');

  // F1 check: wardNo and partNo
  assert.equal(v16.wardNo, '1', 'F1: Ward number must be 1 from header');
  assert.equal(v16.partNo, '1', 'F1: Booth / Part number must be 1 from header');
  console.log('✓ F1 Header-Only Ward/Booth tests passed.');

  await mongoose.disconnect();
  console.log('\n===========================================');
  console.log('ALL F1-F6 REGRESSION TESTS PASSED (100% OK)');
  console.log('===========================================\n');
}

runRegressionSuite().catch(err => {
  console.error('REGRESSION TEST FAILED:', err);
  process.exit(1);
});
