'use strict';

const fs = require('fs');
const path = require('path');
const defaultProductService = require('./productService');

const DEFAULT_MANIFEST = path.join(__dirname, 'data', 'product-seed.json');
const MANAGED_FIELDS = [
  'productId', 'name', 'slug', 'sku', 'supportedSkus', 'basePrice', 'currency', 'status',
  'image', 'options', 'variants', 'version', 'pricingVersion', 'sourcePage',
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
  return { CREATED: [], UNCHANGED: [], REQUIRES_REVIEW: [], INVALID: [], CONFLICTING: [], WOULD_CREATE: [], dryRun };
}

async function seedProducts({ manifest, manifestPath = DEFAULT_MANIFEST, productService = defaultProductService, dryRun = false } = {}) {
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

    const [existingById, existingBySlug] = await Promise.all([
      productService.getProduct(validated.productId),
      productService.getProductBySlug(validated.slug),
    ]);
    if (existingById || existingBySlug) {
      const sameIdentity = (!existingById || existingById.productId === validated.productId) &&
        (!existingBySlug || existingBySlug.productId === validated.productId);
      if (sameIdentity && existingById && sameManagedRecord(existingById, validated)) {
        summary.UNCHANGED.push(validated.productId);
      } else {
        summary.CONFLICTING.push({ productId: validated.productId, reason: existingBySlug && existingBySlug.productId !== validated.productId ? 'slug belongs to another product' : 'existing authoritative fields differ' });
      }
      continue;
    }

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
  seedProducts({ dryRun }).then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.INVALID.length || summary.CONFLICTING.length) process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(`Seed failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { seedProducts, sameManagedRecord, DEFAULT_MANIFEST, MANAGED_FIELDS };
