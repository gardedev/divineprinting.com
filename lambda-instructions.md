# AWS Lambda Setup for Divine Printing Order Notifications

## Overview
This Lambda function receives Snipcart webhooks when orders are placed, saves order data to S3, and emails you the order details.

## Architecture
```
Snipcart Order → Webhook → API Gateway → Lambda → S3 + Email Notification
```

---

## Step 1: Create the S3 Bucket

1. Go to AWS Console → S3 → Create Bucket
2. **Bucket name:** `divineprinting-orders`
3. **Region:** Same as your Amplify app (us-east-1 recommended)
4. **Block Public Access:** Keep all checked (private bucket)
5. **Versioning:** Optional but recommended
6. Click **Create bucket**

---

## Step 2: Create the Lambda Function

1. Go to AWS Console → Lambda → Create Function
2. **Function name:** `divineprinting-order-handler`
3. **Runtime:** Python 3.11
4. **Architecture:** x86_64
5. Click **Create function**

### Lambda Code (index.py)

```python
import json
import boto3
import os
from datetime import datetime
from botocore.exceptions import ClientError

# Initialize AWS clients
s3 = boto3.client('s3')
ses = boto3.client('ses', region_name='us-east-1')

# Config
BUCKET_NAME = os.environ.get('S3_BUCKET', 'divineprinting-orders')
EMAIL_TO = os.environ.get('EMAIL_TO', 'chris@gardedev.com')
EMAIL_FROM = os.environ.get('EMAIL_FROM', 'orders@divineprinting.com')

def lambda_handler(event, context):
    """
    Handle Snipcart webhook for new orders
    """
    try:
        # Parse webhook payload
        body = json.loads(event.get('body', '{}'))
        
        # Snipcart sends different event types - we want 'order.completed'
        event_name = body.get('eventName', '')
        
        if event_name != 'order.completed':
            return {
                'statusCode': 200,
                'body': json.dumps({'message': f'Ignored event: {event_name}'})
            }
        
        # Extract order data
        order = body.get('content', {})
        order_id = order.get('invoiceNumber', order.get('token', 'unknown'))
        
        # Save to S3
        timestamp = datetime.utcnow().strftime('%Y-%m-%d_%H-%M-%S')
        s3_key = f"orders/{timestamp}_{order_id}.json"
        
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=json.dumps(body, indent=2),
            ContentType='application/json'
        )
        
        # Send email notification
        send_order_email(order, s3_key)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Order processed successfully',
                'orderId': order_id,
                's3Key': s3_key
            })
        }
        
    except Exception as e:
        print(f"Error processing order: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

def send_order_email(order, s3_key):
    """
    Send email notification for new order
    """
    order_id = order.get('invoiceNumber', order.get('token', 'N/A'))
    customer = order.get('user', {})
    items = order.get('items', [])
    
    # Build email content
    customer_email = customer.get('email', 'N/A')
    customer_name = f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip() or 'N/A'
    total = order.get('total', 0)
    currency = order.get('currency', 'USD')
    
    # Build items list
    items_html = ""
    for item in items:
        items_html += f"""
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">{item.get('name', 'N/A')}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">{item.get('quantity', 0)}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.get('total', 0):.2f}</td>
        </tr>
        """
    
    subject = f"🛒 New Divine Printing Order: {order_id}"
    
    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #3d1a6e;">New Order Received!</h2>
        
        <table style="width: 100%; max-width: 600px; border-collapse: collapse;">
            <tr>
                <td style="padding: 8px; font-weight: bold;">Order ID:</td>
                <td style="padding: 8px;">{order_id}</td>
            </tr>
            <tr>
                <td style="padding: 8px; font-weight: bold;">Customer:</td>
                <td style="padding: 8px;">{customer_name}</td>
            </tr>
            <tr>
                <td style="padding: 8px; font-weight: bold;">Email:</td>
                <td style="padding: 8px;">{customer_email}</td>
            </tr>
            <tr>
                <td style="padding: 8px; font-weight: bold;">Total:</td>
                <td style="padding: 8px; font-size: 1.2em; color: #c9a227;">${total:.2f} {currency}</td>
            </tr>
        </table>
        
        <h3 style="color: #3d1a6e; margin-top: 24px;">Order Items</h3>
        <table style="width: 100%; max-width: 600px; border-collapse: collapse;">
            <thead>
                <tr style="background-color: #f5f5f5;">
                    <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Product</th>
                    <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Qty</th>
                    <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Total</th>
                </tr>
            </thead>
            <tbody>
                {items_html}
            </tbody>
        </table>
        
        <p style="margin-top: 24px; padding: 12px; background-color: #f9f9f9; border-left: 4px solid #3d1a6e;">
            <strong>S3 Location:</strong> {s3_key}<br>
            <strong>Bucket:</strong> {BUCKET_NAME}
        </p>
        
        <p style="margin-top: 24px; font-size: 0.9em; color: #666;">
            Full order details saved to S3. Log into AWS Console to download the complete JSON.
        </p>
    </body>
    </html>
    """
    
    text_body = f"""
New Divine Printing Order

Order ID: {order_id}
Customer: {customer_name}
Email: {customer_email}
Total: ${total:.2f} {currency}

Items:
{chr(10).join([f"- {item.get('name', 'N/A')} x{item.get('quantity', 0)} = ${item.get('total', 0):.2f}" for item in items])}

S3 Location: {s3_key}
Bucket: {BUCKET_NAME}
"""
    
    try:
        response = ses.send_email(
            Source=EMAIL_FROM,
            Destination={'ToAddresses': [EMAIL_TO]},
            Message={
                'Subject': {'Data': subject},
                'Body': {
                    'Html': {'Data': html_body},
                    'Text': {'Data': text_body}
                }
            }
        )
        print(f"Email sent! Message ID: {response['MessageId']}")
    except ClientError as e:
        print(f"Error sending email: {e}")
        raise
```

---

## Step 3: Configure Lambda Environment Variables

In the Lambda console, go to **Configuration → Environment variables** and add:

| Key | Value |
|-----|-------|
| `S3_BUCKET` | `divineprinting-orders` |
| `EMAIL_TO` | `chris@gardedev.com` |
| `EMAIL_FROM` | `orders@divineprinting.com` |

---

## Step 4: Set Lambda Permissions (IAM Role)

The Lambda needs permission to write to S3 and send SES emails.

1. Go to Lambda → Configuration → Permissions
2. Click the **Role name** (opens IAM console)
3. Click **Add permissions → Create inline policy**
4. Switch to **JSON** tab and paste:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject"
            ],
            "Resource": "arn:aws:s3:::divineprinting-orders/orders/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "ses:SendEmail",
                "ses:SendRawEmail"
            ],
            "Resource": "*"
        }
    ]
}
```

5. Click **Review policy**
6. **Policy name:** `DivinePrintingLambdaPolicy`
7. Click **Create policy**

---

## Step 5: Verify SES Email Address

AWS SES requires verified sender addresses in sandbox mode.

1. Go to AWS Console → SES → Verified identities
2. Click **Create identity**
3. Select **Email address**
4. Enter: `orders@divineprinting.com`
5. Click **Create identity**
6. Check your email and click the verification link

**Note:** In sandbox mode, you can only send TO verified addresses. To send to any email, request SES production access.

---

## Step 6: Create API Gateway

1. Go to AWS Console → API Gateway → Create API
2. Choose **REST API** (not HTTP API) → Build
3. **API name:** `divineprinting-webhooks`
4. Click **Create API**

### Create Resource and Method

1. Click **Actions → Create Resource**
2. **Resource Name:** `webhook`
3. **Resource Path:** `webhook`
4. Click **Create Resource**

5. With `/webhook` selected, click **Actions → Create Method**
6. Select **POST** → click checkmark
7. **Integration type:** Lambda Function
8. **Lambda Region:** Same as your function
9. **Lambda Function:** `divineprinting-order-handler`
10. Click **Save** and **OK** to grant permission

### Deploy API

1. Click **Actions → Deploy API**
2. **Deployment stage:** [New Stage]
3. **Stage name:** `prod`
4. Click **Deploy**

### Get Webhook URL

After deployment, you'll see the **Invoke URL**:
```
https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/webhook
```

**Copy this URL** — you'll need it for Snipcart.

---

## Step 7: Configure Snipcart Webhook

1. Log into Snipcart Dashboard → Account → Webhooks
2. Click **Add webhook**
3. **URL:** Paste your API Gateway URL
4. **Events:** Select `order.completed`
5. Click **Save**

### Test the Webhook

1. In Snipcart Dashboard → Webhooks, find your webhook
2. Click **Send test request**
3. Check CloudWatch Logs (Lambda → Monitor → View CloudWatch logs)
4. Verify:
   - Lambda executed without errors
   - File appeared in S3 bucket
   - Email was sent

---

## Step 8: Test End-to-End

1. Place a test order on divineprinting.com
2. Wait for webhook to fire (usually within seconds)
3. Check:
   - S3 bucket for new JSON file
   - Your email for order notification
   - CloudWatch logs for any errors

---

## Cost Estimate

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| Lambda | 100 orders/month | ~$0 (free tier) |
| API Gateway | 100 requests | ~$0.35 |
| S3 | 500MB storage | ~$0.01 |
| SES | 100 emails | ~$0 (first 62k free) |
| **Total** | | **~$0.36/month** |

---

## Troubleshooting

### Lambda timeout errors
- Increase timeout to 10 seconds in Lambda → Configuration → General configuration

### S3 permission denied
- Verify IAM policy has correct bucket ARN
- Check bucket name matches environment variable

### Email not sending
- Verify `orders@divineprinting.com` in SES
- If in sandbox, `EMAIL_TO` must also be verified
- Check CloudWatch logs for SES errors

### Webhook not firing
- Verify Snipcart webhook URL is correct
- Check API Gateway stage is deployed
- Test with Snipcart's "Send test request" button

---

## Next Steps (Optional Enhancements)

1. **Add design file uploads** - Modify Lambda to handle file uploads from your t-shirt configurator
2. **Slack notifications** - Add Slack webhook for real-time order alerts
3. **Order dashboard** - Build admin page to view/download orders from S3
4. **Auto-fulfillment** - Integrate with Printful API for automatic printing/shipping

---

## Files to Save

Save this Lambda code to your repo:
```
divineprinting/
├── lambda/
│   └── order_handler.py      # This Lambda function
│   └── requirements.txt      # Empty (boto3 is built-in)
│   └── README.md             # This file
```
