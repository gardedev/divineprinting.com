'use strict';

jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn() }));
const logger = require('../../utils/logger');
const {
  groupsFor, requireGroup, requireAnyGroup, requireOwner, requireOwnerOrGroup,
} = require('../authorization');

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('Task 4.6 centralized authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    [['customer', 'unknown'], ['customer']],
    ['customer', []],
    [undefined, []],
  ])('normalizes only recognized array groups', (groups, expected) => {
    expect(groupsFor({ auth: { groups } })).toEqual(expected);
  });

  it('requires an exact group and emits safe decision metadata', () => {
    const req = { auth: { sub: 'trusted-sub', groups: ['customer'] }, headers: {}, path: '/orders' };
    const next = jest.fn();
    requireGroup('customer')(req, response(), next);
    expect(next).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('Authorization decision', expect.objectContaining({
      rule: 'group:customer', decision: 'allow', actorSub: 'trusted-sub',
    }));
    const metadata = JSON.stringify(logger.info.mock.calls[0][1]);
    expect(metadata).not.toMatch(/token|authorization|email/i);
  });

  it('denies a valid identity lacking the group with safe 403', () => {
    const req = { auth: { sub: 'admin-sub', groups: ['admin'] }, headers: {}, path: '/orders' };
    const res = response();
    requireGroup('customer')(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CUSTOMER_REQUIRED' }));
    expect(logger.warn).toHaveBeenCalled();
  });

  it('supports explicit any-group checks without hierarchy', () => {
    const next = jest.fn();
    requireAnyGroup(['customer', 'admin'])(
      { auth: { groups: ['system', 'customer'] }, headers: {}, path: '/' }, response(), next
    );
    expect(next).toHaveBeenCalled();
  });

  it('enforces trusted sub ownership and hides foreign resources', async () => {
    const res = response();
    await requireOwner({ loadResource: async () => ({ customerId: 'other-sub' }) })(
      { auth: { sub: 'trusted-sub', groups: ['customer'] }, headers: {}, path: '/resource' },
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Resource not found.', code: 'OWNERSHIP_REQUIRED' });
  });

  it('allows an explicit owner-or-admin boundary only when requested', async () => {
    const next = jest.fn();
    await requireOwnerOrGroup({ loadResource: async () => ({ customerId: 'other' }) }, 'admin')(
      { auth: { sub: 'admin-sub', groups: ['admin'] }, headers: {}, path: '/admin/resource' },
      response(), next
    );
    expect(next).toHaveBeenCalled();
  });

  it('keeps both Express construction paths on the centralized route guards', () => {
    const fs = require('fs');
    const path = require('path');
    const serverSource = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
    const customerSource = fs.readFileSync(path.join(__dirname, '../../api/customerRegistrationApi.js'), 'utf8');
    const ordersSource = fs.readFileSync(path.join(__dirname, '../../api/customerOrdersApi.js'), 'utf8');
    for (const source of [serverSource, appSource]) {
      expect(source).toContain('createCustomerRegistrationRouter');
      expect(source).toContain('adminAuth');
    }
    expect(customerSource).toContain("requireGroup('customer')");
    expect(ordersSource).toContain("requireGroup('customer')");
  });
});
