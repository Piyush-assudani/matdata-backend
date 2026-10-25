const assert = require('node:assert/strict');
const { groupVotersIntoFamilies } = require('../lib/familyService');

const voters = [
  // Family 1 in House 1: Durgaram's family
  { _id: '1', wardNo: '1', partNo: '1', serialNo: 16, nameHi: 'हेमलता', relativeNameHi: 'दुर्गाराम', relationType: 'पति', houseNo: '1', age: 67 },
  { _id: '2', wardNo: '1', partNo: '1', serialNo: 18, nameHi: 'तेज प्रकाश', relativeNameHi: 'दुर्गाराम', relationType: 'पिता', houseNo: '1', age: 37 },
  { _id: '3', wardNo: '1', partNo: '1', serialNo: 20, nameHi: 'हितेषकुमार', relativeNameHi: 'दुर्गाराम', relationType: 'पिता', houseNo: '1', age: 31 },
  { _id: '4', wardNo: '1', partNo: '1', serialNo: 21, nameHi: 'गीता', relativeNameHi: 'हितेषकुमार', relationType: 'पति', houseNo: '1', age: 29 },

  // Family 2 in House 2:
  { _id: '5', wardNo: '1', partNo: '1', serialNo: 24, nameHi: 'रामूराम', relativeNameHi: 'पाबूराम', relationType: 'पिता', houseNo: '2', age: 68 },
  { _id: '6', wardNo: '1', partNo: '1', serialNo: 25, nameHi: 'कमला देवी', relativeNameHi: 'रामूराम', relationType: 'पति', houseNo: '2', age: 62 },

  // Voters with MISSING house number '-':
  // Pair A: Husband & Wife with house '-' (serial 50, 51) -> SHOULD FORM A FAMILY
  { _id: '7', wardNo: '1', partNo: '1', serialNo: 50, nameHi: 'सुरेश', relativeNameHi: 'मदनलाल', relationType: 'पिता', houseNo: '-', age: 35 },
  { _id: '8', wardNo: '1', partNo: '1', serialNo: 51, nameHi: 'पूजा', relativeNameHi: 'सुरेश', relationType: 'पति', houseNo: '-', age: 30 },

  // Unrelated person with house '-' (serial 120, different father) -> MUST NOT MERGE with Suresh & Pooja!
  { _id: '9', wardNo: '1', partNo: '1', serialNo: 120, nameHi: 'राजेश', relativeNameHi: 'भगवानदास', relationType: 'पिता', houseNo: '-', age: 45 },

  // Another unrelated person with house '-' (serial 250) -> MUST NOT MERGE!
  { _id: '10', wardNo: '1', partNo: '1', serialNo: 250, nameHi: 'अनिल', relativeNameHi: 'चम्पालाल', relationType: 'पिता', houseNo: '-', age: 28 },
];

const { families, voterFamilyMap } = groupVotersIntoFamilies(voters);

console.log('Total families formed:', families.length);
families.forEach((f, i) => {
  console.log(`Family ${i + 1}: ID=${f.familyId}, House=${f.houseNo}, Members=${f.memberCount}, Head=${f.headName}`);
  console.log('   Members:', f.members.map(m => `${m.nameHi} (${m.relativeNameHi})`).join(', '));
});

// Assertions:
// 1. Durgaram's family should have 4 members
const durgaramFam = families.find(f => f.houseNo === '1');
assert.ok(durgaramFam, 'House 1 family must exist');
assert.equal(durgaramFam.memberCount, 4, 'House 1 must have 4 members');

// 2. Ramu Ram's family in House 2 should have 2 members
const ramuFam = families.find(f => f.houseNo === '2');
assert.ok(ramuFam, 'House 2 family must exist');
assert.equal(ramuFam.memberCount, 2, 'House 2 must have 2 members');

// 3. Suresh & Pooja with house '-' MUST form their own 2-member family
const sureshFam = families.find(f => f.members.some(m => m.nameHi === 'सुरेश'));
assert.ok(sureshFam, 'Suresh family must exist');
assert.equal(sureshFam.memberCount, 2, 'Suresh family must have exactly 2 members (Suresh & Pooja)');
assert.ok(sureshFam.members.some(m => m.nameHi === 'पूजा'), 'Pooja must be in Suresh family');

// 4. Rajesh (serial 120, house '-') MUST BE in his own family, NOT in Suresh family!
const rajeshFam = families.find(f => f.members.some(m => m.nameHi === 'राजेश'));
assert.ok(rajeshFam, 'Rajesh family must exist');
assert.equal(rajeshFam.memberCount, 1, 'Rajesh must be isolated in his own 1-person family');

// 5. Anil (serial 250, house '-') MUST BE in his own family!
const anilFam = families.find(f => f.members.some(m => m.nameHi === 'अनिल'));
assert.ok(anilFam, 'Anil family must exist');
assert.equal(anilFam.memberCount, 1, 'Anil must be isolated in his own 1-person family');

console.log('✅ ALL FAMILY GROUPING UNIT TESTS PASSED PERFECTLY!');
