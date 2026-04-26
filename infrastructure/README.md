# Divine Printing — Account Dashboard Infrastructure

Custom account dashboard system: DynamoDB-backed order storage, email magic link auth, and customer-facing API.

## Architecture

```
Snipcart Order → Webhook → API Gateway → Lambda → DynamoDB
                                                    (orders + customers)

Customer Login → Magic Link Email → Token Validation → Session Token (localStorage)
                                                        ↓
Account Pages → API Gateway → Lambda → DynamoDB → Orders / Profile
```

## Components

### DynamoDB Tables

| Table | Hash Key | GSI | Purpose |
|-------|----------|-----|---------|
| `divine-printing-orders` | `orderId` | `CustomerEmailIndex` (email + createdAt) | Order data |
| `divine-printing-customers` | `email` | — | Customer profiles |
| `divine-printing-auth-tokens` | `token` | — (TTL-enabled) | Magic link tokens |

### Lambda Functions

| Function | Route | Purpose |
|----------|-------|---------|
| `webhook` | `POST /webhook` | Snipcart `order.completed` handler |
| `auth-send` | `POST /auth/send-magic-link` | Email magic link via SES |
| `auth-validate` | `POST /auth/validate` | Validate token, issue session |
| `account-api` | `GET /account/orders`, `GET /account/profile` | Customer data API |

### Frontend

| File | Purpose |
|------|---------|
| `js/account-auth.js` | Auth client library (magic link + session management) |
| `account/account.html` | Dashboard (stats, recent orders) |
| `account/orders.html` | Full order history with search/filter |

## Deployment

### Prerequisites

- AWS CLI configured with appropriate credentials
- Terraform >= 1.5
- Node.js >= 18
- SES-verified sender email

### Steps

1. **Copy and fill in variables:**
   ```bash
   cd infrastructure/terraform
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your values
   ```

2. **Generate a magic link secret:**
   ```bash
   openssl rand -hex 32
   # Paste into terraform.tfvars as magic_link_secret
   ```

3. **Deploy:**
   ```bash
   ./infrastructure/deploy.sh
   # Review the plan, then:
   cd infrastructure/terraform && terraform apply tfplan
   ```

4. **Update frontend API URL:**
   After terraform outputs the `api_endpoint`, update `API_BASE_URL` in:
   - `account/account.html`
   - `account/orders.html`

5. **Configure Snipcart webhook:**
   - Go to Snipcart Dashboard → Account → Webhooks
   - Add webhook URL: `<api_endpoint>/webhook`
   - Event: `order.completed`

6. **Verify SES sender:**
   - In AWS Console → SES, verify `noreply@divineprinting.com`
   - For production, request SES production access

## Auth Flow

1. Customer enters email on sign-in form
2. `POST /auth/send-magic-link` → checks if customer exists (from prior Snipcart orders)
3. If found, generates token + sends magic link email via SES
4. Customer clicks link → lands on `account.html?token=xxx`
5. `POST /auth/validate` → verifies token, returns session token
6. Session token stored in localStorage (30-day expiry)
7. All subsequent API calls use `Authorization: Bearer <sessionToken>`

## Security Notes

- Magic link tokens are one-time use, expire in 15 minutes
- Session tokens are HMAC-signed, expire in 30 days
- DynamoDB TTL auto-deletes expired auth tokens
- No passwords stored anywhere
- CORS restricted to divineprinting.com origins
- Snipcart webhook validated via request token header

## Cost Estimate (Low Traffic)

| Service | Monthly Cost |
|---------|-------------|
| DynamoDB (on-demand) | ~$0.25 |
| Lambda (100 invocations) | Free tier |
| API Gateway (100 requests) | Free tier |
| SES (100 emails) | ~$0.01 |
| **Total** | **< $1/month** |
