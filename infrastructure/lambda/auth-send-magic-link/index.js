/**
 * Divine Printing — Send Magic Link
 *
 * Accepts { email } in the POST body, generates a one-time token,
 * stores it in DynamoDB (with TTL), and sends the magic link via SES.
 *
 * AWS SDK v3 — Node.js 20.x
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { randomBytes, createHmac } from 'node:crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});

const CUSTOMERS_TABLE   = process.env.CUSTOMERS_TABLE   || 'divine-printing-customers';
const TOKENS_TABLE      = process.env.TOKENS_TABLE       || 'divine-printing-auth-tokens';
const SES_SENDER_EMAIL  = process.env.SES_SENDER_EMAIL   || 'noreply@divineprinting.com';
const MAGIC_LINK_BASE   = process.env.MAGIC_LINK_BASE    || 'https://www.divineprinting.com';
const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET  || '';

const TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

export async function handler(event) {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return respond(200, {});
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  const email = (body.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    return respond(400, { error: 'Valid email is required' });
  }

  // Check if this email has ever placed an order (exists in customers table)
  const customerResult = await ddb.send(new GetCommand({
    TableName: CUSTOMERS_TABLE,
    Key: { email },
  }));

  if (!customerResult.Item) {
    // Don't reveal whether account exists — always say "check your email"
    // But skip actually sending the email
    console.log(`No customer found for ${email}, returning generic success`);
    return respond(200, {
      message: 'If an account exists for this email, a sign-in link has been sent.',
    });
  }

  // Generate a secure random token
  const rawToken = randomBytes(32).toString('hex');

  // Create HMAC signature for the token (prevents tampering)
  const signature = createHmac('sha256', MAGIC_LINK_SECRET)
    .update(rawToken)
    .digest('hex');

  const token = `${rawToken}.${signature}`;

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TOKEN_TTL_SECONDS;

  // Store token in DynamoDB with TTL
  await ddb.send(new PutCommand({
    TableName: TOKENS_TABLE,
    Item: {
      token: rawToken,   // Store only the raw token; we verify the signature on validate
      email,
      createdAt: new Date().toISOString(),
      expiresAt,         // DynamoDB TTL — auto-deletes expired tokens
      used: false,
    },
  }));

  // Build magic link URL
  const magicLink = `${MAGIC_LINK_BASE}/account/account.html?token=${encodeURIComponent(token)}`;

  // Send email via SES
  await ses.send(new SendEmailCommand({
    Source: SES_SENDER_EMAIL,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: 'Sign in to Divine Printing' },
      Body: {
        Html: {
          Data: buildEmailHtml(customerResult.Item.name || 'Customer', magicLink),
        },
        Text: {
          Data: buildEmailText(customerResult.Item.name || 'Customer', magicLink),
        },
      },
    },
  }));

  console.log(`Magic link sent to ${email}`);

  return respond(200, {
    message: 'If an account exists for this email, a sign-in link has been sent.',
  });
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function buildEmailHtml(name, link) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;font-family:'Inter',Arial,sans-serif;background:#f5efe0;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(61,26,110,.08);">
    <div style="background:linear-gradient(135deg,#3d1a6e 0%,#5a2d8a 100%);padding:32px;text-align:center;">
      <h1 style="color:#fff;font-family:'Cinzel',serif;margin:0;font-size:1.6rem;">✝ Divine Printing</h1>
      <p style="color:rgba(255,255,255,.8);margin:8px 0 0;">Crafted for the Kingdom</p>
    </div>
    <div style="padding:32px;">
      <h2 style="color:#3d1a6e;margin:0 0 16px;">Hi ${name},</h2>
      <p style="color:#6b5b7a;line-height:1.6;">
        Click the button below to sign in to your Divine Printing account. This link expires in 15 minutes.
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${link}" style="background:linear-gradient(135deg,#3d1a6e,#5a2d8a);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:600;font-size:1rem;display:inline-block;">
          Sign In to My Account
        </a>
      </div>
      <p style="color:#6b5b7a;font-size:.85rem;line-height:1.6;">
        If the button doesn't work, copy and paste this link:<br/>
        <a href="${link}" style="color:#3d1a6e;word-break:break-all;">${link}</a>
      </p>
      <hr style="border:none;border-top:1px solid #e8e2f5;margin:24px 0;"/>
      <p style="color:#999;font-size:.8rem;">
        If you didn't request this email, you can safely ignore it. No one can access your account without this link.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function buildEmailText(name, link) {
  return `Hi ${name},

Sign in to your Divine Printing account using this link:

${link}

This link expires in 15 minutes.

If you didn't request this, you can safely ignore this email.

— Divine Printing | Crafted for the Kingdom`;
}
