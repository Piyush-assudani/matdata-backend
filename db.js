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

    // 1. Ensure Neutral, Professional Election Organization exists
    const defaultOrgId = 'org_demo_election_2025';
    let org = await Organization.findById(defaultOrgId);
    if (!org) {
      org = await Organization.create({
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
      console.log('✅ Default Election Organization initialized:', org.name);
    } else {
      // Ensure panchayats array is populated
      if (!org.panchayats || org.panchayats.length === 0) {
        org.panchayats = ['ओसियां', 'तिवरी', 'बावड़ी', 'मथानिया'];
        org.allowedPanchayats = ['ओसियां', 'तिवरी', 'बावड़ी', 'मथानिया'];
        await org.save();
      }
    }

    // 2. Ensure Super Admin Account exists
    const adminEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@matdataportal.com').trim().toLowerCase();
    const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123456';
    let adminUser = await User.findOne({ email: adminEmail });
    if (!adminUser) {
      adminUser = await User.create({
        _id: `user_admin_root`,
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        fullName: 'मुख्य व्यवस्थापक (Admin)',
        phone: '9876543210',
        role: 'admin',
        organizationId: defaultOrgId,
        isActive: true,
      });
      console.log(`✅ Default Admin created: ${adminEmail} (Password: ${adminPassword})`);
    }

    // Also ensure demo worker account
    const workerEmail = 'worker@matdataportal.com';
    let workerUser = await User.findOne({ email: workerEmail });
    if (!workerUser) {
      await User.create({
        _id: `user_worker_demo`,
        email: workerEmail,
        passwordHash: await bcrypt.hash('worker123456', 10),
        fullName: 'बूथ कार्यकर्ता (Demo)',
        phone: '9876543211',
        role: 'worker',
        organizationId: defaultOrgId,
        modules: ['voters', 'poll-desk', 'turnout', 'history'],
        isActive: true,
      });
    }

    // 3. Seed Realistic Voters if database has 0 voters
    const voterCount = await Voter.countDocuments({ organizationId: defaultOrgId });
    if (voterCount === 0) {
      console.log('🌱 Seeding sample voter records with Panchayats, Wards, Deleted & Unreadable samples...');
      
      const samplePanchayats = ['ओसियां', 'तिवरी', 'बावड़ी', 'मथानिया'];
      const sampleCastes = ['जाट', 'राजपूत', 'ब्राह्मण', 'विश्नोई', 'मेघवाल', 'प्रजापत', 'मुस्लिम', 'गुर्जर', 'शर्मा'];
      const sampleNames = [
        { name: 'रामनिवास शर्मा', rel: 'राधेश्याम शर्मा', type: 'पिता', gender: 'पुरुष', age: 48, house: '12' },
        { name: 'सुनीता शर्मा', rel: 'रामनिवास शर्मा', type: 'पति', gender: 'स्त्री', age: 44, house: '12' },
        { name: 'मुकेश विश्नोई', rel: 'हनुमानराम विश्नोई', type: 'पिता', gender: 'पुरुष', age: 32, house: '15' },
        { name: 'कविता विश्नोई', rel: 'मुकेश विश्नोई', type: 'पति', gender: 'स्त्री', age: 29, house: '15' },
        { name: 'गणपत प्रजापत', rel: 'घेवरराम प्रजापत', type: 'पिता', gender: 'पुरुष', age: 52, house: '24' },
        { name: 'शांति देवी', rel: 'गणपत प्रजापत', type: 'पति', gender: 'स्त्री', age: 49, house: '24' },
        { name: 'सुरेश कुमार जाट', rel: 'भंवरलाल जाट', type: 'पिता', gender: 'पुरुष', age: 38, house: '31' },
        { name: 'मंजू चौधरी', rel: 'सुरेश कुमार जाट', type: 'पति', gender: 'स्त्री', age: 35, house: '31' },
        { name: 'अशोक सिंह', rel: 'डूंगर सिंह', type: 'पिता', gender: 'पुरुष', age: 42, house: '45' },
        { name: 'नसीम बानो', rel: 'मोहम्मद आरिफ', type: 'पति', gender: 'स्त्री', age: 36, house: '56' },
        { name: 'किशनलाल मेघवाल', rel: 'मोहनराम मेघवाल', type: 'पिता', gender: 'पुरुष', age: 55, house: '62' },
        { name: 'तारा देवी', rel: 'किशनलाल मेघवाल', type: 'पति', gender: 'स्त्री', age: 51, house: '62' },
        { name: 'प्रकाश सोलंकी', rel: 'बाबूलाल सोलंकी', type: 'पिता', gender: 'पुरुष', age: 26, house: '78' },
        { name: 'पूजा सोलंकी', rel: 'प्रकाश सोलंकी', type: 'पति', gender: 'स्त्री', age: 24, house: '78' },
        { name: 'भंवर सिंह राठौड़', rel: 'गोविंद सिंह राठौड़', type: 'पिता', gender: 'पुरुष', age: 60, house: '89' },
      ];

      const votersToInsert = [];
      let serialCounter = 1;

      // Create Active voters across 4 Panchayats and 5 Wards
      for (const panchayat of samplePanchayats) {
        for (let ward = 1; ward <= 3; ward++) {
          for (let i = 0; i < sampleNames.length; i++) {
            const item = sampleNames[i];
            const caste = sampleCastes[i % sampleCastes.length];
            votersToInsert.push({
              _id: `voter_${defaultOrgId}_${serialCounter}`,
              epic: `RJ/24/OSN/${String(serialCounter).padStart(7, '0')}`,
              wardNo: String(ward),
              panchayat: panchayat,
              panchayatHi: panchayat,
              partNo: String(ward),
              serialNo: serialCounter,
              nameEn: item.name,
              nameHi: item.name,
              relativeNameEn: item.rel,
              relativeNameHi: item.rel,
              relationType: item.type,
              houseNo: item.house,
              age: item.age,
              gender: item.gender,
              caste: caste,
              status: 'Active',
              supportStatus: i % 3 === 0 ? 'core' : i % 3 === 1 ? 'swing' : 'unmarked',
              voted: i % 4 === 0,
              organizationId: defaultOrgId,
              isMigrant: i === 7,
              migrantLocation: i === 7 ? 'अहमदाबाद (गुजरात)' : '',
            });
            serialCounter++;
          }
        }
      }

      // Add Sample DELETED Voters (ECI विलोपित) for the Review/Recovery panel
      votersToInsert.push(
        {
          _id: `voter_${defaultOrgId}_deleted_1`,
          epic: `RJ/24/OSN/DEL0001`,
          wardNo: '1',
          panchayat: 'ओसियां',
          panchayatHi: 'ओसियां',
          partNo: '1',
          serialNo: 991,
          nameEn: 'मोहनलाल सुथार',
          nameHi: 'मोहनलाल सुथार (विलोपित)',
          relativeNameEn: 'चुन्नीलाल सुथार',
          relativeNameHi: 'चुन्नीलाल सुथार',
          relationType: 'पिता',
          houseNo: '18',
          age: 68,
          gender: 'पुरुष',
          caste: 'सुथार',
          status: 'Deleted',
          notes: 'मतदाता सूची में विलोपित (#DELETED#) मार्क था',
          organizationId: defaultOrgId,
        },
        {
          _id: `voter_${defaultOrgId}_deleted_2`,
          epic: `RJ/24/OSN/DEL0002`,
          wardNo: '2',
          panchayat: 'तिवरी',
          panchayatHi: 'तिवरी',
          partNo: '2',
          serialNo: 992,
          nameEn: 'कमला देवी',
          nameHi: 'कमला देवी (विलोपित)',
          relativeNameEn: 'मदनलाल सैन',
          relativeNameHi: 'मदनलाल सैन',
          relationType: 'पति',
          houseNo: '44',
          age: 58,
          gender: 'स्त्री',
          caste: 'सैन',
          status: 'Deleted',
          notes: 'मतदाता सूची में विलोपित (#DELETED#) मार्क था',
          organizationId: defaultOrgId,
        }
      );

      // Add Sample UNREADABLE Voters (अपठनीय / धुंधला OCR) for the Edit/Add panel
      votersToInsert.push(
        {
          _id: `voter_${defaultOrgId}_unreadable_1`,
          epic: `RJ/24/OSN/UNR0001`,
          wardNo: '1',
          panchayat: 'ओसियां',
          panchayatHi: 'ओसियां',
          partNo: '1',
          serialNo: 995,
          nameEn: 'अपठनीय मतदाता #995',
          nameHi: 'धुंधला नाम (अपठनीय #995)',
          relativeNameEn: 'गोपाराम',
          relativeNameHi: 'गोपाराम',
          relationType: 'पिता',
          houseNo: '52',
          age: 32,
          gender: 'पुरुष',
          status: 'Unreadable',
          notes: 'PDF स्कैन में नाम धुंधला/अस्पष्ट था - संपादन की आवश्यकता है',
          organizationId: defaultOrgId,
        },
        {
          _id: `voter_${defaultOrgId}_unreadable_2`,
          epic: `RJ/24/OSN/UNR0002`,
          wardNo: '3',
          panchayat: 'बावड़ी',
          panchayatHi: 'बावड़ी',
          partNo: '3',
          serialNo: 996,
          nameEn: 'अपठनीय मतदाता #996',
          nameHi: 'धुंधला नाम (अपठनीय #996)',
          relativeNameEn: 'भंवरू खां',
          relativeNameHi: 'भंवरू खां',
          relationType: 'पिता',
          houseNo: '81',
          age: 40,
          gender: 'पुरुष',
          status: 'Unreadable',
          notes: 'PDF स्कैन में नाम धुंधला/अस्पष्ट था - संपादन की आवश्यकता है',
          organizationId: defaultOrgId,
        }
      );

      await Voter.insertMany(votersToInsert, { ordered: false });
      console.log(`✅ Inserted ${votersToInsert.length} demo voters with Panchayat and Ward support!`);
    }
  } catch (err) {
    console.error('Database initialization notice:', err.message);
  }
};

module.exports = {
  ensureSchema,
  connectDB: async () => {
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/matdataportal';
    try {
      console.log('Connecting to MongoDB at:', uri);
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 20,
      });
      console.log('✅ Standalone MongoDB Connected Successfully!');
    } catch (standaloneErr) {
      console.warn('⚠️ Standalone MongoDB not running locally. Starting In-Memory MongoDB Server for 100% offline local demo...');
      try {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        inMemoryServer = await MongoMemoryServer.create();
        const memoryUri = inMemoryServer.getUri();
        await mongoose.connect(memoryUri, {
          maxPoolSize: 20,
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
