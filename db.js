const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Organization, User, Voter, SlipDispatch, Lead } = require('./models/index');

let inMemoryServer = null;

const ensureSchema = async () => {
  try {
    // Background index sync
    Promise.all([
      Voter.init(),
      User.init(),
      Organization.init(),
      SlipDispatch.init(),
      Lead.init(),
    ]).catch((idxErr) => console.warn('Background index sync notice:', idxErr.message));

    // 1. Determine default organization (only create starter org if DB is completely empty)
    let defaultOrgId = 'org_demo_election_2025';
    const existingOrgCount = await Organization.countDocuments();
    if (existingOrgCount === 0) {
      const org = await Organization.create({
        _id: defaultOrgId,
        name: 'ग्राम पंचायत ओसियां (चुनाव क्षेत्र)',
        district: 'जोधपुर',
        ulbPanchayatSamiti: 'ओसियां',
        ulbWardGramPanchayat: 'ओसियां',
        wards: ['1', '2', '3', '4', '5'],
        panchayats: ['ओसियां', 'तिवरी', 'बावड़ी', 'मथानिया'],
        allowedWards: ['1', '2', '3', '4', '5'],
        allowedPanchayats: ['ओसियां', 'तिवरी', 'बावड़ी', 'मथानिया'],
        enabledModules: ['voters', 'poll-desk', 'turnout', 'warroom', 'history', 'community', 'workers', 'migrants', 'accounts', 'admin'],
        isActive: true,
      });
      console.log('✅ Starter Election Organization initialized:', org.name);
    } else {
      const existingOrg = await Organization.findById(defaultOrgId) || await Organization.findOne();
      if (existingOrg) {
        defaultOrgId = existingOrg._id;
      }
    }

    // 2. Ensure Master Admin Account (matdata / matdata@123456&qwerty)
    const masterPassHash = await bcrypt.hash('matdata@123456&qwerty', 10);
    let masterAdmin = await User.findOne({
      $or: [{ username: /^matdata$/i }, { email: /^matdata@/i }]
    });
    if (!masterAdmin) {
      masterAdmin = await User.create({
        _id: 'user_admin_master_matdata',
        username: 'matdata',
        email: 'matdata@matdataportal.com',
        passwordHash: masterPassHash,
        initialPassword: 'matdata@123456&qwerty',
        fullName: 'Matdata Master Admin',
        phone: '9876543210',
        role: 'admin',
        organizationId: defaultOrgId,
        isActive: true,
      });
      console.log('✅ Master Admin created: ID: matdata, Pass: matdata@123456&qwerty');
    } else {
      masterAdmin.username = 'matdata';
      masterAdmin.passwordHash = masterPassHash;
      masterAdmin.initialPassword = 'matdata@123456&qwerty';
      masterAdmin.role = 'admin';
      masterAdmin.isActive = true;
      await masterAdmin.save();
      console.log('✅ Master Admin updated: ID: matdata');
    }

    // 3. Optional Second Admin Account (Configurable via environment variables)
    const secondAdminUser = (process.env.SECOND_ADMIN_USERNAME || '').trim();
    if (secondAdminUser) {
      const secondAdminPass = process.env.SECOND_ADMIN_PASSWORD || 'ChangeMe123!';
      const secondPassHash = await bcrypt.hash(secondAdminPass, 10);
      const secondAdminEmail = (process.env.SECOND_ADMIN_EMAIL || `${secondAdminUser.toLowerCase()}@chunavranniti.com`).trim();
      const secondAdminPhone = (process.env.SECOND_ADMIN_PHONE || '9876543210').trim();
      const secondAdminName = (process.env.SECOND_ADMIN_FULL_NAME || `${secondAdminUser} (व्यवस्थापक)`).trim();

      let secondAdmin = await User.findOne({
        $or: [{ username: new RegExp(`^${secondAdminUser}$`, 'i') }, { email: new RegExp(`^${secondAdminEmail}$`, 'i') }]
      });
      if (!secondAdmin) {
        secondAdmin = await User.create({
          _id: `user_admin_${secondAdminUser.toLowerCase()}`,
          username: secondAdminUser,
          email: secondAdminEmail,
          passwordHash: secondPassHash,
          initialPassword: secondAdminPass,
          fullName: secondAdminName,
          phone: secondAdminPhone,
          role: 'admin',
          organizationId: defaultOrgId,
          isActive: true,
        });
        console.log(`✅ Second Admin initialized from ENV: ID: ${secondAdminUser}`);
      } else {
        secondAdmin.username = secondAdminUser;
        secondAdmin.role = 'admin';
        secondAdmin.isActive = true;
        await secondAdmin.save();
      }
    }

    // 4. Default admin fallback
    const adminEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@matdataportal.com').trim().toLowerCase();
    const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123456';
    let defaultAdminUser = await User.findOne({ email: adminEmail });
    if (!defaultAdminUser) {
      await User.create({
        _id: `user_admin_root`,
        email: adminEmail,
        username: 'admin',
        passwordHash: await bcrypt.hash(adminPassword, 10),
        fullName: 'मुख्य व्यवस्थापक (Admin)',
        phone: '9876543210',
        role: 'admin',
        organizationId: defaultOrgId,
        isActive: true,
      });
    }

    // 5. Automatic dummy seeding disabled: respects manual client creation and deletion
  } catch (err) {
    console.error('Database initialization notice:', err.message);
  }
};

module.exports = {
  ensureSchema,
  connectDB: async () => {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/matdataportal';
    try {
      const sanitizedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
      console.log('Connecting to MongoDB at:', sanitizedUri);
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 50,
        minPoolSize: 5,
        socketTimeoutMS: 45000,
      });
      console.log('✅ Standalone MongoDB Connected Successfully!');
    } catch (standaloneErr) {
      console.warn('⚠️ Standalone MongoDB not running locally. Starting In-Memory MongoDB Server for 100% offline local demo...');
      try {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        inMemoryServer = await MongoMemoryServer.create();
        const memoryUri = inMemoryServer.getUri();
        await mongoose.connect(memoryUri, {
          maxPoolSize: 50,
          minPoolSize: 5,
          socketTimeoutMS: 45000,
        });
        console.log('✅ In-Memory MongoDB Server Connected Successfully at:', memoryUri);
      } catch (memErr) {
        console.error('❌ Failed to start In-Memory MongoDB:', memErr.message);
        throw memErr;
      }
    }

    await ensureSchema();
  },
  stopDB: async () => {
    await mongoose.disconnect();
    if (inMemoryServer) {
      await inMemoryServer.stop();
    }
  }
};
