function getEffectiveOrgId(req) {
  const isPlatformAdmin = req.user?.role === 'admin';
  if (!isPlatformAdmin) {
    // Non-admins are ALWAYS restricted strictly to their own organization
    return req.user?.organizationId || 'org_default';
  }

  // Platform Admins can filter by any selected client organization
  const targetOrgId = req.headers['x-organization-id']
    || req.headers['x-client-id']
    || (typeof req.query?.organizationId === 'string' && req.query.organizationId.trim())
    || (typeof req.body?.organizationId === 'string' && req.body.organizationId.trim());

  if (typeof targetOrgId === 'string' && targetOrgId.trim() && targetOrgId.trim() !== 'all') {
    return targetOrgId.trim();
  }

  return null;
}

function addVoterAccess(req) {
  const query = {};
  const isPlatformAdmin = req.user?.role === 'admin';
  const targetOrgId = getEffectiveOrgId(req);
  
  if (targetOrgId) {
    query.organizationId = targetOrgId;
  }

  if (!isPlatformAdmin) {
    const allowedWards = req.user?.allowedWards;
    if (Array.isArray(allowedWards) && allowedWards.length) {
      query.wardNo = { $in: allowedWards };
    }
    const scopeField = {
      Booth: 'partNo',
      Ward: 'wardNo',
      Village: 'villageName',
    }[req.user?.scopeType];
    
    if (scopeField) {
      const scopeValue = req.user?.scopeValue;
      if (typeof scopeValue !== 'string' || !scopeValue.trim()) {
        // Impossible condition to force no results if scope is invalid
        query._id = null;
      } else {
        query[scopeField] = scopeValue.trim();
      }
    } else if (req.user?.scopeType !== 'All') {
      query._id = null;
    }
  }
  
  return query;
}

module.exports = { addVoterAccess, getEffectiveOrgId };
