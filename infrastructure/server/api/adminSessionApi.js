'use strict';

const { Router } = require('express');

function createAdminSessionRouter(adminAuthMiddleware) {
  const router = Router();
  router.get('/session', adminAuthMiddleware, (req, res) => res.json({
    authenticated: true,
    admin: {
      sub: req.adminUser.sub,
      email: req.adminUser.email,
    },
  }));
  return router;
}

module.exports = { createAdminSessionRouter };
