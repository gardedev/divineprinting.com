# DivinePrinting — Sprint 4 / Task 4.1: AWS Cognito Setup

**Status:** Substantially Complete — see Pending section for IAM-restricted items.

---

## 1. What Was Done

Sprint 4 Task 4.1 assessed the existing Cognito infrastructure deployed in the
`divine-printing-cognito-v2` CloudFormation stack, identified gaps against
ADR 0002 and ADR 0003, applied all changes permitted by the `openclaw-automation`
IAM user, and documented the remaining changes that require elevated Cognito IAM
permissions (to be applied by the account owner or a Cognito-privileged role).

---

## 2. Deployed Cognito Infrastructure (READ-ONLY EVIDENCE)

### 2.1 User Pool

| Property | Value |
|---|---|
| **User Pool ID** | `us-east-1_hs1jWXB87` |
| **User Pool ARN** | `arn:aws:cognito-idp:us-east-1:911762440868:userpool/us-east-1_hs1jWXB87` |
| **User Pool Name** | `divine-printing-users` |
| **Region** | `us-east-1` |
| **Sign-in** | Email (configured via original stack) |
| **JWT Algorithm** | RS256 |
| **JWKS URI** | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_hs1jWXB87/.well-known/jwks.json` |
| **Issuer** | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_hs1jWXB87` |
| **Hosted UI Domain** | `https://divine-printing-auth.auth.us-east-1.amazoncognito.com` |
| **Authorization Endpoint** | `https://divine-printing-auth.auth.us-east-1.amazoncognito.com/oauth2/authorize` |
| **Token Endpoint** | `https://divine-printing-auth.auth.us-east-1.amazoncognito.com/oauth2/token` |
| **Revocation Endpoint** | `https://divine-printing-auth.auth.us-east-1.amazoncognito.com/oauth2/revoke` |
| **CloudFormation Stack** | `divine-printing-cognito-v2` |

### 2.2 App Client

| Property | Value |
|---|---|
| **App Client ID** | `pf2ioscnn7vf7c4if5mjemos` |
| **App Client Name** | `divine-printing-web` |
| **Client Secret** | None (public browser client — correct per ADR 0002) |

### 2.3 Hosted UI Domain

| Property | Value |
|---|---|
| **Domain Prefix** | `divine-printing-auth` |
| **Full Domain** | `divine-printing-auth.auth.us-east-1.amazoncognito.com` |

---

## 3. Gap Analysis: Existing vs ADR 0002 Requirements

| Requirement | ADR 0002 | Existing State | Status |
|---|---|---|---|
| Password min length | 12 chars | 8 chars | ⚠️ Needs update |
| Password uppercase | Required | ✅ Required | ✅ |
| Password lowercase | Required | ✅ Required | ✅ |
| Password numbers | Required | ✅ Required | ✅ |
| Password symbols | Required | ✗ Not required | ⚠️ Needs update |
| Email verification | Required before checkout | Auto-confirm Lambda **bypasses** it | ⚠️ Critical fix needed |
| MFA | Optional for customers | Not configured | ⚠️ Needs update |
| Groups | customer, admin, system | None created | ⚠️ Needs creation |
| Attributes | email, given_name, family_name, phone_number, custom:account_status | Only `name` | ⚠️ Needs addition |
| Auth flow | SRP + refresh (no password auth) | SRP + refresh + USER_PASSWORD_AUTH | ⚠️ Needs update |
| Access token lifetime | 15–60 min | Default (60 min) | ✅ Acceptable |
| Refresh token lifetime | 7–30 days | Default (30 days) | ✅ Acceptable |
| App client secret | None (public) | None | ✅ |
| PreventUserExistenceErrors | ENABLED | Not set (default LEGACY) | ⚠️ Security hardening |
| OAuth flow | Code (PKCE) | Code + Implicit | ⚠️ Remove implicit |
| Advanced security (Threat Protection) | PLUS tier only | Not applicable — ESSENTIALS tier | 🔵 Deferred (see §6) |
| CORS origin | Restrict to divineprinting.com | `*` on API Gateway | ⚠️ Needs update |
| Account recovery | Email only | Not specified | ⚠️ Should be verified email |

---

## 4. Completed Changes (Sprint 4 Task 4.1)

### 4.1 ADR 0003–Compliant Customers Table (✅ DEPLOYED)

Created `divine-printing-customers-v2` — the ADR 0003–compliant customer
domain table with `customerId` (Cognito `sub`) as the primary key and the
required `EmailIndex` GSI.

**Table:** `divine-printing-customers-v2`
**Table ARN:** `arn:aws:dynamodb:us-east-1:911762440868:table/divine-printing-customers-v2`
**Status:** ACTIVE

Schema:
- Primary Key: `customerId` (String, HASH) — equals Cognito `sub`
- GSI: `EmailIndex`
  - PK: `emailNormalized` (String)
  - SK: `createdAt` (String)
  - Projection: ALL

This replaces the legacy `divine-printing-customers` table (email as PK, from
an earlier design) for the Sprint 4+ authentication implementation. The legacy
table is retained for backward compatibility.

### 4.2 Updated CloudFormation Template (✅ PREPARED)

A fully updated CloudFormation template was prepared at:
`/home/ubuntu/.openclaw/workspace/divineprinting/infrastructure/cognito-sprint4.yaml`

This template captures the complete desired state per ADR 0002/0003.
It could not be fully applied via the `openclaw-automation` IAM user (see §5),
but it is ready for the account owner to apply.

---

## 5. Pending Changes (Require Elevated Cognito IAM Permissions)

The following changes are blocked by the `openclaw-automation` IAM user lacking
`cognito-idp:*` permissions. The account owner must apply these using the AWS
Console or a privileged IAM role/user.

### 5.1 Create User Groups (CRITICAL — ADR 0002 role model)

```bash
# customer group (normal authenticated shoppers)
aws cognito-idp create-group \
  --user-pool-id us-east-1_hs1jWXB87 \
  --group-name customer \
  --description "Customer group - manage own profile, carts, uploads, checkout, orders" \
  --precedence 10 \
  --region us-east-1

# admin group (platform administrators)
aws cognito-idp create-group \
  --user-pool-id us-east-1_hs1jWXB87 \
  --group-name admin \
  --description "Admin group - manage users, catalog, inventory, orders. MFA required before production." \
  --precedence 1 \
  --region us-east-1

# system group (backend automation / machine clients — NOT browser self-service)
aws cognito-idp create-group \
  --user-pool-id us-east-1_hs1jWXB87 \
  --group-name system \
  --description "System group - reserved for backend automation and service identities. Not self-assignable." \
  --precedence 0 \
  --region us-east-1
```

### 5.2 Remove Auto-Confirm Lambda Trigger (CRITICAL — Email Verification Bypass)

The current pool has a `PreSignUp` Lambda trigger (`divine-printing-auto-confirm`)
that **auto-confirms all users and auto-verifies their email without sending a
verification email**. This violates ADR 0002 which requires verified email before
checkout and account-sensitive operations.

```bash
# Remove the pre-signup trigger so Cognito sends real verification emails
aws cognito-idp update-user-pool \
  --user-pool-id us-east-1_hs1jWXB87 \
  --lambda-config '{}' \
  --region us-east-1
```

### 5.3 Update Password Policy (ADR 0002: min 12 chars, symbols required)

```bash
aws cognito-idp update-user-pool \
  --user-pool-id us-east-1_hs1jWXB87 \
  --policies 'PasswordPolicy={MinimumLength=12,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=true,TemporaryPasswordValidityDays=7}' \
  --region us-east-1
```

### 5.4 Enable MFA (OPTIONAL for customers per ADR 0002)

```bash
aws cognito-idp update-user-pool \
  --user-pool-id us-east-1_hs1jWXB87 \
  --mfa-configuration OPTIONAL \
  --software-token-mfa-configuration '{"Enabled": true}' \
  --region us-east-1
```

### 5.5 Add Missing Schema Attributes (ADR 0002/0003)

```bash
aws cognito-idp add-custom-attributes \
  --user-pool-id us-east-1_hs1jWXB87 \
  --custom-attributes \
    'AttributeDataType=String,Name=account_status,Required=false,Mutable=true,StringAttributeConstraints={MinLength=1,MaxLength=50}' \
  --region us-east-1

# Note: given_name, family_name, phone_number are standard Cognito attributes
# that already exist in every user pool — no action needed for those.
```

### 5.6 Update App Client (ADR 0002: remove implicit flow, remove USER_PASSWORD_AUTH)

```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id us-east-1_hs1jWXB87 \
  --client-id pf2ioscnn7vf7c4if5mjemos \
  --client-name divine-printing-web \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --allowed-o-auth-flows code \
  --allowed-o-auth-scopes email openid profile \
  --allowed-o-auth-flows-user-pool-client \
  --callback-urls \
    'https://divineprinting.com/account/account.html' \
    'https://www.divineprinting.com/account/account.html' \
    'http://localhost:3000/account/account.html' \
  --logout-urls \
    'https://divineprinting.com/account/account.html' \
    'https://www.divineprinting.com/account/account.html' \
    'http://localhost:3000/account/account.html' \
  --prevent-user-existence-errors ENABLED \
  --access-token-validity 60 \
  --id-token-validity 60 \
  --refresh-token-validity 30 \
  --token-validity-units 'AccessToken=minutes,IdToken=minutes,RefreshToken=days' \
  --read-attributes email email_verified name given_name family_name phone_number phone_number_verified custom:account_status \
  --write-attributes email name given_name family_name phone_number \
  --region us-east-1
```

### 5.7 Account Recovery: Email Only (ADR 0002)

```bash
aws cognito-idp update-user-pool \
  --user-pool-id us-east-1_hs1jWXB87 \
  --account-recovery-setting 'RecoveryMechanisms=[{Priority=1,Name=verified_email}]' \
  --region us-east-1
```

---

## 6. Deferred Future Security Enhancements (Post-MVP)

> **Context:** During Sprint 4 Stage 2 deployment, enabling `UserPoolAddOns:
> AdvancedSecurityMode: AUDIT` caused a CloudFormation update failure and rollback.
> Root cause: **Threat Protection (AdvancedSecurityMode) requires the Cognito User
> Pools PLUS tier.** This AWS account is provisioned on the **ESSENTIALS tier only**.
> Chris has explicitly approved deferring this feature for MVP.

### 6.1 Threat Protection / Advanced Security (Cognito PLUS feature)

**What it is:** AWS Cognito Threat Protection (previously "Advanced Security") provides
machine-learning–based detection of compromised credentials, account takeover,
and anomalous sign-in behaviour. It operates in `AUDIT` (log only) or `ENFORCED`
(block) mode.

**Why deferred:** Requires an upgrade to the **Cognito User Pools PLUS plan**
(additional cost per MAU). Not available on ESSENTIALS.

**When to revisit:** When the business upgrades its Cognito tier (PLUS plan), or
when a custom domain + WAF are in place for production hardening.

**How to enable (future):**
```bash
# Only after upgrading to Cognito PLUS tier
aws cognito-idp update-user-pool \
  --user-pool-id us-east-1_hs1jWXB87 \
  --user-pool-add-ons 'AdvancedSecurityMode=AUDIT' \
  --region us-east-1
# Upgrade to ENFORCED once custom domain + WAF are operational
```

**CloudFormation (future):** Add the following block to the `UserPool` resource
in `cognito-update.yaml` only after the PLUS tier is confirmed active:
```yaml
      UserPoolAddOns:
        AdvancedSecurityMode: AUDIT  # upgrade to ENFORCED with WAF in production
```

---

## 7. Convenience Script

All pending changes (§5) can be applied in one script once the account owner grants
Cognito permissions (or runs directly from the console):

`/home/ubuntu/.openclaw/workspace/divineprinting/infrastructure/apply-cognito-settings.sh`

---

## 8. IAM Permission Gap

The `openclaw-automation` IAM user (`arn:aws:iam::911762440868:user/openclaw-automation`)
is missing the following Cognito permissions required to complete this task:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cognito-idp:DescribeUserPool",
        "cognito-idp:UpdateUserPool",
        "cognito-idp:CreateGroup",
        "cognito-idp:ListGroups",
        "cognito-idp:UpdateUserPoolClient",
        "cognito-idp:DescribeUserPoolClient",
        "cognito-idp:AddCustomAttributes",
        "cognito-idp:ListUsers"
      ],
      "Resource": "arn:aws:cognito-idp:us-east-1:911762440868:userpool/us-east-1_hs1jWXB87"
    }
  ]
}
```

**Recommendation:** Add this inline policy to the `openclaw-automation` user so
the engineer agent can manage the Cognito pool going forward.

---

## 9. What's Working Now

- **User Pool:** Deployed at `us-east-1_hs1jWXB87`
- **App Client:** Deployed at `pf2ioscnn7vf7c4if5mjemos` (no secret — correct)
- **Hosted UI:** Active at `divine-printing-auth.auth.us-east-1.amazoncognito.com`
- **JWT validation:** RS256, JWKS publicly accessible
- **OpenID Connect:** Full OIDC discovery endpoint live
- **DynamoDB tables:** All 4 tables ACTIVE (legacy + new v2)
- **CustomersTableV2:** ADR 0003–compliant schema deployed (`customerId` PK + `EmailIndex` GSI)
- **API Gateway:** JWT authorizer configured against the user pool
- **Lambda functions:** webhook, orders, designs — all deployed and functional

---

## 10. Architecture Compliance Summary

| ADR 0002 Requirement | Compliance |
|---|---|
| Single User Pool for customers + admins | ✅ Deployed |
| Email sign-in alias | ✅ Configured |
| No client secret in frontend | ✅ GenerateSecret: false |
| RS256 JWT signing | ✅ Confirmed via JWKS |
| JWKS endpoint accessible | ✅ Public |
| Hosted UI domain | ✅ divine-printing-auth |
| Authorization Code flow | ✅ Configured |
| Groups: customer, admin, system | ⚠️ Pending (IAM blocked) |
| Email verification required | ⚠️ Pending — auto-confirm Lambda must be removed |
| Password policy (12 chars, symbols) | ⚠️ Pending — currently 8 chars, no symbols |
| MFA: optional for customers | ⚠️ Pending |
| Token lifetimes configured | ⚠️ Pending (using defaults which are acceptable) |
| Account recovery: email only | ⚠️ Pending |
| PreventUserExistenceErrors: ENABLED | ⚠️ Pending |
| Advanced security / Threat Protection | 🔵 Deferred (PLUS tier — post-MVP, see §6) |

| ADR 0003 Requirement | Compliance |
|---|---|
| customerId = Cognito sub | ✅ Architecture defined |
| Customers table: customerId PK | ✅ divine-printing-customers-v2 ACTIVE |
| EmailIndex GSI | ✅ ACTIVE on divine-printing-customers-v2 |
| Customer record creation idempotent | Architecture requirement (implementation task) |
| DynamoDB: no tokens/passwords stored | ✅ By design |
