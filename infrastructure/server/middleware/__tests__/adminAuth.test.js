'use strict';

const express = require('express');
const request = require('supertest');
jest.mock('../jwtAuth', () => ({ jwtAuth: jest.fn() }));
const { createAdminAuth, requireAdminGroup } = require('../adminAuth');
const { createAdminSessionRouter } = require('../../api/adminSessionApi');

function jwtStub(auth) {
  return (req, res, next) => {
    if (auth === 'missing') return res.status(401).json({ code: 'MISSING_TOKEN' });
    if (auth === 'invalid') return res.status(401).json({ code: 'INVALID_SIGNATURE' });
    req.auth = auth;
    return next();
  };
}

function buildApp(auth) {
  const app = express();
  const guard = createAdminAuth(jwtStub(auth));
  app.use('/api/admin', createAdminSessionRouter(guard));
  app.get('/api/admin/other', guard, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('Task 4.5 admin group guard', () => {
  test.each([
    [['admin']],
    [['customer', 'admin']],
  ])('accepts verified groups %j', async groups => {
    const response = await request(buildApp({ sub: 'admin-sub', email: 'a@example.com', groups }))
      .get('/api/admin/session');
    expect(response.status).toBe(200);
    expect(response.body.admin).toEqual({ sub: 'admin-sub', email: 'a@example.com' });
  });

  test.each([
    ['customer only', ['customer']],
    ['system only', ['system']],
    ['missing groups', undefined],
    ['malformed groups', 'admin'],
  ])('returns safe 403 ADMIN_REQUIRED for %s', async (_label, groups) => {
    const response = await request(buildApp({
      sub: 'user-sub', email: 'user@example.com', groups,
      admin: true, role: 'admin',
    })).get('/api/admin/session?role=admin&admin=true');
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'Administrator access is required.',
      code: 'ADMIN_REQUIRED',
    });
  });

  it('preserves JWT authentication failures', async () => {
    expect((await request(buildApp('missing')).get('/api/admin/session')).status).toBe(401);
    expect((await request(buildApp('invalid')).get('/api/admin/session')).status).toBe(401);
  });

  it('protects every mounted /api/admin route with the same guard', async () => {
    const response = await request(buildApp({ sub: 'customer', groups: ['customer'] }))
      .get('/api/admin/other');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ADMIN_REQUIRED');
  });

  it('ignores client-supplied role values because only req.auth.groups is read', () => {
    const req = { auth: { groups: [] }, body: { role: 'admin' }, query: { admin: 'true' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    requireAdminGroup(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
