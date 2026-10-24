const mongoose = require('mongoose');

const OLD_URI = 'mongodb+srv://piyushassudani96_db_user:eoKh9bK8PeQAr9pM@cluster0.bhch59g.mongodb.net/matdataportal?retryWrites=true&w=majority';
const NEW_URI = 'mongodb+srv://sureshjangid737_db_user:jaim53KMWcnj6jiq@cluster0.ce7t1wk.mongodb.net/test?retryWrites=true&w=majority';

async function migrateData() {
  console.log('--- STARTING DATABASE MIGRATION TO NEW ATLAS CLUSTER ---');

  // 1. Connect to both databases
  console.log('Connecting to OLD database...');
  const oldConn = await mongoose.createConnection(OLD_URI).asPromise();
  console.log('✅ Connected to OLD database.');

  console.log('Connecting to NEW database...');
  const newConn = await mongoose.createConnection(NEW_URI).asPromise();
  console.log('✅ Connected to NEW database.');

  const oldDb = oldConn.db;
  const newDb = newConn.db;

  // 2. Fetch 'moongra' organization from Old DB
  console.log('\n1. Fetching "moongra" client organization from Old DB...');
  const moongraOrg = await oldDb.collection('organizations').findOne({ name: 'moongra' });
  if (!moongraOrg) {
    throw new Error('Could not find "moongra" organization in old DB!');
  }
  const moongraOrgId = moongraOrg._id;
  console.log(`Found moongra organization: ${moongraOrg.name} (ID: ${moongraOrgId})`);
  console.log(`Admin email: ${moongraOrg.adminEmail}, Candidate: ${moongraOrg.slipConfig?.candidateName || 'N/A'}`);

  // 3. Clear existing data in New DB
  console.log('\n2. Cleaning placeholder data in New DB...');
  await newDb.collection('organizations').deleteMany({});
  await newDb.collection('users').deleteMany({});
  await newDb.collection('voters').deleteMany({});
  await newDb.collection('learneddictionaries').deleteMany({});
  await newDb.collection('connectionchecks').deleteMany({});
  console.log('✅ New DB collections cleaned.');

  // 4. Insert moongra organization into New DB
  console.log('\n3. Inserting "moongra" organization into New DB...');
  await newDb.collection('organizations').insertOne(moongraOrg);
  console.log('✅ moongra organization inserted.');

  // 5. Migrate users: Master Admins + Moongra Users
  console.log('\n4. Migrating Users...');
  const oldUsers = await oldDb.collection('users').find({}).toArray();
  const usersToInsert = [];

  for (const u of oldUsers) {
    // If it's a platform admin, point their default organization to moongra
    if (u.role === 'admin') {
      u.organizationId = moongraOrgId;
      usersToInsert.push(u);
      console.log(` - Admin User: ${u.username || u.email} (${u.role}) included.`);
    } 
    // If it's moongra's tenant_admin or worker, include them
    else if (u.organizationId === moongraOrgId) {
      usersToInsert.push(u);
      console.log(` - Moongra User: ${u.email || u.fullName} (${u.role}) included.`);
    } 
    else {
      console.log(` - Skipping other client user: ${u.email} (Org: ${u.organizationId})`);
    }
  }

  if (usersToInsert.length > 0) {
    await newDb.collection('users').insertMany(usersToInsert);
    console.log(`✅ ${usersToInsert.length} users migrated successfully.`);
  }

  // 6. Migrate Voters (all 738 belonging to moongra)
  console.log('\n5. Migrating Voters...');
  const oldVoters = await oldDb.collection('voters').find({ organizationId: moongraOrgId }).toArray();
  console.log(`Found ${oldVoters.length} voters for moongra in old DB.`);

  if (oldVoters.length > 0) {
    // Insert in batches of 500
    const batchSize = 500;
    for (let i = 0; i < oldVoters.length; i += batchSize) {
      const batch = oldVoters.slice(i, i + batchSize);
      await newDb.collection('voters').insertMany(batch);
      console.log(` - Inserted batch ${Math.floor(i / batchSize) + 1} (${batch.length} voters)`);
    }
    console.log(`✅ All ${oldVoters.length} voters migrated successfully.`);
  }

  // 7. Migrate Learned Dictionaries
  console.log('\n6. Migrating Learned Dictionaries...');
  const oldDicts = await oldDb.collection('learneddictionaries').find({}).toArray();
  console.log(`Found ${oldDicts.length} learned dictionary entries in old DB.`);
  if (oldDicts.length > 0) {
    await newDb.collection('learneddictionaries').insertMany(oldDicts);
    console.log(`✅ ${oldDicts.length} dictionary entries migrated.`);
  }

  // 8. Verify Counts in New DB
  console.log('\n=== VERIFYING FINAL COUNTS IN NEW DB ===');
  const newOrgsCount = await newDb.collection('organizations').countDocuments();
  const newUsersCount = await newDb.collection('users').countDocuments();
  const newVotersCount = await newDb.collection('voters').countDocuments();
  const newDictsCount = await newDb.collection('learneddictionaries').countDocuments();

  console.log(`- Organizations: ${newOrgsCount} (Expected: 1 - moongra)`);
  console.log(`- Users: ${newUsersCount} (Expected: 5)`);
  console.log(`- Voters: ${newVotersCount} (Expected: 738)`);
  console.log(`- Learned Dictionaries: ${newDictsCount} (Expected: 510)`);

  await oldConn.close();
  await newConn.close();

  console.log('\n🎉 MIGRATION COMPLETED SUCCESSFULLY!');
}

migrateData().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
