const mongoose = require('mongoose');

// ==========================================
// MONGODB SCHEMAS WITH ADVANCED INDEXING
// ==========================================

const organizationSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  name: { type: String, required: true },
  enabledModules: { type: [String], default: [] },
  allowedWards: { type: [String], default: [] },
  wards: { type: [String], default: [] },
  panchayats: { type: [String], default: [] },
  allowedPanchayats: { type: [String], default: [] },
  isActive: { type: Boolean, default: true },
  whatsappEnabled: { type: Boolean, default: true },
  whatsappCredits: { type: Number, default: 100 },
  whatsappUsed: { type: Number, default: 0 },
  slipConfig: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  settings: {
    type: mongoose.Schema.Types.Mixed,
    default: {
      hidePartNo: true
    }
  },
  casteOptions: { type: [String], default: null },
  isDemo: { type: Boolean, default: false },
  demoPassword: { type: String, default: null },
  district: { type: String, default: '' },
  ulbPanchayatSamiti: { type: String, default: '' },
  ulbWardGramPanchayat: { type: String, default: '' },
  adminEmail: { type: String, default: '' },
  initialPassword: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  username: { type: String, default: null },
  passwordHash: { type: String, required: true },
  initialPassword: { type: String, default: null },
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  role: { type: String, required: true },
  subRole: { type: String, default: null },
  scopeType: { type: String, default: null },
  scopeValue: { type: String, default: null },
  modules: { type: [String], default: [] },
  organizationId: { type: String, required: true, index: true },
  casteOptions: { type: [String], default: null },
  isActive: { type: Boolean, default: true },
  isDemo: { type: Boolean, default: false },
  demoPassword: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

// Partial Index removed to avoid duplicates since organizationId already has index: true

const voterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  epic: { type: String, required: true },
  wardNo: { type: String, required: true },
  panchayat: { type: String, default: '' },
  panchayatHi: { type: String, default: '' },
  partNo: { type: String, required: true },
  serialNo: { type: Number, required: true },
  nameEn: { type: String, default: '' },
  nameHi: { type: String, required: true },
  age: { type: Number },
  gender: { type: String },
  relationType: { type: String },
  relativeNameEn: { type: String },
  relativeNameHi: { type: String },
  houseNo: { type: String },
  houseNoHi: { type: String },
  mobileNo: { type: String },
  caste: { type: String },
  supportStatus: { type: String, default: 'unmarked' },
  status: { type: String, default: 'Active' },
  voted: { type: Boolean, default: false },
  votedAt: { type: Date, default: null },
  surety: { type: String },
  notes: { type: String },
  isMigrant: { type: Boolean, default: false },
  migrantLocation: { type: String },
  assignedWorker: { type: String, default: null },
  villageName: { type: String },
  villageNameHi: { type: String },
  boothName: { type: String },
  organizationId: { type: String, required: true },
  familyId: { type: String },
  photoUrl: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

// 🚀 Performance Optimization: Compound Indexes
// Enables ultra-fast O(1) querying and memory-free indexed sorting across millions of records
voterSchema.index({ organizationId: 1, panchayat: 1, wardNo: 1, serialNo: 1 });
voterSchema.index({ organizationId: 1, panchayat: 1, serialNo: 1 });
voterSchema.index({ organizationId: 1, panchayat: 1 });
voterSchema.index({ organizationId: 1, wardNo: 1, partNo: 1, serialNo: 1 });
voterSchema.index({ organizationId: 1, wardNo: 1, serialNo: 1 });
voterSchema.index({ organizationId: 1, wardNo: 1, voted: 1, serialNo: 1 });
voterSchema.index({ organizationId: 1, wardNo: 1, voted: 1 });
voterSchema.index({ organizationId: 1, partNo: 1, serialNo: 1 });
voterSchema.index({ organizationId: 1, serialNo: 1 });
voterSchema.index({ organizationId: 1, wardNo: 1 });
voterSchema.index({ organizationId: 1, wardNo: 1, partNo: 1 });
voterSchema.index({ organizationId: 1, houseNo: 1 });
voterSchema.index({ organizationId: 1, partNo: 1, houseNo: 1 });
voterSchema.index({ organizationId: 1, familyId: 1 });
voterSchema.index({ organizationId: 1, epic: 1 });
voterSchema.index({ organizationId: 1, nameHi: 1 });
voterSchema.index({ organizationId: 1, mobileNo: 1 });
voterSchema.index({ organizationId: 1, caste: 1 });
voterSchema.index({ organizationId: 1, caste: 1, wardNo: 1 });
voterSchema.index({ organizationId: 1, voted: 1 });
voterSchema.index({ organizationId: 1, surety: 1 });
voterSchema.index({ organizationId: 1, assignedWorker: 1 });
voterSchema.index({ organizationId: 1, supportStatus: 1 });
voterSchema.index({ organizationId: 1, supportStatus: 1, wardNo: 1 });
voterSchema.index({ organizationId: 1, isMigrant: 1 });
voterSchema.index({ organizationId: 1, isMigrant: 1, wardNo: 1, serialNo: 1 });

// Organization Model Indexes
organizationSchema.index({ isActive: 1, name: 1 });
organizationSchema.index({ createdAt: -1 });

// User Model Indexes
userSchema.index({ organizationId: 1, role: 1 });
userSchema.index({ organizationId: 1, isActive: 1 });
userSchema.index({ organizationId: 1, role: 1, isActive: 1 });

// 🚀 Performance Optimization: Text Search Index
// Enables fast text searching across multiple name fields (English & Hindi)
voterSchema.index(
  { nameEn: 'text', nameHi: 'text', relativeNameEn: 'text', relativeNameHi: 'text' },
  { weights: { nameHi: 10, nameEn: 5, relativeNameHi: 2, relativeNameEn: 1 } }
);

const slipDispatchSchema = new mongoose.Schema({
  _id: { type: String, default: () => `disp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` },
  voterId: { type: String, required: true, index: true },
  voterEpic: { type: String, default: '' },
  voterName: { type: String, required: true },
  recipientPhone: { type: String, required: true },
  slipType: { type: String, default: 'individual' },
  dispatchType: { type: String, default: 'whatsapp' },
  status: { type: String, required: true }, // 'sent' | 'delivered' | 'read' | 'failed' | 'sending' | 'manual_link'
  deliveredAt: { type: Date, default: null },
  readAt: { type: Date, default: null },
  messageContent: { type: String, default: '' },
  templateName: { type: String, default: '' },
  mediaUrl: { type: String, default: '' },
  campaignName: { type: String, default: '' },
  windowExpiresAt: { type: Date, default: null },
  conversationHistory: {
    type: [
      {
        direction: { type: String, enum: ['outbound', 'inbound'], default: 'outbound' },
        text: { type: String, default: '' },
        mediaUrl: { type: String, default: '' },
        status: { type: String, default: 'sent' }, // sent, delivered, read
        timestamp: { type: Date, default: Date.now },
        messageId: { type: String, default: null }
      }
    ],
    default: []
  },
  providerMessageId: { type: String, default: null, index: true },
  errorMessage: { type: String, default: null },
  organizationId: { type: String, required: true, index: true },
  sentBy: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, index: true }
});

slipDispatchSchema.index({ organizationId: 1, createdAt: -1 });
slipDispatchSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
slipDispatchSchema.index({ organizationId: 1, dispatchType: 1, createdAt: -1 });
slipDispatchSchema.index({ organizationId: 1, campaignName: 1, createdAt: -1 });

const leadSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true, index: true },
  constituency: { type: String, default: '' },
  electionType: { type: String, default: 'विधानसभा (Assembly)' },
  status: { type: String, enum: ['new', 'contacted', 'converted', 'closed'], default: 'new', index: true },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});

leadSchema.index({ status: 1, createdAt: -1 });

const learnedDictionarySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true },
  type: { type: String, enum: ['glyph', 'word', 'name'], default: 'glyph' },
  sourcePdf: { type: String, default: '' },
  confidence: { type: Number, default: 1.0 },
  createdAt: { type: Date, default: Date.now }
});

learnedDictionarySchema.index({ type: 1 });

const systemSettingSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
});

const campaignTemplateSchema = new mongoose.Schema({
  _id: { type: String, default: () => `tmpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` },
  title: { type: String, required: true },
  category: { type: String, default: 'घोषणा पत्र' },
  content: { type: String, required: true },
  badge: { type: String, default: 'स्वीकृत' },
  organizationId: { type: String, default: null, index: true }, // null or 'global' means available to all clients
  status: { type: String, enum: ['approved', 'pending', 'rejected'], default: 'approved', index: true },
  approvedBy: { type: String, default: 'Admin' },
  createdAt: { type: Date, default: Date.now, index: true }
});

campaignTemplateSchema.index({ status: 1, organizationId: 1 });

const Organization = mongoose.model('Organization', organizationSchema);
const User = mongoose.model('User', userSchema);
const Voter = mongoose.model('Voter', voterSchema);
const SlipDispatch = mongoose.model('SlipDispatch', slipDispatchSchema);
const Lead = mongoose.model('Lead', leadSchema);
const LearnedDictionary = mongoose.model('LearnedDictionary', learnedDictionarySchema);
const SystemSetting = mongoose.model('SystemSetting', systemSettingSchema);
const CampaignTemplate = mongoose.model('CampaignTemplate', campaignTemplateSchema);

module.exports = {
  Organization,
  User,
  Voter,
  SlipDispatch,
  Lead,
  LearnedDictionary,
  SystemSetting,
  CampaignTemplate
};

