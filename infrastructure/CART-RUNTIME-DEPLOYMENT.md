# Task 5.4 Cart Runtime Deployment Package

Preparation only. Do not execute without reviewing a CloudFormation change set and receiving separate approval.

## Package and validate

1. Run `infrastructure/package-cart-lambda.sh`.
2. Run `aws cloudformation validate-template --template-body file://infrastructure/cart-runtime.yaml`.
3. Upload the immutable zip to an approved deployment-artifact bucket only after approval.
4. Create a `CREATE` change set for a new `divine-printing-cart-runtime` stack using the immutable bucket/key/version parameters.
5. Verify the change set contains CREATE actions only for the resources in this template.

## Routing

Preferred only after hosting verification: an Amplify 200 reverse-proxy rule placed before the static catch-all:

`/api/carts/<*>` → `<CartApiEndpoint>/api/carts/<*>`

The proxy must be proven to preserve GET, POST, PATCH, DELETE, OPTIONS and all approved cart headers. Until that proof exists, set `window.DIVINE_CART_API_BASE` to `CartApiEndpoint` and use the template's exact-origin CORS policy. Do not change the existing production API's global CORS.

## Rollback

- Redeploy the preceding static frontend artifact.
- Remove/disable only the new proxy rule or frontend cart API base.
- Roll the Lambda code back to the preceding immutable object/version.
- If necessary, conditionally mark the seeded T-shirt draft/non-sellable.
- Never delete Products, Carts, CartItems, or their data. All tables and the log group are retained if the stack is deleted.
