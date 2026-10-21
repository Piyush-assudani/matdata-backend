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

    // 3. Ensure Second Admin Account (Piyushassudani / 9413879444)
    const secondPassHash = await bcrypt.hash('9413879444', 10);
    let secondAdmin = await User.findOne({
      $or: [{ username: /^Piyushassudani$/i }, { email: /^piyushassudani@/i }]
    });
    if (!secondAdmin) {
      secondAdmin = await User.create({
        _id: 'user_admin_piyushassudani',
        username: 'Piyushassudani',
        email: 'piyushassudani@matdataportal.com',
        passwordHash: secondPassHash,
        initialPassword: '9413879444',
        fullName: 'Piyush Assudani (Admin)',
        phone: '9413879444',
        role: 'admin',
        organizationId: defaultOrgId,
        isActive: true,
      });
      console.log('✅ Second Admin created: ID: Piyushassudani, Pass: 9413879444');
    } else {
      secondAdmin.username = 'Piyushassudani';
      secondAdmin.passwordHash = secondPassHash;
      secondAdmin.initialPassword = '9413879444';
      secondAdmin.role = 'admin';
      secondAdmin.isActive = true;
      await secondAdmin.save();
      console.log('✅ Second Admin updated: ID: Piyushassudani');
    }

    // Default admin fallback
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

    // 4. Ensure Dummy Client (Candidate/Organization) exists
    const clientOrgId = 'org_client_demo';
    let clientOrg = await Organization.findById(clientOrgId);
    if (!clientOrg) {
      clientOrg = await Organization.create({
        _id: clientOrgId,
        name: 'विधानसभा क्षेत्र 14 (प्रत्याशी वॉर-रूम डेमो)',
        district: 'जयपुर',
        ulbPanchayatSamiti: 'विधानसभा 14',
        ulbWardGramPanchayat: 'वार्ड 1-10',
        wards: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
        panchayats: ['वार्ड 1', 'वार्ड 2', 'वार्ड 3', 'वार्ड 4', 'वार्ड 5', 'वार्ड 6', 'वार्ड 7', 'वार्ड 8', 'वार्ड 9', 'वार्ड 10'],
        allowedWards: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
        allowedPanchayats: ['वार्ड 1', 'वार्ड 2', 'वार्ड 3', 'वार्ड 4', 'वार्ड 5', 'वार्ड 6', 'वार्ड 7', 'वार्ड 8', 'वार्ड 9', 'वार्ड 10'],
        enabledModules: ['voters', 'slips', 'poll-desk', 'turnout', 'warroom', 'history', 'community', 'workers', 'migrants', 'accounts', 'admin'],
        isActive: true,
        whatsappEnabled: true,
        whatsappCredits: 5000,
        whatsappUsed: 120,
      });
      console.log('✅ Dummy Client Organization created:', clientOrg.name);
    }

    // 5. Ensure Client User Account (user@vijaysetu.com / admin123)
    const clientPassHash = await bcrypt.hash('admin123', 10);
    const clientEmails = ['user@vijaysetu.com', 'user@matdataportal.com'];
    for (const cEmail of clientEmails) {
      let clientUser = await User.findOne({ email: new RegExp(`^${cEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
      if (!clientUser) {
        clientUser = await User.create({
          _id: `user_client_${cEmail.split('@')[0]}_${cEmail.split('@')[1].replace(/[^a-zA-Z0-9]/g, '_')}`,
          email: cEmail,
          username: cEmail,
          passwordHash: clientPassHash,
          initialPassword: 'admin123',
          fullName: 'प्रत्याशी (क्लाइंट वॉर-रूम)',
          phone: '9413879444',
          role: 'tenant_admin',
          organizationId: clientOrgId,
          modules: ['voters', 'slips', 'poll-desk', 'turnout', 'warroom', 'history', 'community', 'workers', 'migrants', 'accounts'],
          isActive: true,
        });
        console.log(`✅ Client Account created: ${cEmail} (Password: admin123)`);
      } else {
        clientUser.passwordHash = clientPassHash;
        clientUser.initialPassword = 'admin123';
        clientUser.organizationId = clientOrgId;
        clientUser.role = 'tenant_admin';
        clientUser.isActive = true;
        await clientUser.save();
        console.log(`✅ Client Account updated: ${cEmail}`);
      }
    }

    // 6. Ensure 360+ Voters seeded for the Client Organization
    const clientVoterCount = await Voter.countDocuments({ organizationId: clientOrgId });
    if (clientVoterCount < 300) {
      console.log(`🌱 Seeding 360 realistic voter records for Client Organization (${clientOrgId})...`);
      
      const maleNames = [
        'रामनिवास', 'सुरेश', 'मुकेश', 'गणपत', 'अशोक', 'दिनेश', 'राकेश', 'मनोज', 'प्रकाश', 'राजेश',
        'भंवरलाल', 'डूंगरराम', 'हनुमान', 'कमलेश', 'महेंद्र', 'सत्यनारायण', 'गोविंद', 'विकास', 'संजय', 'अनिल',
        'कैलाश', 'श्रवण', 'ओमप्रकाश', 'जगदीश', 'नरेश', 'पवन', 'सुनील', 'जितेंद्र', 'प्रदीप', 'किशन'
      ];
      const femaleNames = [
        'सुनीता', 'कविता', 'शांति', 'मंजू', 'पूजा', 'गायत्री', 'कौशल्या', 'कमला', 'तारा', 'विमला',
        'संतोष', 'ललिता', 'ममता', 'सरिता', 'रेखा', 'आशा', 'सुशीला', 'सीमा', 'उषा', 'प्रिया',
        'निर्मला', 'अनिता', 'पिंकी', 'दुर्गा', 'मोनिका', 'सुमन', 'किरण', 'गीता', 'माया', 'भावना'
      ];
      const casteList = [
        { caste: 'ब्राह्मण', surHi: 'शर्मा', surEn: 'Sharma' },
        { caste: 'राजपूत', surHi: 'शेखावत', surEn: 'Shekhawat' },
        { caste: 'राजपूत', surHi: 'राठौड़', surEn: 'Rathore' },
        { caste: 'जाट', surHi: 'चौधरी', surEn: 'Choudhary' },
        { caste: 'जाट', surHi: 'जाट', surEn: 'Jat' },
        { caste: 'विश्नोई', surHi: 'विश्नोई', surEn: 'Bishnoi' },
        { caste: 'मेघवाल', surHi: 'मेघवाल', surEn: 'Meghwal' },
        { caste: 'प्रजापत', surHi: 'प्रजापत', surEn: 'Prajapat' },
        { caste: 'मुस्लिम', surHi: 'खान', surEn: 'Khan' },
        { caste: 'गुर्जर', surHi: 'गुर्जर', surEn: 'Gurjar' },
        { caste: 'सैनी', surHi: 'सैनी', surEn: 'Saini' },
        { caste: 'वैश्य', surHi: 'अग्रवाल', surEn: 'Agarwal' }
      ];

      const clientVoters = [];
      const totalToGenerate = 360;

      for (let i = 1; i <= totalToGenerate; i++) {
        const isFemale = i % 2 === 0;
        const firstName = isFemale ? femaleNames[i % femaleNames.length] : maleNames[i % maleNames.length];
        const casteInfo = casteList[i % casteList.length];
        const fullNameHi = `${firstName} ${casteInfo.surHi}`;
        const fullNameEn = `${firstName} ${casteInfo.surEn}`;
        
        const relFirst = maleNames[(i + 7) % maleNames.length];
        const relNameHi = `${relFirst} ${casteInfo.surHi}`;
        const relType = isFemale ? (i % 3 === 0 ? 'पिता' : 'पति') : 'पिता';
        
        const wardNum = ((i - 1) % 10) + 1;
        const houseNum = String(((i * 7) % 85) + 1);
        const age = 18 + ((i * 13) % 65);
        
        const supportModes = ['core', 'swing', 'opponent', 'unmarked'];
        const support = supportModes[i % 4];
        const isVoted = i % 3 === 0;
        const isMigrant = i % 14 === 0;
        const migrantCities = ['सूरत (गुजरात)', 'मुंबई', 'अहमदाबाद', 'बेंगलुरु', 'पुणे', 'दिल्ली'];

        clientVoters.push({
          _id: `voter_${clientOrgId}_${String(i).padStart(4, '0')}`,
          epic: `RJ/14/082/${String(1000 + i).padStart(6, '0')}`,
          wardNo: String(wardNum),
          panchayat: `वार्ड ${wardNum}`,
          panchayatHi: `वार्ड ${wardNum}`,
          partNo: String(wardNum),
          serialNo: i,
          nameEn: fullNameEn,
          nameHi: fullNameHi,
          relativeNameEn: relNameHi,
          relativeNameHi: relNameHi,
          relationType: relType,
          houseNo: houseNum,
          houseNoHi: houseNum,
          age: age,
          gender: isFemale ? 'स्त्री' : 'पुरुष',
          mobileNo: `9829${String(100000 + i).slice(1)}`,
          caste: casteInfo.caste,
          status: i === 357 ? 'Deleted' : i === 358 ? 'Unreadable' : 'Active',
          supportStatus: support,
          voted: isVoted,
          votedAt: isVoted ? new Date(Date.now() - (i * 360000)) : null,
          isMigrant: isMigrant,
          migrantLocation: isMigrant ? migrantCities[i % migrantCities.length] : '',
          villageName: `विधानसभा वार्ड ${wardNum}`,
          villageNameHi: `विधानसभा वार्ड ${wardNum}`,
          boothName: `राजकीय उच्च माध्यमिक विद्यालय, कक्ष क्र. ${wardNum}`,
          organizationId: clientOrgId,
          familyId: `FAM_${wardNum}_${houseNum}`,
          notes: i === 357 ? 'ECI सूची में विलोपित' : i === 358 ? 'धुंधला OCR नाम' : ''
        });
      }

      await Voter.insertMany(clientVoters, { ordered: false });
      console.log(`✅ Successfully inserted ${clientVoters.length} voter records for Client Organization!`);
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
