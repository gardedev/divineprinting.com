'use strict';

/**
 * ProductService
 *
 * Business logic layer for product management.
 * Responsibilities:
 *   - Input validation (required fields, types, value ranges)
 *   - Slug generation from product name
 *   - Duplicate slug detection via ProductRepository
 *   - Status validation
 *   - Delegating persistence to ProductRepository
 *
 * This module does NOT access DynamoDB directly.
 * All data access is done through the injected or default ProductRepository.
 */

const productRepository = require('./productRepository');

/** Valid product status values (excluding the internal 'deleted' sentinel) */
const VALID_STATUSES = ['active', 'draft', 'archived'];

/** All possible status values including soft-delete sentinel */
const ALL_STATUSES = ['active', 'draft', 'archived', 'deleted'];

/** Default status when none is supplied */
const DEFAULT_STATUS = 'draft';

/**
 * Legal status transitions for explicit lifecycle methods.
 *
 * Maps fromStatus → Set of allowed toStatus values.
 * These rules are enforced by publishProduct / archiveProduct / restoreProduct.
 */
const ALLOWED_TRANSITIONS = {
  draft:    new Set(['active']),
  active:   new Set(['archived']),
  archived: new Set(['draft']),
  deleted:  new Set(),  // soft-deleted products cannot transition
};

/**
 * Generates a URL-safe slug from a product name.
 *
 * Rules:
 *   1. Lower-case the input.
 *   2. Replace any non-alphanumeric characters (except spaces) with spaces.
 *   3. Trim leading/trailing whitespace.
 *   4. Replace runs of whitespace with a single hyphen.
 *
 * @param {string} name - The product name to slugify.
 * @returns {string} The generated slug (e.g. "Vinyl Banner!" → "vinyl-banner").
 */
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ') // keep alphanumeric, spaces, hyphens
    .trim()
    .replace(/[\s-]+/g, '-');       // collapse runs of spaces/hyphens
}

/**
 * Resolves a unique slug for a new product.
 *
 * If the base slug is already taken, appends a numeric suffix (e.g. "-2", "-3", …)
 * until a free slot is found, up to MAX_SLUG_ATTEMPTS.
 *
 * @param {string} baseSlug - The initial slug derived from the product name.
 * @param {Object} [repo] - ProductRepository (allows injection in tests).
 * @returns {Promise<string>} A slug that does not yet exist in the database.
 * @throws {Error} If a unique slug cannot be found within MAX_SLUG_ATTEMPTS.
 */
const MAX_SLUG_ATTEMPTS = 100;

async function resolveUniqueSlug(baseSlug, repo) {
  const candidate = baseSlug;
  const existing = await repo.getProductBySlug(candidate);
  if (!existing) {
    return candidate;
  }

  for (let i = 2; i <= MAX_SLUG_ATTEMPTS; i++) {
    const suffixed = `${baseSlug}-${i}`;
    const taken = await repo.getProductBySlug(suffixed);
    if (!taken) {
      return suffixed;
    }
  }

  throw new Error(
    `Unable to generate a unique slug for "${baseSlug}" after ${MAX_SLUG_ATTEMPTS} attempts.`
  );
}

/**
 * Validates the common product input fields shared by createProduct.
 *
 * @param {Object} data - Raw input data.
 * @throws {Error} If any required field is missing or invalid.
 */
function validateProductInput(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Product data must be a non-null object.');
  }

  // name – required, non-empty string
  if (typeof data.name !== 'string' || data.name.trim() === '') {
    throw new Error('name is required and must be a non-empty string.');
  }

  // basePrice – required, non-negative integer (cents)
  if (
    typeof data.basePrice !== 'number' ||
    !Number.isInteger(data.basePrice) ||
    data.basePrice < 0
  ) {
    throw new Error(
      'basePrice must be a non-negative integer representing cents (e.g. 1999 for $19.99).'
    );
  }

  // status – optional, but must be one of the allowed values if supplied
  if (data.status !== undefined && !VALID_STATUSES.includes(data.status)) {
    throw new Error(
      `status must be one of: ${VALID_STATUSES.join(', ')}.`
    );
  }
}

/**
 * Creates a new product after validating inputs, generating a unique slug,
 * and persisting the item via the repository.
 *
 * @param {Object} productData - The raw product data from the caller.
 * @param {string}  productData.name        - Required. Human-readable name.
 * @param {string}  [productData.description] - Optional description.
 * @param {number}  productData.basePrice   - Required. Price in integer cents.
 * @param {string}  [productData.status]    - Optional. Defaults to 'draft'.
 * @param {string}  [productData.slug]      - Optional. If omitted, auto-generated from name.
 * @param {Object}  [_repo]                 - Optional repository override (for testing).
 * @returns {Promise<Object>} The newly created product item (with productId, slug, timestamps).
 * @throws {Error} On validation failures or repository errors.
 */
async function createProduct(productData, _repo) {
  const repo = _repo || productRepository;

  validateProductInput(productData);

  // Determine the slug: use caller-provided one or generate from name
  const rawSlug =
    typeof productData.slug === 'string' && productData.slug.trim() !== ''
      ? productData.slug.trim()
      : generateSlug(productData.name.trim());

  // Ensure the slug is unique (append numeric suffix if necessary)
  const slug = await resolveUniqueSlug(rawSlug, repo);

  // Apply default status
  const status =
    productData.status !== undefined ? productData.status : DEFAULT_STATUS;

  const prepared = {
    ...productData,
    name: productData.name.trim(),
    slug,
    status,
  };

  return repo.createProduct(prepared);
}

/**
 * Retrieves a product by its unique ID.
 *
 * @param {string} productId - The UUID of the product.
 * @param {Object} [_repo]   - Optional repository override.
 * @returns {Promise<Object|null>} The product item, or null if not found.
 * @throws {Error} If productId is not a non-empty string.
 */
async function getProduct(productId, _repo) {
  const repo = _repo || productRepository;

  if (typeof productId !== 'string' || productId.trim() === '') {
    throw new Error('productId must be a non-empty string.');
  }

  return repo.getProductById(productId.trim());
}

/**
 * Retrieves a product by its URL slug.
 *
 * @param {string} slug    - The URL slug of the product.
 * @param {Object} [_repo] - Optional repository override.
 * @returns {Promise<Object|null>} The product item, or null if not found.
 * @throws {Error} If slug is not a non-empty string.
 */
async function getProductBySlug(slug, _repo) {
  const repo = _repo || productRepository;

  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new Error('slug must be a non-empty string.');
  }

  return repo.getProductBySlug(slug.trim());
}

/**
 * Lists products with optional status filtering and cursor-based pagination.
 *
 * @param {Object} [options={}]  - Listing options.
 * @param {number} [options.limit=10]  - Max items per page (positive integer).
 * @param {string} [options.status]    - Optional status filter: 'active', 'draft', or 'archived'.
 * @param {string} [options.cursor]    - Optional base64-encoded pagination cursor.
 * @param {Object} [_repo]             - Optional repository override.
 * @returns {Promise<{items: Object[], nextCursor: string|null}>}
 * @throws {Error} On invalid options or repository errors.
 */
async function listProducts(options, _repo) {
  const repo = _repo || productRepository;
  const opts = options || {};

  // Validate limit if explicitly provided
  if (opts.limit !== undefined) {
    if (!Number.isInteger(opts.limit) || opts.limit <= 0) {
      throw new Error('limit must be a positive integer.');
    }
  }

  // Validate status if explicitly provided
  if (opts.status !== undefined && !VALID_STATUSES.includes(opts.status)) {
    throw new Error(
      `status must be one of: ${VALID_STATUSES.join(', ')}.`
    );
  }

  return repo.listProducts(opts);
}

/**
 * Updates mutable fields of an existing product.
 *
 * Mutable fields: name, description, basePrice, status.
 * Immutable fields (silently ignored): productId, slug, createdAt, updatedAt, deletedAt.
 *
 * The product must exist and must not be soft-deleted.
 *
 * @param {string} productId    - The UUID of the product to update.
 * @param {Object} updates      - Partial product data containing fields to change.
 * @param {Object} [_repo]      - Optional repository override (for testing).
 * @returns {Promise<Object>}   The updated product item.
 * @throws {Error} If productId is invalid, the product is not found,
 *                 the product is soft-deleted, or a field value is invalid.
 */
async function updateProduct(productId, updates, _repo) {
  const repo = _repo || productRepository;

  if (typeof productId !== 'string' || productId.trim() === '') {
    throw new Error('productId must be a non-empty string.');
  }

  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('updates must be a non-null object.');
  }

  const existing = await repo.getProductById(productId.trim());
  if (!existing) {
    throw new Error(`Product not found: ${productId.trim()}`);
  }
  if (existing.deletedAt) {
    throw new Error('Cannot update a soft-deleted product.');
  }

  // Validate supplied mutable fields
  if (updates.name !== undefined) {
    if (typeof updates.name !== 'string' || updates.name.trim() === '') {
      throw new Error('name must be a non-empty string.');
    }
  }

  if (updates.basePrice !== undefined) {
    if (
      typeof updates.basePrice !== 'number' ||
      !Number.isInteger(updates.basePrice) ||
      updates.basePrice < 0
    ) {
      throw new Error(
        'basePrice must be a non-negative integer representing cents (e.g. 1999 for $19.99).'
      );
    }
  }

  if (updates.status !== undefined) {
    if (!VALID_STATUSES.includes(updates.status)) {
      throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}.`);
    }
  }

  // Strip immutable fields from the update payload
  const IMMUTABLE = ['productId', 'slug', 'createdAt', 'updatedAt', 'deletedAt'];
  const safeUpdates = Object.fromEntries(
    Object.entries(updates).filter(([k]) => !IMMUTABLE.includes(k))
  );

  if (updates.name !== undefined) {
    safeUpdates.name = updates.name.trim();
  }

  return repo.updateProduct(productId.trim(), safeUpdates);
}

/**
 * Transitions a product from 'draft' to 'active' (publishes it).
 *
 * @param {string} productId  - The UUID of the product.
 * @param {Object} [_repo]    - Optional repository override.
 * @returns {Promise<Object>} The updated product item with status 'active'.
 * @throws {Error} If productId is invalid, product not found, or transition is illegal.
 */
async function publishProduct(productId, _repo) {
  return _applyTransition(productId, 'active', _repo);
}

/**
 * Transitions a product from 'active' to 'archived'.
 *
 * @param {string} productId  - The UUID of the product.
 * @param {Object} [_repo]    - Optional repository override.
 * @returns {Promise<Object>} The updated product item with status 'archived'.
 * @throws {Error} If productId is invalid, product not found, or transition is illegal.
 */
async function archiveProduct(productId, _repo) {
  return _applyTransition(productId, 'archived', _repo);
}

/**
 * Transitions a product from 'archived' to 'draft' (restores it).
 *
 * @param {string} productId  - The UUID of the product.
 * @param {Object} [_repo]    - Optional repository override.
 * @returns {Promise<Object>} The updated product item with status 'draft'.
 * @throws {Error} If productId is invalid, product not found, or transition is illegal.
 */
async function restoreProduct(productId, _repo) {
  return _applyTransition(productId, 'draft', _repo);
}

/**
 * Internal helper: validates and applies a status transition.
 *
 * @param {string} productId    - UUID of the product.
 * @param {string} toStatus     - The desired target status.
 * @param {Object} [_repo]      - Optional repository override.
 * @returns {Promise<Object>}   Updated product item.
 * @throws {Error} If the transition is not permitted.
 */
async function _applyTransition(productId, toStatus, _repo) {
  const repo = _repo || productRepository;

  if (typeof productId !== 'string' || productId.trim() === '') {
    throw new Error('productId must be a non-empty string.');
  }

  const existing = await repo.getProductById(productId.trim());
  if (!existing) {
    throw new Error(`Product not found: ${productId.trim()}`);
  }

  const fromStatus = existing.status;
  const allowed = ALLOWED_TRANSITIONS[fromStatus];

  if (!allowed || !allowed.has(toStatus)) {
    throw new Error(
      `Invalid status transition: cannot move from '${fromStatus}' to '${toStatus}'.`
    );
  }

  return repo.updateProduct(productId.trim(), { status: toStatus });
}

/**
 * Soft-deletes a product by setting its status to 'deleted' and recording
 * a deletedAt timestamp.  The product record remains in DynamoDB but is
 * excluded from normal listings.
 *
 * A soft-deleted product cannot be updated or have its status transitioned
 * through normal lifecycle methods.
 *
 * @param {string} productId  - The UUID of the product to delete.
 * @param {Object} [_repo]    - Optional repository override.
 * @returns {Promise<Object>} The soft-deleted product item.
 * @throws {Error} If productId is invalid, product not found, or already deleted.
 */
async function deleteProduct(productId, _repo) {
  const repo = _repo || productRepository;

  if (typeof productId !== 'string' || productId.trim() === '') {
    throw new Error('productId must be a non-empty string.');
  }

  const existing = await repo.getProductById(productId.trim());
  if (!existing) {
    throw new Error(`Product not found: ${productId.trim()}`);
  }

  if (existing.deletedAt) {
    throw new Error('Product is already deleted.');
  }

  const now = new Date().toISOString();
  return repo.updateProduct(productId.trim(), {
    status: 'deleted',
    deletedAt: now,
  });
}

module.exports = {
  createProduct,
  getProduct,
  getProductBySlug,
  listProducts,
  updateProduct,
  publishProduct,
  archiveProduct,
  restoreProduct,
  deleteProduct,
  // Exported for testing convenience
  generateSlug,
  resolveUniqueSlug,
};
