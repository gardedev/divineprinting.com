# AWS Setup Guide — Divine Printing File Upload System

**Goal:** Let customers upload their artwork files (JPG, PNG, PDF, AI, EPS, PSD) directly to S3 — securely, without routing the binary through your server.

---

## Architecture

```
Browser → API Gateway → Lambda → S3 Presigned URL
         (gets URL)                ↓
Browser ←────────────────────── POSTs file directly to S3
```

Files land in `s3://divineprinting-uploads/uploads/YYYY-MM-DD/<uuid>-filename.ext`

---

## Step 1: Create the S3 Bucket

1. Go to **AWS Console → S3**
2. Click **Create bucket**
3. Settings:
   - **Bucket name:** `divineprinting-uploads`
   - **Region:** `us-east-1` (match your Lambda region)
   - **Block Public Access:** ✅ Keep ALL options checked (uploads use presigned URLs, never public)
   - **Versioning:** Optional (recommended for production)
4. Click **Create bucket**

### Configure CORS on the bucket

1. Click into your new bucket → **Permissions** tab → **Cross-origin resource sharing (CORS)**
2. Click **Edit** and paste:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["POST"],
    "AllowedOrigins": ["https://www.divineprinting.com", "https://divineprinting.com"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

3. Click **Save changes**

---

## Step 2: Create the IAM Role for Lambda

1. Go to **IAM → Roles → Create role**
2. **Trusted entity:** AWS Service → Lambda
3. **Policies to attach:**
   - `AWSLambdaBasicExecutionRole` (logs to CloudWatch)
4. **Role name:** `divineprinting-upload-lambda-role`
5. Click **Create role**

### Add inline S3 policy to the role

1. Click into the new role → **Add permissions → Create inline policy**
2. Switch to JSON tab and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::divineprinting-uploads/*"
    }
  ]
}
```

3. Name it `divineprinting-s3-upload` → **Create policy**

---

## Step 3: Deploy the Lambda Function

### Option A: AWS Console (manual)

1. Go to **Lambda → Create function**
2. **Function name:** `divineprinting-upload-url`
3. **Runtime:** Node.js 20.x
4. **Architecture:** x86_64
5. **Execution role:** Use existing → `divineprinting-upload-lambda-role`
6. Click **Create function**

#### Upload the code

1. On your local machine (or the server), run:
   ```bash
   cd /path/to/divineprinting/lambda/upload-url
   npm install --production
   zip -r upload-url.zip .
   ```
2. In Lambda console → **Code** tab → **Upload from → .zip file**
3. Upload `upload-url.zip`

#### Configure environment variables

In Lambda → **Configuration → Environment variables → Edit → Add variable:**

| Key | Value |
|-----|-------|
| `S3_BUCKET_NAME` | `divineprinting-uploads` |
| `AWS_REGION` | `us-east-1` |
| `MAX_FILE_SIZE_BYTES` | `10485760` |
| `PRESIGNED_URL_EXPIRES_SECONDS` | `900` |
| `ALLOWED_ORIGIN` | `https://www.divineprinting.com` |

#### Set timeout

Lambda → **Configuration → General configuration → Edit:**
- **Timeout:** 10 seconds
- **Memory:** 256 MB

### Option B: AWS CLI (faster)

```bash
# Package
cd lambda/upload-url
npm install --production
zip -r upload-url.zip .

# Create
aws lambda create-function \
  --function-name divineprinting-upload-url \
  --runtime nodejs20.x \
  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/divineprinting-upload-lambda-role \
  --handler index.handler \
  --zip-file fileb://upload-url.zip \
  --timeout 10 \
  --memory-size 256 \
  --environment "Variables={S3_BUCKET_NAME=divineprinting-uploads,ALLOWED_ORIGIN=https://www.divineprinting.com}"

# Update code later:
aws lambda update-function-code \
  --function-name divineprinting-upload-url \
  --zip-file fileb://upload-url.zip
```

---

## Step 4: Create API Gateway

1. Go to **API Gateway → Create API**
2. Choose **HTTP API** (simpler, cheaper)
3. **API name:** `divineprinting-api`
4. Click **Next**

### Add route

- **Method:** POST
- **Resource path:** `/upload-url`
- **Integration:** Lambda → select `divineprinting-upload-url`

### Configure CORS

In API Gateway → your API → **CORS:**
- **Allow origins:** `https://www.divineprinting.com`
- **Allow methods:** `POST, OPTIONS`
- **Allow headers:** `Content-Type, X-Requested-With`

### Deploy

1. Click **Deploy** → **Stage:** `$default` (or create a `prod` stage)
2. Copy your **Invoke URL** — it looks like:
   ```
   https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com
   ```

Your endpoint will be:
```
https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/upload-url
```

---

## Step 5: Connect to the Frontend

1. Open `products/church-vinyl-banner.html` (or any quote form page)
2. Add before the closing `</body>`:

```html
<!-- File Upload Component -->
<script>
  window.UPLOAD_API_URL = 'https://YOUR_API_GATEWAY_URL/upload-url';
</script>
<script src="/js/file-upload.js"></script>
```

3. Add the upload zone inside the quote form:

```html
<!-- Inside your <form>, after the design field: -->
<div class="form-group">
  <label>Upload Your Artwork (optional)</label>
  <div id="file-upload-zone" data-dpu-auto data-dpu-api-url="https://YOUR_API_GATEWAY_URL/upload-url"></div>
  <input type="hidden" name="artwork_keys" id="artwork-keys-input"/>
</div>
```

4. On form submit, collect the uploaded file keys:

```javascript
// Add to your submitQuote function, before fetch:
const uploadedKeys = DivinePrintingUpload.getUploadedKeys();
formData.append('artwork_keys', uploadedKeys.join(', '));
```

---

## Step 6: View Uploaded Files

1. Go to **S3 → divineprinting-uploads**
2. Browse `uploads/YYYY-MM-DD/` folders
3. Click any file → **Download**

To set up automatic notifications when a file arrives:
- S3 → Bucket → **Properties → Event notifications → Create**
- Event type: `s3:ObjectCreated:*`
- Destination: Lambda or SNS email topic

---

## Test the API

```bash
# Get a presigned URL
curl -X POST https://YOUR_API_GATEWAY_URL/upload-url \
  -H "Content-Type: application/json" \
  -d '{"fileName":"test.pdf","fileType":"application/pdf","fileSize":500000}'

# Response:
# {
#   "ok": true,
#   "uploadUrl": "https://divineprinting-uploads.s3.amazonaws.com/",
#   "fields": { "key": "uploads/2026-04-13/uuid-test.pdf", ... },
#   "key": "uploads/2026-04-13/uuid-test.pdf",
#   "expiresIn": 900
# }
```

---

## Estimated AWS Cost

For a typical small business (< 1,000 uploads/month):

| Service | Usage | Cost |
|---------|-------|------|
| S3 storage | 10 GB/month | ~$0.23 |
| S3 PUT requests | 1,000/month | ~$0.005 |
| Lambda | 1,000 invocations, 256MB | Free tier |
| API Gateway | 1,000 calls/month | Free tier |
| **Total** | | **< $1/month** |

---

## Files Created

| File | Purpose |
|------|---------|
| `lambda/upload-url/index.js` | Lambda handler — generates presigned POST URLs |
| `lambda/upload-url/package.json` | Lambda dependencies |
| `js/file-upload.js` | Frontend dropzone UI component |
| `AWS-SETUP.md` | This file |

---

## Security Notes

- S3 bucket stays **private** — files are never publicly accessible
- Presigned URLs expire in **15 minutes** and allow only one file upload per URL
- File types validated on both frontend AND Lambda
- File size enforced at S3 level via presigned POST conditions (can't bypass)
- CORS restricted to `divineprinting.com` only
