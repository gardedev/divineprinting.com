#!/bin/bash
# Deploy script for Divine Printing S3 webhook Lambda

set -e

# Configuration - UPDATE THESE VALUES
FUNCTION_NAME="divineprinting-save-design"
AWS_REGION="us-east-1"
S3_BUCKET="divineprinting-designs"
EMAIL_TO="chris@gardedev.com"
# Optional: SNS_TOPIC_ARN="arn:aws:sns:us-east-1:123456789:divineprinting-order-notifications"

echo "🚀 Deploying Divine Printing S3 Webhook Lambda..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install it first:"
    echo "   https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
    exit 1
fi

# Check if logged in
aws sts get-caller-identity > /dev/null 2>&1 || {
    echo "❌ Not logged into AWS. Run: aws configure"
    exit 1
}

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "✓ AWS Account: $ACCOUNT_ID"

# Install dependencies
echo "📦 Installing dependencies..."
cd save-design
npm install --production

# Create deployment package
echo "📦 Creating deployment package..."
rm -f function.zip
zip -r function.zip index.js node_modules package.json

# Check if function exists
if aws lambda get-function --function-name $FUNCTION_NAME --region $AWS_REGION > /dev/null 2>&1; then
    echo "🔄 Updating existing Lambda function..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://function.zip \
        --region $AWS_REGION
    
    echo "🔄 Updating environment variables..."
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --environment Variables="{S3_BUCKET_NAME=$S3_BUCKET,EMAIL_TO=$EMAIL_TO,AWS_REGION=$AWS_REGION}" \
        --region $AWS_REGION
else
    echo "❌ Lambda function not found. Please create it first via AWS Console."
    echo "   See SETUP.md for instructions."
    exit 1
fi

echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Create API Gateway endpoint (see SETUP.md)"
echo "2. Update WEBHOOK_ENDPOINT in tshirt-configurator.js"
echo "3. Test with a sample order"
