'use strict';

const fs = require('fs');
const path = require('path');
const defaultProductService = require('./productService');
const { validateStandardConfigurableDefinition } = require('./standardConfiguredProduct');

const DEFAULT_MANIFEST = path.join(__dirname, 'data', 'product-seed.json');

// MANAGED_FIELDS: all fields that seedProducts compares and controls.
// Additions here ensure materially different records are never misclassified as unchanged.
const MANAGED_FIELDS = [
  'productId', 'name', 'slug', 'sku', 'supportedSkus', 'basePrice', 'currency', 'status',
  'image', 'productType', 'garment', 'options', 'variants', 'quantityPricing', 'designTemplates',
  'customization', 'designSnapshot', 'productionRules', 'businessReviewStatus', 'sellable',
  'availableForSale', 'operationalReadiness', 'version', 'pricingVersion', 'sourcePage',
  // Standard-configurable fields omitted in the original MANAGED_FIELDS — now included:
  'quantityMode', 'variantDimensions', 'minimumQuantity', 'quantityIncrement',
  'requiresReview', 'reviewNotes',
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function sameManagedRecord(left, right) {
  return JSON.stringify(canonical(Object.fromEntries(MANAGED_FIELDS.map((field) => [field, left?.[field] ?? null])))) ===
    JSON.stringify(canonical(Object.fromEntries(MANAGED_FIELDS.map((field) => [field, right?.[field] ?? null]))));
}

function basicManifestRecord(record) {
  if (!record || typeof record !== 'object') return 'record must be an object';
  for (const field of ['productId', 'name', 'slug', 'sourcePage']) {
    if (typeof record[field] !== 'string' || !record[field].trim()) return `${field} is required`;
  }
  if (typeof record.requiresReview !== 'boolean') return 'requiresReview must be boolean';
  return null;
}

function emptySummary(dryRun) {
  return { CREATED: [], UNCHANGED: [], REQUIRES_REVIEW: [], INVALID: [], CONFLICTING: [], WOULD_CREATE: [], UPDATED: [], WOULD_UPDATE: [], dryRun };
}

/**
 * Determine whether a manifest record is eligible for a controlled synchronization update.
 *
 * A record is sync-eligible when:
 *   1. It already exists in the database by productId.
 *   2. The slug belongs to the same productId (no slug hijack).
 *   3. The managed fields differ (otherwise it would be UNCHANGED).
 *
 * Sync is a controlled, explicit action: the caller must pass `allowSync: true`.
 * Without it, changed persisted records are still classified as CONFLICTING so that
 * no accidental overwrite occurs in a plain seed run.
 */
async function seedProducts({ manifest, manifestPath = DEFAULT_MANIFEST, productService = defaultProductService, dryRun = false, allowSync = false } = {}) {
  const source = manifest || JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!source || !Array.isArray(source.records)) throw new Error('Manifest must contain a records array.');
  const summary = emptySummary(Boolean(dryRun));
  const idCounts = new Map();
  const slugCounts = new Map();

  for (const record of source.records) {
    if (typeof record?.productId === 'string' && record.productId.trim()) {
      idCounts.set(record.productId, (idCounts.get(record.productId) || 0) + 1);
    }
    if (typeof record?.slug === 'string' && record.slug.trim()) {
      slugCounts.set(record.slug, (slugCounts.get(record.slug) || 0) + 1);
    }
  }

  for (const record of source.records) {
    const basicError = basicManifestRecord(record);
    if (basicError) {
      summary.INVALID.push({ productId: record?.productId || null, reason: basicError });
      continue;
    }
    if (idCounts.get(record.productId) > 1) {
      summary.INVALID.push({ productId: record.productId, reason: 'duplicate productId in manifest' });
      continue;
    }
    if (slugCounts.get(record.slug) > 1) {
      summary.INVALID.push({ productId: record.productId, reason: 'duplicate slug in manifest' });
      continue;
    }

    if (record.requiresReview) {
      summary.REQUIRES_REVIEW.push({ productId: record.productId, sourcePage: record.sourcePage });
      continue;
    }

    let validated;
    try {
      validated = productService.validateSeedProduct(record);
    } catch (error) {
      summary.INVALID.push({ productId: record.productId, reason: error.message });
      continue;
    }

    // For standard-configurable products, validate the structural definition
    // (variantDimensions, variants, options coherence) before any persistence.
    // This runs after validateSeedProduct() so lifecycle guards (requiresReview,
    // status=active, etc.) are already enforced.
    if (validated.productType === 'standard-configurable') {
      try {
        validateStandardConfigurableDefinition(validated);
      } catch (error) {
        summary.INVALID.push({ productId: validated.productId, reason: error.message });
        continue;
      }
    }

    const [existingById, existingBySlug] = await Promise.all([
      productService.getProduct(validated.productId),
      productService.getProductBySlug(validated.slug),
    ]);

    if (existingById || existingBySlug) {
      const sameIdentity = (!existingById || existingById.productId === validated.productId) &&
        (!existingBySlug || existingBySlug.productId === validated.productId);

      if (!sameIdentity) {
        // Slug belongs to a different product — always a hard conflict.
        summary.CONFLICTING.push({ productId: validated.productId, reason: 'slug belongs to another product' });
        continue;
      }

      if (existingById && sameManagedRecord(existingById, validated)) {
        summary.UNCHANGED.push(validated.productId);
        continue;
      }

      // Managed fields differ. With allowSync this is a controlled update; without it, report as CONFLICTING.
      if (!allowSync) {
        summary.CONFLICTING.push({ productId: validated.productId, reason: 'existing authoritative fields differ' });
        continue;
      }

      // Controlled synchronization: update the existing record.
      if (dryRun) {
        summary.WOULD_UPDATE.push(validated.productId);
        continue;
      }
      try {
        await productService.updateSeedProduct(validated);
        summary.UPDATED.push(validated.productId);
      } catch (error) {
        summary.CONFLICTING.push({ productId: validated.productId, reason: error.message });
      }
      continue;
    }

    // No existing record — create.
    if (dryRun) {
      summary.WOULD_CREATE.push(validated.productId);
      continue;
    }
    try {
      await productService.createSeedProduct(validated);
      summary.CREATED.push(validated.productId);
    } catch (error) {
      summary.CONFLICTING.push({ productId: validated.productId, reason: error.name === 'ConditionalCheckFailedException' ? 'conditional create collision' : error.message });
    }
  }
  return summary;
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const allowSync = process.argv.includes('--allow-sync');
  seedProducts({ dryRun, allowSync }).then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.INVALID.length || summary.CONFLICTING.length) process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(`Seed failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { seedProducts, sameManagedRecord, DEFAULT_MANIFEST, MANAGED_FIELDS };
