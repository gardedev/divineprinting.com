'use strict';

/**
 * integrationService.js — test-only DI adapter.
 *
 * Wraps a repository object in a thin service interface so integration tests
 * can inject an in-process repository (integrationRepository) backed by
 * DynamoDB Local without touching production code.
 *
 * This class is NEVER imported by production code.  It lives entirely within
 * the test helper tree.
 *
 * Methods delegated (matching the interface the factory routes expect):
 *   createProduct, getProductById, getProductBySlug,
 *   listProducts, updateProduct, deleteProduct
 */
class ProductService {
  /**
   * @param {Object} repository
   * @param {Function} repository.createProduct
   * @param {Function} repository.getProductById
   * @param {Function} repository.getProductBySlug
   * @param {Function} repository.listProducts
   * @param {Function} repository.updateProduct
   * @param {Function} repository.deleteProduct
   */
  constructor(repository) {
    this._repo = repository;
  }

  /** Create a new product. Generates a slug from name if not provided. */
  async createProduct(data) {
    const slug = data.slug || this._slugify(data.name);
    return this._repo.createProduct({ ...data, slug });
  }

  /** Retrieve a product by its UUID. */
  async getProductById(productId) {
    return this._repo.getProductById(productId);
  }

  /** Retrieve a product by its slug. */
  async getProductBySlug(slug) {
    return this._repo.getProductBySlug(slug);
  }

  /** List products (with optional pagination / filter). */
  async listProducts(options = {}) {
    return this._repo.listProducts(options);
  }

  /** Update an existing product. */
  async updateProduct(productId, updates) {
    return this._repo.updateProduct(productId, updates);
  }

  /** Delete a product. */
  async deleteProduct(productId) {
    return this._repo.deleteProduct(productId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _slugify(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

module.exports = { ProductService };
