'use strict';

const crypto = require('crypto');
const defaultCartRepository = require('./cartRepository').createCartRepository();

const USD = 'USD';
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;
const CONFIGURED_JOB = 'CONFIGURED_JOB';
const CONFIGURED_JOB_DEDUPE_VERSION = 'configured-job-v1';

class CartServiceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'CartServiceError';
    this.code = code;
  }
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new CartServiceError('CART_INVALID_INPUT', `${field} is required`);
  return value.trim();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function dedupeKey(input) {
  const identity = canonical({
    productId: input.productId,
    sku: input.sku,
    variation: input.variation,
    options: input.options,
    personalization: input.personalization,
    designId: input.designId,
    uploadId: input.uploadId,
    fulfillment: input.fulfillment,
  });
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function configuredJobDedupeKey({ productId, baseSku, customerConfiguration }) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical({
    dedupeVersion: CONFIGURED_JOB_DEDUPE_VERSION,
    productId,
    baseSku,
    customerConfiguration,
  }))).digest('hex');
}

function configuredMergeKey({ productId, customerConfiguration }) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical({
    dedupeVersion: CONFIGURED_JOB_DEDUPE_VERSION,
    productId,
    customerConfiguration,
  }))).digest('hex');
}

function mergeInstructions(existing, requested) {
  const left = typeof existing === 'string' ? existing.trim() : '';
  const right = typeof requested === 'string' ? requested.trim() : '';
  if (left && right && left !== right) throw new CartServiceError('CART_INSTRUCTIONS_CONFLICT');
  return right || left || undefined;
}

function configuredIdempotencyInput(operation, item, extra = {}) {
  return canonical({
    operation,
    productId: item?.productId,
    cartItemType: CONFIGURED_JOB,
    customerConfiguration: item?.customerConfiguration,
    variantAllocations: item?.variantAllocations,
    customerInstructions: item?.customerInstructions,
    ...extra,
  });
}

function ownerFromContext(context) {
  if (context?.type === 'customer') return { type: 'customer', customerId: requiredString(context.sub, 'sub') };
  if (context?.type === 'anonymous') return { type: 'anonymous', anonymousSessionHash: requiredString(context.anonymousSessionHash, 'anonymousSessionHash') };
  throw new CartServiceError('CART_ACCESS_DENIED');
}

function validateQuantity(quantity, product = {}) {
  const minimum = Number.isInteger(product.minimumQuantity) ? Math.max(MIN_QUANTITY, product.minimumQuantity) : MIN_QUANTITY;
  const maximum = Number.isInteger(product.maximumQuantity) ? Math.min(MAX_QUANTITY, product.maximumQuantity) : MAX_QUANTITY;
  const increment = Number.isInteger(product.quantityIncrement) && product.quantityIncrement > 0 ? product.quantityIncrement : 1;
  if (!Number.isInteger(quantity) || quantity < minimum || quantity > maximum || (quantity - minimum) % increment !== 0) {
    throw new CartServiceError('CART_QUANTITY_INVALID');
  }
  return quantity;
}

function nonempty(value) {
  return value !== undefined && value !== null && (!(typeof value === 'object') || Object.keys(value).length > 0);
}

function selectionSupported(requested, supported) {
  if (!nonempty(requested)) return true;
  if (!supported) return false;
  if (Array.isArray(supported)) {
    const needle = JSON.stringify(canonical(requested));
    return supported.some((entry) => JSON.stringify(canonical(entry)) === needle || entry === requested);
  }
  if (typeof supported === 'object' && typeof requested === 'object') {
    return Object.entries(requested).every(([key, value]) => {
      const allowed = supported[key];
      return Array.isArray(allowed) ? allowed.includes(value) : allowed === value;
    });
  }
  return supported === requested;
}

function validateProductSelections(product, input) {
  if (input.sku !== undefined && !selectionSupported(input.sku, product.skus || product.sku)) throw new CartServiceError('CART_INVALID_VARIATION');
  if (!selectionSupported(input.variation, product.variations || product.variation)) throw new CartServiceError('CART_INVALID_VARIATION');
  if (!selectionSupported(input.options, product.options)) throw new CartServiceError('CART_INVALID_VARIATION');
  if (!selectionSupported(input.personalization, product.personalizationSchema || product.personalization)) throw new CartServiceError('CART_INVALID_PERSONALIZATION');
}

function totals(items) {
  const subtotalCents = items.reduce((sum, item) => {
    if (!Number.isInteger(item.lineTotalCents) || item.lineTotalCents < 0) throw new CartServiceError('CART_PRICE_CHANGED');
    return sum + item.lineTotalCents;
  }, 0);
  if (!Number.isSafeInteger(subtotalCents)) throw new CartServiceError('CART_PRICE_CHANGED');
  return { subtotalCents, discountCents: 0, taxCents: 0, shippingCents: 0, totalCents: subtotalCents };
}

function lifecycleError(status) {
  const codes = {
    pending_checkout: 'CART_CHECKOUT_IN_PROGRESS', expired: 'CART_EXPIRED',
    abandoned: 'CART_ABANDONED', converted: 'CART_ALREADY_CONVERTED',
  };
  return codes[status] || 'CART_VERSION_CONFLICT';
}

function assertMutable(cart) {
  if (!cart || !['draft', 'active'].includes(cart.status)) throw new CartServiceError(lifecycleError(cart?.status));
}

function assertOwned(cart, owner) {
  const valid = owner.type === 'customer'
    ? cart?.customerId === owner.customerId && !cart.anonymousSessionHash
    : cart?.anonymousSessionHash === owner.anonymousSessionHash && !cart.customerId;
  if (!valid) throw new CartServiceError('CART_ACCESS_DENIED');
}

function translate(error) {
  if (error instanceof CartServiceError) return error;
  if (error?.code) {
    if (error.code === 'CART_PENDING_CHECKOUT_LOCKED') return new CartServiceError('CART_CHECKOUT_IN_PROGRESS');
    return new CartServiceError(error.code);
  }
  return error;
}

function createCartService({ cartRepository = defaultCartRepository, productService: suppliedProductService, assetVerifier } = {}) {
  const productService = suppliedProductService || require('../products/productService');
  async function getTrustedProduct(productId) {
    const product = await productService.getProduct(requiredString(productId, 'productId'));
    if (!product) throw new CartServiceError('CART_PRODUCT_UNAVAILABLE');
    if (product.status !== 'active' || product.deletedAt) throw new CartServiceError('CART_PRODUCT_UNAVAILABLE');
    if (!Number.isInteger(product.basePrice) || product.basePrice < 0) throw new CartServiceError('CART_PRICE_CHANGED');
    if (product.currency && product.currency !== USD) throw new CartServiceError('CART_CURRENCY_MISMATCH');
    return product;
  }

  async function createCart(context) {
    const owner = ownerFromContext(context);
    if (owner.type === 'customer' && typeof cartRepository.findOrCreateCustomerCart === 'function') {
      return cartRepository.findOrCreateCustomerCart(owner.customerId);
    }
    return cartRepository.createCart(owner.type === 'customer'
      ? { cartType: 'customer', customerId: owner.customerId, currency: USD }
      : { cartType: 'anonymous', anonymousSessionHash: owner.anonymousSessionHash, currency: USD });
  }

  async function getCurrentCart(context) {
    const owner = ownerFromContext(context);
    let cart;
    if (owner.type === 'customer') {
      cart = typeof cartRepository.findOrCreateCustomerCart === 'function'
        ? await cartRepository.findOrCreateCustomerCart(owner.customerId)
        : await cartRepository.findActiveCustomerCart(owner.customerId);
      if (cart) assertOwned(cart, owner);
      if (cart?.status === 'pending_checkout') throw new CartServiceError('CART_CHECKOUT_IN_PROGRESS');
      if (!cart) cart = await createCart(context);
    } else {
      cart = await cartRepository.findAnonymousCartByHash(owner.anonymousSessionHash);
      if (!cart) throw new CartServiceError('CART_NOT_FOUND');
      assertOwned(cart, owner);
      if (cart.status === 'converted') throw new CartServiceError('CART_ALREADY_CONVERTED');
      if (cart.status === 'expired' || (Number.isInteger(cart.expiresAt) && cart.expiresAt <= Math.floor(Date.now() / 1000))) {
        throw new CartServiceError('CART_EXPIRED');
      }
    }
    return { cart, items: await cartRepository.listCartItems(cart.cartId) };
  }

  async function addItem({ context, cartId, expectedCartVersion, mutationId, item }) {
    try {
      const owner = ownerFromContext(context);
      const configured = item?.cartItemType === CONFIGURED_JOB;
      // Reject any browser-supplied fields that must never appear in a configured-job submission.
      // These are server-authoritative and must not be accepted from the client, not merely ignored.
      const CONFIGURED_JOB_REJECTED_KEYS = [
        'price', 'unitPriceCents', 'lineTotalCents', 'pricingSnapshot',
        'baseSku', 'sku', 'physicalUnits', 'availability', 'availableForSale', 'sellable',
        'fulfillment', 'productionMethod', 'productionStatus',
      ];
      if (configured && CONFIGURED_JOB_REJECTED_KEYS.some((key) => item[key] !== undefined)) {
        throw new CartServiceError('CART_INVALID_INPUT');
      }
      const idempotencyInput = configured
        ? configuredIdempotencyInput('addConfiguredJob', item)
        : { operation: 'addItem', productId: item?.productId, sku: item?.sku, variation: canonical(item?.variation), options: canonical(item?.options), personalization: canonical(item?.personalization), designId: item?.designId, uploadId: item?.uploadId, quantity: item?.quantity };
      const replay = await cartRepository.getMutationReplay({ cartId, owner, mutationId, idempotencyInput });
      if (replay) return cartRepository.getCartItem(cartId, replay.result.cartItemId);
      const cart = await cartRepository.getCart(requiredString(cartId, 'cartId'));
      assertOwned(cart, owner);
      assertMutable(cart);
      if (configured) {
        let evaluated = await productService.evaluateCartConfiguration(requiredString(item.productId, 'productId'), {
          customerConfiguration: item.customerConfiguration,
          variantAllocations: item.variantAllocations,
          customerInstructions: item.customerInstructions,
        }, { assetVerifier });
        const key = configuredJobDedupeKey({ productId: item.productId, baseSku: evaluated.baseSku, customerConfiguration: evaluated.customerConfiguration });
        const existingItems = await cartRepository.listCartItems(cartId);
        const existing = existingItems.find((entry) => entry.cartItemType === CONFIGURED_JOB && entry.dedupeKey === key);
        if (existing) {
          const customerInstructions = mergeInstructions(existing.customerInstructions, evaluated.customerInstructions);
          evaluated = await productService.evaluateCartConfiguration(item.productId, {
            customerConfiguration: evaluated.customerConfiguration,
            variantAllocations: [...(existing.variantAllocations || []), ...evaluated.variantAllocations],
            customerInstructions,
          }, { assetVerifier });
        }
        const inventoryStatus = 'not_checked';
        const validationStatus = 'warning';
        const snapshot = {
          cartItemType: CONFIGURED_JOB,
          productId: item.productId,
          baseSku: evaluated.baseSku,
          customerConfiguration: evaluated.customerConfiguration,
          variantAllocations: evaluated.variantAllocations,
          totalQuantity: evaluated.totalQuantity,
          customerInstructions: evaluated.customerInstructions ?? null,
          pricingSnapshot: evaluated.pricingSnapshot,
          dedupeVersion: evaluated.dedupeVersion,
          dedupeKey: key,
          quantity: evaluated.totalQuantity,
          currency: evaluated.pricingSnapshot.currency,
          unitPriceCents: evaluated.pricingSnapshot.tier?.baseUnitPriceCents ?? evaluated.pricingSnapshot.allocations?.[0]?.unitPriceCents,
          lineTotalCents: evaluated.lineTotalCents,
          productVersion: evaluated.pricingSnapshot.productVersion,
          pricingVersion: evaluated.pricingSnapshot.pricingVersion,
          validationStatus,
          inventoryStatus,
        };
        const nextItems = existingItems.filter((entry) => entry.cartItemId !== existing?.cartItemId).concat(snapshot);
        const cartUpdates = { ...totals(nextItems), validationStatus, ...(cart.status === 'draft' ? { status: 'active' } : {}) };
        const { productId: immutableProductId, ...itemUpdates } = snapshot;
        return existing
          ? await cartRepository.updateCartItem({ cartId, cartItemId: existing.cartItemId, owner, expectedCartVersion, expectedItemVersion: existing.version, mutationId, updates: itemUpdates, cartUpdates, idempotencyInput })
          : await cartRepository.createCartItem({ cartId, owner, expectedCartVersion, mutationId, item: snapshot, cartUpdates, idempotencyInput });
      }
      const product = await getTrustedProduct(item?.productId);
      validateProductSelections(product, item || {});
      const requestedQuantity = validateQuantity(item.quantity, product);
      const key = dedupeKey(item);
      const existingItems = await cartRepository.listCartItems(cartId);
      const existing = existingItems.find((entry) => entry.dedupeKey === key);
      const quantity = validateQuantity((existing?.quantity || 0) + requestedQuantity, product);
      const unitPriceCents = product.basePrice;
      const lineTotalCents = unitPriceCents * quantity;
      if (!Number.isSafeInteger(lineTotalCents)) throw new CartServiceError('CART_PRICE_CHANGED');
      const inventoryStatus = product.availableForSale === false ? 'unavailable' : 'not_checked';
      const validationStatus = inventoryStatus === 'not_checked' ? 'warning' : 'valid';
      const snapshot = {
        productId: product.productId || item.productId, sku: item.sku, variation: canonical(item.variation),
        options: canonical(item.options), personalization: canonical(item.personalization), designId: item.designId,
        uploadId: item.uploadId, fulfillment: canonical(item.fulfillment), dedupeKey: key, quantity, currency: USD, unitPriceCents,
        lineTotalCents, productVersion: product.version, pricingVersion: product.pricingVersion,
        validationStatus, inventoryStatus,
      };
      if (snapshot.inventoryStatus === 'unavailable') throw new CartServiceError('CART_INVENTORY_UNAVAILABLE');
      const nextItems = existingItems.filter((entry) => entry.cartItemId !== existing?.cartItemId).concat(snapshot);
      const cartUpdates = { ...totals(nextItems), validationStatus, ...(cart.status === 'draft' ? { status: 'active' } : {}) };
      const { productId: immutableProductId, ...itemUpdates } = snapshot;
      return existing
        ? await cartRepository.updateCartItem({ cartId, cartItemId: existing.cartItemId, owner, expectedCartVersion, expectedItemVersion: existing.version, mutationId, updates: itemUpdates, cartUpdates, idempotencyInput })
        : await cartRepository.createCartItem({ cartId, owner, expectedCartVersion, mutationId, item: snapshot, cartUpdates, idempotencyInput });
    } catch (error) { throw translate(error); }
  }

  async function updateItemQuantity({ context, cartId, cartItemId, expectedCartVersion, expectedItemVersion, mutationId, quantity }) {
    try {
      const owner = ownerFromContext(context);
      const idempotencyInput = { operation: 'updateItemQuantity', cartItemId, quantity };
      const replay = await cartRepository.getMutationReplay({ cartId, owner, mutationId, idempotencyInput });
      if (replay) return cartRepository.getCartItem(cartId, replay.result.cartItemId);
      const cart = await cartRepository.getCart(requiredString(cartId, 'cartId'));
      assertOwned(cart, owner);
      assertMutable(cart);
      const existing = await cartRepository.getCartItem(cartId, requiredString(cartItemId, 'cartItemId'));
      if (!existing) throw new CartServiceError('CART_ITEM_NOT_FOUND');
      if (existing.cartItemType === CONFIGURED_JOB) throw new CartServiceError('CART_INVALID_INPUT');
      const product = await getTrustedProduct(existing.productId);
      validateQuantity(quantity, product);
      const lineTotalCents = product.basePrice * quantity;
      const items = await cartRepository.listCartItems(cartId);
      const updated = { ...existing, quantity, unitPriceCents: product.basePrice, lineTotalCents };
      const cartUpdates = { ...totals(items.map((entry) => entry.cartItemId === cartItemId ? updated : entry)), validationStatus: 'valid' };
      return await cartRepository.updateCartItem({ cartId, cartItemId, owner, expectedCartVersion, expectedItemVersion, mutationId, updates: { quantity, unitPriceCents: product.basePrice, lineTotalCents, productVersion: product.version, pricingVersion: product.pricingVersion, validationStatus: 'valid' }, cartUpdates, idempotencyInput });
    } catch (error) { throw translate(error); }
  }

  async function updateConfiguredJob({ context, cartId, cartItemId, expectedCartVersion, expectedItemVersion, mutationId, variantAllocations, customerConfiguration, customerInstructions }) {
    try {
      const owner = ownerFromContext(context);
      const idempotencyInput = configuredIdempotencyInput('updateConfiguredJob', { variantAllocations, customerConfiguration, customerInstructions }, { cartItemId });
      const replay = await cartRepository.getMutationReplay({ cartId, owner, mutationId, idempotencyInput });
      if (replay) return cartRepository.getCartItem(cartId, replay.result.cartItemId);
      const cart = await cartRepository.getCart(requiredString(cartId, 'cartId'));
      assertOwned(cart, owner);
      assertMutable(cart);
      const existing = await cartRepository.getCartItem(cartId, requiredString(cartItemId, 'cartItemId'));
      if (!existing) throw new CartServiceError('CART_ITEM_NOT_FOUND');
      if (existing.cartItemType !== CONFIGURED_JOB) throw new CartServiceError('CART_INVALID_INPUT');
      const resolvedInstructions = customerInstructions === undefined
        ? existing.customerInstructions
        : (typeof customerInstructions === 'string' ? customerInstructions.trim() || undefined : customerInstructions);
      const resolvedConfiguration = customerConfiguration === undefined ? existing.customerConfiguration : customerConfiguration;
      const resolvedAllocations = variantAllocations === undefined ? existing.variantAllocations : variantAllocations;
      const evaluated = await productService.evaluateCartConfiguration(existing.productId, {
        customerConfiguration: resolvedConfiguration,
        variantAllocations: resolvedAllocations,
        customerInstructions: resolvedInstructions,
      }, { assetVerifier });
      const nextDedupeKey = configuredJobDedupeKey({ productId: existing.productId, baseSku: evaluated.baseSku, customerConfiguration: evaluated.customerConfiguration });
      const items = await cartRepository.listCartItems(cartId);
      if (items.some((entry) => entry.cartItemId !== cartItemId && entry.cartItemType === CONFIGURED_JOB && entry.dedupeKey === nextDedupeKey)) {
        throw new CartServiceError('CART_CONFIGURATION_CONFLICT');
      }
      const updates = {
        baseSku: evaluated.baseSku,
        customerConfiguration: evaluated.customerConfiguration,
        variantAllocations: evaluated.variantAllocations,
        totalQuantity: evaluated.totalQuantity,
        customerInstructions: evaluated.customerInstructions ?? null,
        pricingSnapshot: evaluated.pricingSnapshot,
        dedupeVersion: evaluated.dedupeVersion,
        dedupeKey: nextDedupeKey,
        quantity: evaluated.totalQuantity,
        currency: evaluated.pricingSnapshot.currency,
        unitPriceCents: evaluated.pricingSnapshot.tier.baseUnitPriceCents,
        lineTotalCents: evaluated.lineTotalCents,
        productVersion: evaluated.pricingSnapshot.productVersion,
        pricingVersion: evaluated.pricingSnapshot.pricingVersion,
        validationStatus: 'warning',
        inventoryStatus: 'not_checked',
      };
      const cartUpdates = { ...totals(items.map((entry) => entry.cartItemId === cartItemId ? { ...entry, ...updates } : entry)), validationStatus: 'warning' };
      return cartRepository.updateCartItem({ cartId, cartItemId, owner, expectedCartVersion, expectedItemVersion, mutationId, updates, cartUpdates, idempotencyInput });
    } catch (error) { throw translate(error); }
  }

  async function removeItem({ context, cartId, cartItemId, expectedCartVersion, expectedItemVersion, mutationId }) {
    try {
      const owner = ownerFromContext(context);
      const idempotencyInput = { operation: 'removeItem', cartItemId };
      const replay = await cartRepository.getMutationReplay({ cartId, owner, mutationId, idempotencyInput });
      if (replay) return true;
      const cart = await cartRepository.getCart(requiredString(cartId, 'cartId'));
      assertOwned(cart, owner);
      assertMutable(cart);
      const items = await cartRepository.listCartItems(cartId);
      if (!items.some((entry) => entry.cartItemId === cartItemId)) throw new CartServiceError('CART_ITEM_NOT_FOUND');
      const cartUpdates = { ...totals(items.filter((entry) => entry.cartItemId !== cartItemId)), validationStatus: 'valid' };
      return await cartRepository.deleteCartItem({ cartId, cartItemId, owner, expectedCartVersion, expectedItemVersion, mutationId, cartUpdates, idempotencyInput });
    } catch (error) { throw translate(error); }
  }

  function priceChanged(original, next) {
    return original.lineTotalCents !== next.lineTotalCents
      || original.unitPriceCents !== next.unitPriceCents
      || original.productVersion !== next.productVersion
      || original.pricingVersion !== next.pricingVersion
      || JSON.stringify(canonical(original.pricingSnapshot)) !== JSON.stringify(canonical(next.pricingSnapshot));
  }

  async function mergeSimpleItems(entries) {
    const first = entries[0];
    const product = await getTrustedProduct(first.productId);
    entries.forEach((entry) => validateProductSelections(product, entry));
    const quantity = validateQuantity(entries.reduce((sum, entry) => sum + entry.quantity, 0), product);
    const unitPriceCents = product.basePrice;
    const lineTotalCents = unitPriceCents * quantity;
    if (!Number.isSafeInteger(lineTotalCents)) throw new CartServiceError('CART_PRICE_CHANGED');
    if (product.availableForSale === false) throw new CartServiceError('CART_INVENTORY_UNAVAILABLE');
    return {
      ...first, cartItemType: first.cartItemType || 'SIMPLE', quantity, currency: USD, unitPriceCents, lineTotalCents,
      productVersion: product.version, pricingVersion: product.pricingVersion,
      validationStatus: 'warning', inventoryStatus: 'not_checked', dedupeKey: dedupeKey(first),
    };
  }

  async function mergeConfiguredItems(entries) {
    const first = entries[0];
    const customerInstructions = entries.reduce((resolved, entry) => mergeInstructions(resolved, entry.customerInstructions), undefined);
    const evaluated = await productService.evaluateCartConfiguration(first.productId, {
      customerConfiguration: first.customerConfiguration,
      variantAllocations: entries.flatMap((entry) => entry.variantAllocations || []),
      customerInstructions,
    }, { assetVerifier });
    return {
      ...first, cartItemType: CONFIGURED_JOB, baseSku: evaluated.baseSku,
      customerConfiguration: evaluated.customerConfiguration, variantAllocations: evaluated.variantAllocations,
      totalQuantity: evaluated.totalQuantity, customerInstructions: evaluated.customerInstructions ?? null,
      pricingSnapshot: evaluated.pricingSnapshot, dedupeVersion: evaluated.dedupeVersion,
      dedupeKey: configuredJobDedupeKey({ productId: first.productId, baseSku: evaluated.baseSku, customerConfiguration: evaluated.customerConfiguration }),
      quantity: evaluated.totalQuantity, currency: evaluated.pricingSnapshot.currency,
      unitPriceCents: evaluated.pricingSnapshot.tier.baseUnitPriceCents, lineTotalCents: evaluated.lineTotalCents,
      productVersion: evaluated.pricingSnapshot.productVersion, pricingVersion: evaluated.pricingSnapshot.pricingVersion,
      validationStatus: 'warning', inventoryStatus: 'not_checked',
    };
  }

  async function claimAnonymousCart({ context, anonymousContext, anonymousCartId, expectedCustomerVersion, expectedAnonymousVersion, mutationId }) {
    try {
      const customerOwner = ownerFromContext(context);
      const anonymousOwner = ownerFromContext(anonymousContext);
      if (customerOwner.type !== 'customer' || anonymousOwner.type !== 'anonymous') throw new CartServiceError('CART_ACCESS_DENIED');
      const id = requiredString(mutationId, 'mutationId');
      const customerCart = await cartRepository.findOrCreateCustomerCart(customerOwner.customerId);
      assertOwned(customerCart, customerOwner);
      if (customerCart.status === 'pending_checkout') throw new CartServiceError('CART_CHECKOUT_IN_PROGRESS');
      assertMutable(customerCart);
      const source = await cartRepository.getCart(requiredString(anonymousCartId, 'anonymousCartId'));
      if (!source) throw new CartServiceError('CART_NOT_FOUND');
      assertOwned(source, anonymousOwner);

      if (source.status === 'converted') {
        const priorTarget = source.mergedIntoCartId ? await cartRepository.getCart(source.mergedIntoCartId) : null;
        if (source.migrationId === id && priorTarget?.customerId === customerOwner.customerId && !priorTarget.anonymousSessionHash) {
          const current = await cartRepository.findOrCreateCustomerCart(customerOwner.customerId);
          const state = { cart: current, items: await cartRepository.listCartItems(current.cartId, { consistentRead: true }) };
          return { ...state, warnings: source.priceUpdated ? ['CART_PRICE_UPDATED'] : [] };
        }
        throw new CartServiceError('CART_ALREADY_CONVERTED');
      }
      if (source.status === 'expired' || (Number.isInteger(source.expiresAt) && source.expiresAt <= Math.floor(Date.now() / 1000))) throw new CartServiceError('CART_EXPIRED');
      assertMutable(source);
      if (customerCart.version !== expectedCustomerVersion || source.version !== expectedAnonymousVersion) throw new CartServiceError('CART_VERSION_CONFLICT');

      const [customerItems, anonymousItems] = await Promise.all([
        cartRepository.listCartItems(customerCart.cartId, { consistentRead: true }),
        cartRepository.listCartItems(source.cartId, { consistentRead: true }),
      ]);
      const groups = new Map();
      const add = (item, origin) => {
        const configured = item.cartItemType === CONFIGURED_JOB;
        const key = `${configured ? CONFIGURED_JOB : 'SIMPLE'}:${configured ? configuredMergeKey(item) : dedupeKey(item)}`;
        const group = groups.get(key) || { entries: [], targetEntries: [] };
        group.entries.push(item);
        if (origin === 'target') group.targetEntries.push(item);
        groups.set(key, group);
      };
      customerItems.forEach((item) => add(item, 'target'));
      anonymousItems.forEach((item) => add(item, 'source'));

      const mergedItems = [];
      let updatedPrice = false;
      for (const group of groups.values()) {
        if (group.targetEntries.length > 1) throw new CartServiceError('CART_CONFIGURATION_CONFLICT');
        const configured = group.entries[0].cartItemType === CONFIGURED_JOB;
        const evaluated = configured ? await mergeConfiguredItems(group.entries) : await mergeSimpleItems(group.entries);
        updatedPrice = updatedPrice || group.entries.some((entry) => priceChanged(entry, evaluated));
        const target = group.targetEntries[0];
        const { cartId: _cartId, cartItemId: _cartItemId, createdAt: _createdAt, updatedAt: _updatedAt, version: _version, ...snapshot } = evaluated;
        mergedItems.push({ ...snapshot, ...(target ? { cartItemId: target.cartItemId, createdAt: target.createdAt, version: target.version } : {}) });
      }
      const cartUpdates = { ...totals(mergedItems), validationStatus: mergedItems.some((item) => item.validationStatus === 'warning') ? 'warning' : 'valid' };
      await cartRepository.claimAnonymousCart({
        customerId: customerOwner.customerId, customerCart, anonymousCart: source,
        anonymousSessionHash: anonymousOwner.anonymousSessionHash, mutationId: id,
        items: mergedItems, cartUpdates, priceUpdated: updatedPrice,
      });
      const persistedCart = await cartRepository.getCart(customerCart.cartId);
      const state = { cart: persistedCart, items: await cartRepository.listCartItems(customerCart.cartId, { consistentRead: true }) };
      return { ...state, warnings: updatedPrice ? ['CART_PRICE_UPDATED'] : [] };
    } catch (error) { throw translate(error); }
  }

  return { createCart, getCurrentCart, addItem, updateItemQuantity, updateConfiguredJob, removeItem, claimAnonymousCart };
}

module.exports = { createCartService, CartServiceError, dedupeKey, configuredJobDedupeKey, configuredMergeKey, constants: { USD, MIN_QUANTITY, MAX_QUANTITY, CONFIGURED_JOB } };
