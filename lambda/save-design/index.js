/**
 * Divine Printing — Save Order Design to S3
 * Lambda function triggered by Snipcart webhook
 * 
 * Endpoint: POST /save-design (via API Gateway)
 * Trigger: Snipcart order.completed webhook
 * 
 * Environment Variables:
 *   S3_BUCKET_NAME - S3 bucket for storing designs
 *   SNS_TOPIC_ARN - SNS topic for email notifications (optional)
 *   EMAIL_TO - Email address for notifications
 *   SNIPCART_SECRET - Webhook secret for validation
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const EMAIL_TO = process.env.EMAIL_TO;
const SNIPCART_SECRET = process.env.SNIPCART_SECRET;

const s3 = new S3Client({ region: AWS_REGION });
const sns = SNS_TOPIC_ARN ? new SNSClient({ region: AWS_REGION }) : null;

exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  try {
    // Parse the webhook payload
    const body = JSON.parse(event.body);
    const { eventName, content } = body;
    
    // Only process order.completed events
    if (eventName !== 'order.completed') {
      return respond(200, { message: 'Event ignored', eventName });
    }
    
    const order = content;
    const orderToken = order.token;
    const orderId = order.invoiceNumber || orderToken;
    
    // Extract custom fields from Snipcart order
    const customFields = order.customFields || {};
    const metadata = order.metadata || {};
    
    // Check if this is a t-shirt order with design data
    const designData = metadata.designData || customFields.designData;
    
    if (!designData) {
      console.log('No design data found for order:', orderToken);
      return respond(200, { message: 'No design data', orderToken });
    }
    
    // Parse design data (sent as JSON string or object)
    let design;
    try {
      design = typeof designData === 'string' ? JSON.parse(designData) : designData;
    } catch (e) {
      console.error('Failed to parse design data:', e);
      return respond(400, { error: 'Invalid design data format' });
    }
    
    const timestamp = new Date().toISOString();
    const datePrefix = timestamp.split('T')[0]; // YYYY-MM-DD
    
    // Prepare S3 keys
    const baseKey = `orders/${datePrefix}/${orderId}`;
    const files = [];
    
    // Save preview image (low-res)
    if (design.previewImage) {
      const previewKey = `${baseKey}/preview.png`;
      await saveBase64ImageToS3(design.previewImage, previewKey, 'image/png');
      files.push({ key: previewKey, type: 'preview', url: `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${previewKey}` });
    }
    
    // Save printable image (high-res)
    if (design.printableImage) {
      const printableKey = `${baseKey}/printable.png`;
      await saveBase64ImageToS3(design.printableImage, printableKey, 'image/png');
      files.push({ key: printableKey, type: 'printable', url: `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${printableKey}` });
    }
    
    // Save design metadata as JSON
    const metadataKey = `${baseKey}/design-info.json`;
    const metadataContent = {
      orderToken,
      orderId,
      timestamp,
      customer: {
        email: order.email,
        name: `${order.billingAddress?.firstName || ''} ${order.billingAddress?.lastName || ''}`.trim(),
        church: order.billingAddress?.company || '',
      },
      design: {
        designName: design.designInfo?.design || 'Custom Upload',
        shirtColor: design.designInfo?.color || 'Unknown',
        text: design.designInfo?.texts || 'None',
        position: design.designInfo?.position || 'center',
        size: design.designInfo?.size || 'L',
        quantity: design.designInfo?.quantity || '1',
      },
      files: files.map(f => ({ type: f.type, url: f.url, key: f.key })),
    };
    
    await saveJsonToS3(metadataContent, metadataKey);
    files.push({ key: metadataKey, type: 'metadata', url: `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${metadataKey}` });
    
    // Send email notification
    if (EMAIL_TO || SNS_TOPIC_ARN) {
      await sendNotification(metadataContent);
    }
    
    console.log('Design saved successfully for order:', orderToken);
    
    return respond(200, {
      success: true,
      orderToken,
      orderId,
      filesSaved: files.length,
      files: files.map(f => ({ type: f.type, url: f.url })),
    });
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    return respond(500, { error: 'Internal server error', message: error.message });
  }
};

// Helper: Save base64 image to S3
async function saveBase64ImageToS3(base64Data, key, contentType) {
  // Remove data URL prefix if present
  const base64String = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64String, 'base64');
  
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    Metadata: {
      'upload-date': new Date().toISOString(),
    },
  });
  
  await s3.send(command);
  console.log(`Saved ${key} (${buffer.length} bytes)`);
}

// Helper: Save JSON to S3
async function saveJsonToS3(data, key) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  });
  
  await s3.send(command);
  console.log(`Saved ${key}`);
}

// Helper: Send email notification
async function sendNotification(orderData) {
  const subject = `🎨 New T-Shirt Design Order #${orderData.orderId}`;
  
  const message = `
New custom t-shirt order received!

Order Details:
- Order ID: ${orderData.orderId}
- Order Token: ${orderData.orderToken}
- Date: ${orderData.timestamp}

Customer:
- Name: ${orderData.customer.name || 'N/A'}
- Email: ${orderData.customer.email}
- Church: ${orderData.customer.church || 'N/A'}

Design:
- Design: ${orderData.design.designName}
- Shirt Color: ${orderData.design.shirtColor}
- Text: ${orderData.design.text}
- Position: ${orderData.design.position}
- Size: ${orderData.design.size}
- Quantity: ${orderData.design.quantity}

Files:
${orderData.files.map(f => `- ${f.type}: ${f.url}`).join('\n')}

---
Divine Printing Order System
`;

  try {
    if (SNS_TOPIC_ARN) {
      // Send via SNS
      const command = new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: subject,
        Message: message,
      });
      await sns.send(command);
      console.log('SNS notification sent');
    } else if (EMAIL_TO) {
      // You can integrate with SES here if needed
      console.log('Email would be sent to:', EMAIL_TO);
      console.log('Subject:', subject);
      console.log('Message:', message);
    }
  } catch (error) {
    console.error('Failed to send notification:', error);
    // Don't fail the webhook if notification fails
  }
}

// Helper: HTTP response
function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
