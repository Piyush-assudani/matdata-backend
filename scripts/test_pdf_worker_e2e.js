const { Worker } = require('worker_threads');
const path = require('path');

console.log('Testing PDF Worker -> Python Engine -> Excel -> Ingestion pipeline...');

const worker = new Worker(path.join(__dirname, '../workers/pdfWorker.js'), {
  workerData: {
    filePath: '/Users/piyush/Downloads/WithPhoto_RAMDEORA-Ward No-006.pdf',
    organizationId: 'org_demo_election_2025',
    useOcr: true,
    wardNo: '',
    boothNo: '',
    uploadedBy: 'admin'
  }
});

worker.on('message', (msg) => {
  if (msg.type === 'progress') {
    console.log(`[Progress ${msg.data}%]: ${msg.stage}`);
  } else if (msg.type === 'done') {
    console.log(`\n🎉 SUCCESS! Extracted ${msg.epicsCount} voters!`);
    console.log(`Generated Excel Path: ${msg.excelPath}`);
    console.log(`Excel Filename: ${msg.excelFilename}`);
    
    console.log('\nFirst 5 verified voters from generated operations:');
    const sample = msg.data.slice(0, 5).map(op => op.updateOne.update.$set);
    sample.forEach(s => {
      console.log(`  #${s.serialNo} ${s.nameHi} (${s.nameEn}) | ${s.relationType}: ${s.relativeNameHi} (${s.relativeNameEn}) | Ward: ${s.wardNo} Part: ${s.partNo} | Village: ${s.villageNameHi}`);
    });
    process.exit(0);
  } else if (msg.type === 'error') {
    console.error('Worker error message:', msg.data);
    process.exit(1);
  }
});

worker.on('error', (err) => {
  console.error('Worker thread crashed:', err);
  process.exit(1);
});
