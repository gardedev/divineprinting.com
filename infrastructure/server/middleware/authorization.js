'use strict';

const logger = require('../utils/logger');

const RECOGNIZED_GROUPS = Object.freeze(['customer', 'admin', 'system']);
const GROUP_ERROR_CODES = Object.freeze({
  customer: 'CUSTOMER_REQUIRED',
  admin: 'ADMIN_REQUIRED',
  system: 'SYSTEM_REQUIRED',
});

function groupsFor(req) {
  const groups = req.auth && req.auth.groups;
  if (!Array.isArray(groups)) return [];
  return groups.filter(group => RECOGNIZED_GROUPS.includes(group));
}

function auditDecision(req, rule, decision) {
  const event = {
    requestId: req.id || req.headers?.['x-request-id'] || undefined,
    route: `${req.baseUrl || ''}${req.path || ''}`,
    rule,
    decision,
    actorSub: req.auth && req.auth.sub,
  };
  logger[decision === 'allow' ? 'info' : 'warn']('Authorization decision', event);
}

function denyGroup(req, res, group) {
  auditDecision(req, `group:${group}`, 'deny');
  return res.status(403).json({
    error: `${group === 'admin' ? 'Administrator' : group === 'customer' ? 'Customer' : 'System'} access is required.`,
    code: GROUP_ERROR_CODES[group] || 'AUTH_FORBIDDEN',
  });
}

function requireGroup(group) {
  if (!RECOGNIZED_GROUPS.includes(group)) throw new TypeError(`Unknown authorization group: ${group}`);
  return function requireExactGroup(req, res, next) {
    if (!groupsFor(req).includes(group)) return denyGroup(req, res, group);
    auditDecision(req, `group:${group}`, 'allow');
    return next();
  };
}

function requireAnyGroup(requiredGroups) {
  if (!Array.isArray(requiredGroups) || requiredGroups.length === 0 ||
      requiredGroups.some(group => !RECOGNIZED_GROUPS.includes(group))) {
    throw new TypeError('requireAnyGroup requires recognized groups');
  }
  return function requireOneExactGroup(req, res, next) {
    const allowed = groupsFor(req).some(group => requiredGroups.includes(group));
    const rule = `any-group:${requiredGroups.join(',')}`;
    auditDecision(req, rule, allowed ? 'allow' : 'deny');
    if (!allowed) return res.status(403).json({ error: 'Access is forbidden.', code: 'AUTH_FORBIDDEN' });
    return next();
  };
}

function ownerMiddleware(options, bypassGroup) {
  if (!options || typeof options.loadResource !== 'function') {
    throw new TypeError('Ownership authorization requires loadResource');
  }
  const ownerField = options.ownerField || 'customerId';
  return async function enforceOwnership(req, res, next) {
    if (bypassGroup && groupsFor(req).includes(bypassGroup)) {
      auditDecision(req, `owner-or-group:${bypassGroup}`, 'allow');
      return next();
    }
    let resource;
    try {
      resource = await options.loadResource(req);
    } catch (error) {
      return next(error);
    }
    const allowed = !!resource && !!req.auth?.sub && resource[ownerField] === req.auth.sub;
    auditDecision(req, `owner:${ownerField}`, allowed ? 'allow' : 'deny');
    if (!allowed) {
      // Non-enumerating response: do not reveal whether another user's record exists.
      return res.status(options.denialStatus || 404).json({
        error: options.denialStatus === 403 ? 'Resource ownership is required.' : 'Resource not found.',
        code: 'OWNERSHIP_REQUIRED',
      });
    }
    req.authorizedResource = resource;
    return next();
  };
}

function requireOwner(options) {
  return ownerMiddleware(options);
}

function requireOwnerOrGroup(ownerOptions, group) {
  if (!RECOGNIZED_GROUPS.includes(group)) throw new TypeError(`Unknown authorization group: ${group}`);
  return ownerMiddleware(ownerOptions, group);
}

module.exports = {
  RECOGNIZED_GROUPS,
  groupsFor,
  requireGroup,
  requireAnyGroup,
  requireOwner,
  requireOwnerOrGroup,
};
