const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { app } = require('../index');
const { Organization, User, Voter, SlipDispatch } = require('../models');

const modules = ['voters', 'poll-desk', 'turnout', 'warroom', 'history', 'community', 'workers', 'migrants', 'accounts'];
const workbookMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const runId = crypto.randomUUID().replaceAll('-', '');
const databaseName = `matdata_${runId}_e2e_test`;
const organizationId = `e2e_org_${runId}`;
const otherOrganizationId = `e2e_other_${runId}`;
const tenantAdminId = `e2e_admin_${runId}`;
const platformAdminId = `e2e_platform_${runId}`;
const voterId = `e2e_voter_${runId}`;
const openVoterId = `e2e_open_voter_${runId}`;
const otherVoterId = `e2e_other_voter_${runId}`;
const dispatchId = `e2e_dispatch_${runId}`;
const tenantAdminEmail = `tenant-${runId}@example.test`;
const platformAdminEmail = `platform-${runId}@example.test`;
const tenantPassword = `E2eTenant-${runId}-Pass`;
const platformPassword = `E2ePlatform-${runId}-Pass`;
const serveUi = process.argv.includes('--serve-ui');
const reuseUi = process.argv.includes('--reuse-ui');
let testServer;
let mongoServer;
let frontendProcess;
let databaseConnected = false;
let createdDefaultOrganization = false;

const voterRecord = (id, orgId, epic, overrides = {}) => ({
  _id: id,
  epic,
  wardNo: '1',
  partNo: `PART-${runId}`,
  serialNo: 1,
  nameEn: `Fixture Voter ${runId}`,
  nameHi: 'परीक्षण मतदाता',
  mobileNo: '9000000001',
  caste: `FixtureCommunity${runId}`,
  supportStatus: 'core',
  isMigrant: true,
  migrantLocation: 'Fixture location',
  houseNo: `HOUSE-${runId}`,
  familyId: `FAMILY-${runId}`,
  organizationId: orgId,
  ...overrides,
});

const assertStatus = (response, expected, action) => {
  assert.equal(response.status, expected, `${action}: expected HTTP ${expected}, received ${response.status}`);
};

const getAvailablePort = async () => {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((err) => err ? reject(err) : resolve()));
  return port;
};

const startUi = async () => {
  let frontendUrl;
  if (reuseUi) {
    frontendUrl = process.env.E2E_FRONTEND_URL || 'http://localhost:3000';
  } else {
    const frontendPath = path.resolve(__dirname, '../../frontend');
    const port = await getAvailablePort();
    frontendProcess = spawn(process.execPath, [
      path.join(frontendPath, 'node_modules/next/dist/bin/next'),
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ], {
      cwd: frontendPath,
      env: { ...process.env, NEXT_PUBLIC_API_URL: `${baseUrlForUi}/api` },
      stdio: 'inherit',
    });
    frontendUrl = `http://127.0.0.1:${port}`;
  }
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (frontendProcess && frontendProcess.exitCode !== null) {
      throw new Error(`Frontend dev server exited with code ${frontendProcess.exitCode}.`);
    }
    try {
      const response = await fetch(frontendUrl);
      if (response.status < 500) {
        console.log(`Authenticated UI fixture ready at ${frontendUrl}`);
        console.log(`Temporary API base: ${baseUrlForUi}/api`);
        console.log(`Temporary tenant login: ${tenantAdminEmail} / ${tenantPassword}`);
        return new Promise((resolve) => {
          process.once('SIGINT', resolve);
          process.once('SIGTERM', resolve);
        });
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('Frontend dev server did not become ready within 90 seconds.');
};

const cleanup = async () => {
  if (frontendProcess && frontendProcess.exitCode === null) {
    frontendProcess.kill('SIGTERM');
    await new Promise((resolve) => frontendProcess.once('exit', resolve));
    frontendProcess = null;
  }
  if (testServer) {
    await new Promise((resolve) => testServer.close(resolve));
    testServer = null;
  }
  if (!databaseConnected) return;
  try {
    await Promise.all([
      Voter.deleteMany({ organizationId: { $in: [organizationId, otherOrganizationId] } }),
      SlipDispatch.deleteMany({ organizationId: { $in: [organizationId, otherOrganizationId] } }),
      User.deleteMany({ organizationId: { $in: [organizationId, otherOrganizationId] } }),
      User.deleteOne({ _id: platformAdminId }),
      Organization.deleteMany({ _id: { $in: [organizationId, otherOrganizationId] } }),
      ...(createdDefaultOrganization ? [Organization.deleteOne({ _id: 'org_default' })] : []),
    ]);
  } finally {
    await mongoose.disconnect();
    databaseConnected = false;
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
};

const main = async () => {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  mongoServer = await MongoMemoryServer.create({ instance: { dbName: databaseName } });
  process.env.E2E_TEST_MONGO_URI = mongoServer.getUri(databaseName);
  await mongoose.connect(process.env.E2E_TEST_MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  databaseConnected = true;
  if (!await Organization.findById('org_default').lean()) {
    await Organization.create({ _id: 'org_default', name: 'E2E Default', enabledModules: modules, isActive: true });
    createdDefaultOrganization = true;
  }
  await Organization.create([
    { _id: organizationId, name: `E2E Tenant ${runId}`, enabledModules: modules, allowedWards: ['1'], isActive: true },
    { _id: otherOrganizationId, name: `E2E Other Tenant ${runId}`, enabledModules: modules, allowedWards: ['1'], isActive: true },
  ]);
  await User.create([
    {
      _id: tenantAdminId,
      email: tenantAdminEmail,
      passwordHash: await bcrypt.hash(tenantPassword, 10),
      fullName: 'E2E Tenant Admin',
      phone: '9000000010',
      role: 'tenant_admin',
      organizationId,
      isActive: true,
    },
    {
      _id: platformAdminId,
      email: platformAdminEmail,
      passwordHash: await bcrypt.hash(platformPassword, 10),
      fullName: 'E2E Platform Admin',
      phone: '9000000011',
      role: 'admin',
      organizationId: 'org_default',
      isActive: true,
    },
  ]);
  await Voter.create([
    voterRecord(voterId, organizationId, `E2E${runId}01`),
    voterRecord(openVoterId, organizationId, `E2E${runId}04`, {
      serialNo: 3,
      nameEn: `E2E Poll Desk ${runId}`,
      nameHi: 'मतदान डेस्क परीक्षण',
      supportStatus: 'swing',
      isMigrant: false,
      migrantLocation: '',
      houseNo: `OPEN-${runId}`,
      familyId: `OPEN-FAMILY-${runId}`,
    }),
    voterRecord(otherVoterId, otherOrganizationId, `E2E${runId}02`, { caste: `Private${runId}` }),
  ]);
  await SlipDispatch.create({
    _id: dispatchId,
    voterId,
    voterEpic: `E2E${runId}01`,
    voterName: `Fixture Voter ${runId}`,
    recipientPhone: '9000000001',
    slipType: 'individual',
    status: 'sent',
    providerMessageId: `provider-${runId}`,
    organizationId,
  });

  const server = app.listen(0, '127.0.0.1');
  testServer = server;
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  baseUrlForUi = `http://127.0.0.1:${address.port}`;

  const request = (path, { token, ...options } = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const jsonRequest = async (path, options, expected, action) => {
    const response = await request(path, options);
    assertStatus(response, expected, action);
    return response.json();
  };
  const download = async (path, token, action) => {
    const response = await request(path, { token });
    assertStatus(response, 200, action);
    assert.match(response.headers.get('content-type') || '', /spreadsheetml\.sheet/);
    return Buffer.from(await response.arrayBuffer());
  };
  const login = async (email, password) => {
    const result = await jsonRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, 200, `login ${email}`);
    return result.token;
  };

  try {
    const platformToken = await login(platformAdminEmail, platformPassword);
    const tenantToken = await login(tenantAdminEmail, tenantPassword);

    const voters = await jsonRequest(`/voters?search=${encodeURIComponent(runId)}`, { token: tenantToken }, 200, 'voter search');
    assert.ok(voters.some((voter) => voter._id === voterId));
    assert.equal(voters.some((voter) => voter._id === otherVoterId), false, 'tenant voter search must stay scoped');

    const household = await jsonRequest(`/voters/family/${encodeURIComponent(`HOUSE-${runId}`)}?ward=1`, { token: tenantToken }, 200, 'household lookup');
    assert.ok(household.some((voter) => voter._id === voterId));
    const analyticsVoters = await jsonRequest('/voters/all', { token: tenantToken }, 200, 'poll desk voter list');
    assert.ok(analyticsVoters.some((voter) => voter._id === voterId));
    assert.ok(analyticsVoters.some((voter) => voter._id === openVoterId && !voter.voted), 'poll desk must have an unvoted UI fixture');
    await jsonRequest(`/voters/${voterId}`, {
      token: tenantToken,
      method: 'PUT',
      body: JSON.stringify({ supportStatus: 'swing', notes: 'E2E updated' }),
    }, 200, 'voter edit');
    await jsonRequest(`/voters/${voterId}/vote`, {
      token: tenantToken,
      method: 'PUT',
      body: JSON.stringify({ voted: true }),
    }, 200, 'poll desk vote action');
    const crossTenantUpdate = await request(`/voters/${otherVoterId}`, {
      token: tenantToken,
      method: 'PUT',
      body: JSON.stringify({ supportStatus: 'swing' }),
    });
    assertStatus(crossTenantUpdate, 404, 'cross-tenant voter update');

    const warRoom = await jsonRequest('/features/war-room', { token: tenantToken }, 200, 'war room');
    assert.ok(warRoom.metrics.total >= 1);
    assert.equal(warRoom.support.reduce((sum, entry) => sum + entry.count, 0), warRoom.metrics.total);
    assert.ok(warRoom.booths.every((booth) => ['ward', 'part', 'total', 'voted', 'core', 'swing', 'opposition', 'unmarked']
      .every((field) => Object.hasOwn(booth, field))));
    const migrants = await jsonRequest(`/features/migrants?search=${encodeURIComponent(runId)}&page=1`, { token: tenantToken }, 200, 'migrant list');
    assert.ok(migrants.data.some((voter) => voter._id === voterId));
    await jsonRequest(`/voters/${voterId}`, {
      token: tenantToken,
      method: 'PUT',
      body: JSON.stringify({ isMigrant: false, migrantLocation: '' }),
    }, 200, 'migrant update');
    await jsonRequest(`/voters/${voterId}`, {
      token: tenantToken,
      method: 'PUT',
      body: JSON.stringify({ isMigrant: true, migrantLocation: 'Fixture location' }),
    }, 200, 'migrant restore');

    const community = await jsonRequest(`/features/community?q=${encodeURIComponent(`FixtureCommunity${runId}`)}`, { token: tenantToken }, 200, 'community search');
    assert.ok(community.some((voter) => voter._id === voterId));
    const dispatchHistory = await jsonRequest(`/features/dispatches?search=${encodeURIComponent(runId)}&status=sent`, { token: tenantToken }, 200, 'dispatch history');
    assert.equal(dispatchHistory.summary.sent, 1);
    assert.equal(dispatchHistory.dispatches[0].providerMessageId, `provider-${runId}`);

    const accounts = await jsonRequest('/users', { token: tenantToken }, 200, 'account list');
    assert.ok(Array.isArray(accounts));
    const workersBefore = await jsonRequest('/users/workers', { token: tenantToken }, 200, 'worker list');
    assert.ok(Array.isArray(workersBefore));

    for (let index = 0; index < 10; index += 1) {
      const email = `worker-${index}-${runId}@example.test`;
      const response = await request('/users', {
        token: tenantToken,
        method: 'POST',
        body: JSON.stringify({
          name: `E2E Worker ${index}`,
          email,
          phone: '9000000020',
          password: `E2eWorker-${runId}-${index}-Pass`,
          subRole: 'Operator',
          scope: 'All',
          scopeValue: '',
          modules: ['voters', 'workers'],
        }),
      });
      assertStatus(response, 201, `create worker ${index + 1}`);
    }
    const overLimit = await request('/users', {
      token: tenantToken,
      method: 'POST',
      body: JSON.stringify({
        name: 'E2E Over Limit',
        email: `over-limit-${runId}@example.test`,
        phone: '9000000021',
        password: `E2eOverLimit-${runId}-Pass`,
        subRole: 'Operator',
        scope: 'All',
        scopeValue: '',
        modules: ['voters'],
      }),
    });
    assertStatus(overLimit, 409, '10-worker limit');

    const workerEmail = `worker-0-${runId}@example.test`;
    const worker = await User.findOne({ email: workerEmail }).lean();
    assert.ok(worker);
    const workerToken = await login(workerEmail, `E2eWorker-${runId}-0-Pass`);
    await jsonRequest(`/users/${worker._id}`, {
      token: tenantToken,
      method: 'PUT',
      body: JSON.stringify({ password: `E2eChanged-${runId}-Pass` }),
    }, 200, 'worker password update');
    await jsonRequest(`/users/${worker._id}`, {
      token: tenantToken,
      method: 'PUT',
      body: JSON.stringify({
        name: 'E2E Worker Updated',
        subRole: 'Operator',
        scope: 'All',
        scopeValue: '',
        modules: ['voters', 'workers'],
      }),
    }, 200, 'worker permissions update');
    await jsonRequest(`/users/${worker._id}/active`, {
      token: tenantToken,
      method: 'PUT',
      body: JSON.stringify({ isActive: false }),
    }, 200, 'worker deactivation');
    const revoked = await request('/voters', { token: workerToken });
    assert.ok([401, 403].includes(revoked.status), `disabled worker token revocation: expected 401 or 403, received ${revoked.status}`);

    for (const [dataset, query] of [
      ['voters', ''],
      ['turnout', ''],
      ['migrants', ''],
      ['community', `&q=FixtureCommunity${runId}`],
      ['dispatches', '&status=sent'],
    ]) {
      await download(`/features/export.xlsx?dataset=${dataset}${query}`, tenantToken, `${dataset} Excel export`);
    }

    const platformOrganizations = await jsonRequest('/admin/organizations', { token: platformToken }, 200, 'platform tenants');
    const masterData = await jsonRequest(`/admin/master-data?organizationId=${organizationId}`, { token: platformToken }, 200, 'admin master data');
    const masterVoters = Array.isArray(masterData) ? masterData : (masterData?.voters || []);
    const health = await jsonRequest('/health', { token: platformToken }, 200, 'system health');
    assert.equal(health.status, 'ok');
    await download('/admin/import-template.xlsx', platformToken, 'import template');
    await download(`/admin/export-voters?organizationId=${organizationId}`, platformToken, 'admin voter export');

    const uploadWorkbook = new ExcelJS.Workbook();
    const worksheet = uploadWorkbook.addWorksheet('Voters');
    worksheet.addRow(Array.from({ length: 18 }, (_, index) => `Column ${index + 1}`));
    worksheet.addRow([
      `E2E${runId}01`, '1', `PART-${runId}`, 1, 'Updated fixture voter', 'अपडेट परीक्षण',
      42, 'F', 'Self', '', '', `HOUSE-${runId}`, '', '9000000001', `FixtureCommunity${runId}`,
      `FAMILY-${runId}`, 'Fixture village', 'गाँव',
    ]);
    worksheet.addRow([
      `E2E${runId}03`, '1', `PART-${runId}`, 2, 'New fixture voter', 'नया परीक्षण',
      35, 'M', 'Self', '', '', `HOUSE-${runId}`, '', '9000000003', `FixtureCommunity${runId}`,
      `FAMILY-${runId}`, 'Fixture village', 'गाँव',
    ]);
    const form = new FormData();
    form.set('organizationId', organizationId);
    form.set('file', new Blob([Buffer.from(await uploadWorkbook.xlsx.writeBuffer())], { type: workbookMimeType }), 'e2e-voters.xlsx');
    const importResponse = await request('/admin/upload-voters', { token: platformToken, method: 'POST', body: form });
    assertStatus(importResponse, 200, 'admin voter import');
    const importResult = await importResponse.json();
    assert.equal(importResult.inserted, 1);
    assert.equal(importResult.updated, 1);
    const updatedVoter = await Voter.findById(voterId).lean();
    assert.equal(updatedVoter.nameEn, 'Updated fixture voter');

    console.log('Authenticated E2E API smoke checks passed for all nine modules and admin Excel flows.');
    if (serveUi) await startUi();
  } finally {
    await cleanup();
  }
};

let baseUrlForUi;
main().catch((err) => {
  console.error('Authenticated E2E API smoke checks failed:', err.message);
  cleanup()
    .catch((cleanupError) => console.error('E2E fixture cleanup failed:', cleanupError.message))
    .finally(() => { process.exitCode = 1; });
});
