const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { ensureSchema } = require('../db');
const { User, Organization, Voter } = require('../models/index');

async function seedDatabase() {
  const uri = process.argv[2] || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/matdataportal';
  console.log('🌱 Connecting to database:', uri.replace(/:[^:@]+@/, ':****@'));

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
  });

  console.log('✅ Connected to MongoDB. Seeding schemas, organizations, users, and voters...');
  await ensureSchema();

  console.log('\n--- VERIFYING SEEDED USERS IN DATABASE ---');
  const allUsers = await User.find({}, { username: 1, email: 1, role: 1, organizationId: 1, isActive: 1 }).lean();
  console.table(allUsers.map((u) => ({
    Username: u.username,
    Email: u.email,
    Role: u.role,
    OrgID: u.organizationId,
    Active: u.isActive,
  })));

  const orgCount = await Organization.countDocuments();
  const voterCount = await Voter.countDocuments();
  console.log(`\n✅ Database Verification Complete:`);
  console.log(`   - Organizations in DB: ${orgCount}`);
  console.log(`   - Users in DB: ${allUsers.length}`);
  console.log(`   - Total Voters in DB: ${voterCount}`);

  await mongoose.disconnect();
  console.log('✅ Database connection closed. Done!\n');
}

seedDatabase().catch((err) => {
  console.error('❌ Seeding failed:', err.message);
  process.exit(1);
});
