# Divine Printing — S3 Webhook Setup Instructions

This guide walks you through setting up the Snipcart webhook → S3 → Email notification system.

## Architecture Overview

```
Customer places order (Snipcart)
    ↓
Snipcart webhook POSTs to API Gateway
    ↓
Lambda function receives order + design data
    ↓
Saves images to S3 bucket
    ↓
Sends email notification with download links
```

## Prerequisites

- AWS Account
- Snipcart account with API access
- Node.js 18+ (for local testing)

## Step 1: Create S3 Bucket

1. Go to AWS Console → S3 → Create bucket
2. **Bucket name**: `divineprinting-designs` (or your preferred name)
3. **Region**: Choose same region as your Lambda (e.g., `us-east-1`)
4. **Block Public Access**: Keep BLOCKED (we'll use presigned URLs)
5. Enable versioning (optional but recommended)
6. Create bucket

### S3 Bucket Policy (for Lambda access)

Go to bucket → Permissions → Bucket Policy, add:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LambdaAccess",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::YOUR_ACCOUNT_ID:role/divineprinting-lambda-role"
      },
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::divineprinting-designs/*"
    }
  ]
}
```

## Step 2: Create IAM Role for Lambda

1. Go to IAM → Roles → Create role
2. **Trusted entity**: AWS Service → Lambda
3. **Permissions**:
   - `AmazonS3FullAccess` (or create custom policy with just PutObject)
   - `AmazonSNSFullAccess` (for email notifications)
   - `CloudWatchLogsFullAccess` (for logging)
4. **Role name**: `divineprinting-lambda-role`

### Custom IAM Policy (more secure)

Instead of full access, create this custom policy:

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
      "Resource": "arn:aws:s3:::divineprinting-designs/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sns:Publish"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

## Step 3: Deploy Lambda Function

### Option A: AWS Console (Manual)

1. Go to Lambda → Create function
2. **Function name**: `divineprinting-save-design`
3. **Runtime**: Node.js 18.x
4. **Architecture**: x86_64
5. **Execution role**: Use existing role → `divineprinting-lambda-role`
6. Create function

7. Copy the code from `lambda/save-design/index.js` into the code editor

8. **Environment variables** (Configuration → Environment variables):
   ```
   S3_BUCKET_NAME=divineprinting-designs
   AWS_REGION=us-east-1
   EMAIL_TO=chris@gardedev.com
   ```

9. **Deploy** the function

### Option B: AWS CLI (Automated)

```bash
# Install dependencies
cd lambda/save-design
npm install

# Create deployment package
zip -r function.zip index.js node_modules package.json

# Create Lambda function
aws lambda create-function \
  --function-name divineprinting-save-design \
  --runtime nodejs18.x \
  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/divineprinting-lambda-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --environment Variables='{S3_BUCKET_NAME=divineprinting-designs,EMAIL_TO=chris@gardedev.com}' \
  --region us-east-1

# Update function (after code changes)
aws lambda update-function-code \
  --function-name divineprinting-save-design \
  --zip-file fileb://function.zip
```

## Step 4: Create API Gateway

1. Go to API Gateway → Create API → REST API
2. **API name**: `divineprinting-webhook-api`
3. Create API

4. Create resource:
   - Actions → Create Resource
   - **Resource name**: `save-design`
   - **Resource path**: `/save-design`
   - Create Resource

5. Create method:
   - Select `/save-design` → Actions → Create Method → POST
   - **Integration type**: Lambda Function
   - **Lambda region**: us-east-1
   - **Lambda function**: `divineprinting-save-design`
   - Save

6. Enable CORS:
   - Select POST method → Actions → Enable CORS
   - **Access-Control-Allow-Origin**: `https://divineprinting.com`
   - Enable CORS and replace existing CORS headers

7. Deploy API:
   - Actions → Deploy API
   - **Deployment stage**: [New Stage]
   - **Stage name**: `prod`
   - Deploy

8. **Copy the Invoke URL** (e.g., `https://abc123.execute-api.us-east-1.amazonaws.com/prod`)

## Step 5: Update Frontend Code

1. Open `products/tshirt-configurator.js`
2. Find this line:
   ```javascript
   const WEBHOOK_ENDPOINT = 'https://YOUR_API_GATEWAY_URL/save-design';
   ```
3. Replace with your actual API Gateway URL:
   ```javascript
   const WEBHOOK_ENDPOINT = 'https://abc123.execute-api.us-east-1.amazonaws.com/prod/save-design';
   ```
4. Deploy the updated code to your site

## Step 6: Configure Snipcart Webhook (Optional)

If you want Snipcart to also call your webhook directly:

1. Go to Snipcart Dashboard → Webhooks
2. Add webhook:
   - **URL**: `https://abc123.execute-api.us-east-1.amazonaws.com/prod/save-design`
   - **Events**: `order.completed`
   - **Secret**: Generate a secret and add to Lambda env vars as `SNIPCART_SECRET`

**Note**: The frontend already sends the design data, so this is optional. But it provides redundancy.

## Step 7: Set Up Email Notifications (SNS)

### Option A: SNS Topic (Recommended)

1. Go to SNS → Topics → Create topic
2. **Type**: Standard
3. **Name**: `divineprinting-order-notifications`
4. Create topic

5. Create subscription:
   - **Protocol**: Email
   - **Endpoint**: chris@gardedev.com
   - Create subscription

6. Check your email and confirm the subscription

7. Copy the **Topic ARN** (e.g., `arn:aws:sns:us-east-1:123456789:divineprinting-order-notifications`)

8. Add to Lambda environment variables:
   ```
   SNS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789:divineprinting-order-notifications
   ```

### Option B: Simple Email (No SNS)

Just set `EMAIL_TO` in Lambda environment variables. The Lambda will log the email content to CloudWatch (you can set up SES later for actual sending).

## Step 8: Test the Setup

1. Go to your t-shirt configurator page
2. Create a design
3. Add to cart and checkout (use Snipcart test mode)
4. Complete the order
5. Check:
   - S3 bucket for new files in `orders/YYYY-MM-DD/` folder
   - CloudWatch Logs for Lambda execution
   - Your email for notification

## File Structure in S3

```
orders/
  2024-01-15/
    INV-12345/
      preview.png          (400x400 preview)
      printable.png        (3600x3600 print-ready)
      design-info.json     (metadata)
```

## Troubleshooting

### Lambda timeout errors
- Increase timeout to 30 seconds (Configuration → General configuration)

### S3 permission errors
- Check IAM role has `s3:PutObject` permission
- Check bucket policy allows the Lambda role

### API Gateway 500 errors
- Check CloudWatch Logs for Lambda errors
- Verify request body format matches expected schema

### Design data not sending
- Check browser console for JavaScript errors
- Verify `WEBHOOK_ENDPOINT` URL is correct
- Check Network tab for failed requests

## Cost Estimate

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| S3 Storage | 100 designs × 5MB | ~$0.02 |
| S3 Requests | 100 PUT requests | ~$0.01 |
| Lambda | 100 invocations | Free tier |
| API Gateway | 100 requests | Free tier |
| SNS | 100 emails | ~$0.50 |
| **Total** | | **~$0.50/month** |

## Next Steps

1. Deploy the Lambda function
2. Create API Gateway
3. Update the frontend with your API URL
4. Test with a sample order
5. Set up email notifications

## Support

- AWS Lambda docs: https://docs.aws.amazon.com/lambda/
- Snipcart webhooks: https://docs.snipcart.com/v3/webhooks/introduction
- S3 pricing: https://aws.amazon.com/s3/pricing/
