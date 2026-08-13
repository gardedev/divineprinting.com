'use strict';

const { jwtAuth } = require('./jwtAuth');
const { requireGroup } = require('./authorization');

function attachAdminUser(req, res, next) {
  req.adminUser = {
    sub: req.auth.sub,
    email: req.auth.email,
    groups: [...req.auth.groups],
  };
  return next();
}

function createAdminAuth(jwtAuthMiddleware = jwtAuth) {
  const requireAdmin = requireGroup('admin');
  return function adminAuthMiddleware(req, res, next) {
    return jwtAuthMiddleware(req, res, authError => {
      if (authError) return next(authError);
      return requireAdmin(req, res, groupError => {
        if (groupError) return next(groupError);
        return attachAdminUser(req, res, next);
      });
    });
  };
}

const adminAuth = createAdminAuth();

module.exports = { adminAuth, createAdminAuth, requireAdminGroup: requireGroup('admin') };
