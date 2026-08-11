#!/usr/bin/env bash
# Sprint 4 / Task 4.1 — Apply pending Cognito settings
# Requires: AWS credentials with cognito-idp:UpdateUserPool, cognito-idp:CreateGroup,
#           cognito-idp:UpdateUserPoolClient, cognito-idp:AddCustomAttributes permissions
#
# Run as: ./apply-cognito-settings.sh
# Or: AWS_PROFILE=<admin-profile> ./apply-cognito-settings.sh

set -euo pipefail

USER_POOL_ID="us-east-1_hs1jWXB87"
CLIENT_ID="pf2ioscnn7vf7c4if5mjemos"
REGION="us-east-1"

echo "=== DivinePrinting Sprint 4 Task 4.1: Cognito Configuration ==="
echo "User Pool: $USER_POOL_ID"
echo "Region:    $REGION"
echo ""

# ─── Step 1: Remove auto-confirm Lambda trigger ──────────────────────────────
echo "[1/8] Removing auto-confirm Lambda trigger (enables real email verification)..."
aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --lambda-config '{}' \
  --region "$REGION"
echo "      ✅ Auto-confirm trigger removed"

# ─── Step 2: Update password policy ──────────────────────────────────────────
echo "[2/8] Updating password policy (min 12 chars, all complexity required)..."
aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --policies 'PasswordPolicy={MinimumLength=12,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=true,TemporaryPasswordValidityDays=7}' \
  --region "$REGION"
echo "      ✅ Password policy updated"

# ─── Step 3: Enable MFA (OPTIONAL for customers) ─────────────────────────────
echo "[3/8] Enabling OPTIONAL MFA with TOTP..."
aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --mfa-configuration OPTIONAL \
  --software-token-mfa-configuration '{"Enabled": true}' \
  --region "$REGION"
echo "      ✅ MFA enabled (OPTIONAL)"

# ─── Step 4: Account recovery: email only ────────────────────────────────────
echo "[4/8] Setting account recovery to verified email only..."
aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --account-recovery-setting 'RecoveryMechanisms=[{Priority=1,Name=verified_email}]' \
  --region "$REGION"
echo "      ✅ Account recovery set to verified email only"

# ─── Step 5: Enable Advanced Security (AUDIT mode) ───────────────────────────
echo "[5/8] Enabling Advanced Security (AUDIT mode for threat detection)..."
aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --user-pool-add-ons 'AdvancedSecurityMode=AUDIT' \
  --region "$REGION"
echo "      ✅ Advanced security AUDIT mode enabled"

# ─── Step 6: Add custom attribute: account_status ────────────────────────────
echo "[6/8] Adding custom attribute: custom:account_status..."
aws cognito-idp add-custom-attributes \
  --user-pool-id "$USER_POOL_ID" \
  --custom-attributes \
    'AttributeDataType=String,Name=account_status,Required=false,Mutable=true,StringAttributeConstraints={MinLength=1,MaxLength=50}' \
  --region "$REGION"
echo "      ✅ Custom attribute added"

# ─── Step 7: Create user groups ──────────────────────────────────────────────
echo "[7/8] Creating user groups (customer, admin, system)..."

echo "      Creating 'customer' group..."
aws cognito-idp create-group \
  --user-pool-id "$USER_POOL_ID" \
  --group-name customer \
  --description "Customer group - manage own profile, carts, uploads, checkout, and orders" \
  --precedence 10 \
  --region "$REGION"

echo "      Creating 'admin' group..."
aws cognito-idp create-group \
  --user-pool-id "$USER_POOL_ID" \
  --group-name admin \
  --description "Admin group - manage users, catalog, inventory, orders. MFA required before production." \
  --precedence 1 \
  --region "$REGION"

echo "      Creating 'system' group..."
aws cognito-idp create-group \
  --user-pool-id "$USER_POOL_ID" \
  --group-name system \
  --description "System group - reserved for backend automation and service identities. Not self-assignable." \
  --precedence 0 \
  --region "$REGION"

echo "      ✅ Groups created: customer (precedence 10), admin (precedence 1), system (precedence 0)"

# ─── Step 8: Update App Client ───────────────────────────────────────────────
echo "[8/8] Updating App Client (SRP-only auth, PKCE code flow, security hardening)..."
aws cognito-idp update-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --client-name divine-printing-web \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --supported-identity-providers COGNITO \
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
  --region "$REGION"
echo "      ✅ App client updated"

echo ""
echo "=== All Cognito settings applied successfully ==="
echo ""
echo "Summary:"
echo "  ✅ Auto-confirm Lambda trigger removed (email verification now real)"
echo "  ✅ Password policy: min 12 chars, uppercase, lowercase, numbers, symbols"
echo "  ✅ MFA: OPTIONAL (TOTP software token)"
echo "  ✅ Account recovery: verified email only"
echo "  ✅ Advanced security: AUDIT mode"
echo "  ✅ Custom attribute: custom:account_status"
echo "  ✅ Groups: customer (10), admin (1), system (0)"
echo "  ✅ App client: SRP + refresh only, Code flow (PKCE), ENABLED user-existence protection"
echo "  ✅ Token lifetimes: access=60min, id=60min, refresh=30days"
