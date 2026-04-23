/**
 * Divine Printing — List Designs from S3
 * Lambda function for admin dashboard
 * 
 * Endpoint: GET /list-designs
 * Returns: List of all designs in S3 with presigned URLs
 */

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const URL_EXPIRES = 3600; // 1 hour

const s3 = new S3Client({ region: AWS_REGION });

exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event));
  
  try {
    // Only allow GET requests
    if (event.httpMethod !== 'GET') {
      return respond(405, { error: 'Method not allowed' });
    }
    
    // Optional: date filter from query string
    const datePrefix = event.queryStringParameters?.date || '';
    const prefix = datePrefix ? `orders/${datePrefix}/` : 'orders/';
    
    // List objects in S3
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
    });
    
    const listResponse = await s3.send(listCommand);
    
    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      return respond(200, { designs: [], count: 0 });
    }
    
    // Group files by order
    const orders = {};
    
    for (const item of listResponse.Contents) {
      const key = item.Key;
      const parts = key.split('/');
      
      if (parts.length < 3) continue;
      
      const date = parts[1];
      const orderId = parts[2];
      const fileName = parts[3];
      
      if (!orders[orderId]) {
        orders[orderId] = {
          orderId,
          date,
          files: {},
          metadata: null,
        };
      }
      
      // Generate presigned URL for download
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });
      
      const url = await getSignedUrl(s3, getCommand, { expiresIn: URL_EXPIRES });
      
      if (fileName === 'design-info.json') {
        // Fetch and parse metadata
        try {
          const metadataResponse = await s3.send(new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
          }));
          const metadataBody = await metadataResponse.Body.transformToString();
          orders[orderId].metadata = JSON.parse(metadataBody);
        } catch (e) {
          console.error('Failed to parse metadata for', orderId, e);
        }
      } else if (fileName === 'preview.png') {
        orders[orderId].files.preview = url;
      } else if (fileName === 'printable.png') {
        orders[orderId].files.printable = url;
      }
    }
    
    // Convert to array and sort by date (newest first)
    const designs = Object.values(orders).sort((a, b) => {
      return new Date(b.metadata?.timestamp || 0) - new Date(a.metadata?.timestamp || 0);
    });
    
    return respond(200, {
      designs,
      count: designs.length,
      expiresIn: URL_EXPIRES,
    });
    
  } catch (error) {
    console.error('Error listing designs:', error);
    return respond(500, { error: 'Internal server error', message: error.message });
  }
};

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
