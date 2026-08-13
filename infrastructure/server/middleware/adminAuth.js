'use strict';

const { jwtAuth } = require('./jwtAuth');

function requireAdminGroup(req, res, next) {
  const groups = req.auth && req.auth.groups;
  if (!Array.isArray(groups) || !groups.includes('admin')) {
    return res.status(403).json({
      error: 'Administrator access is required.',
      code: 'ADMIN_REQUIRED',
    });
  }

  req.adminUser = {
    sub: req.auth.sub,
    email: req.auth.email,
    groups: [...groups],
  };
  return next();
}

function createAdminAuth(jwtAuthMiddleware = jwtAuth) {
  return function adminAuthMiddleware(req, res, next) {
    return jwtAuthMiddleware(req, res, authError => {
      if (authError) return next(authError);
      return requireAdminGroup(req, res, next);
    });
  };
}

const adminAuth = createAdminAuth();

module.exports = { adminAuth, createAdminAuth, requireAdminGroup };
