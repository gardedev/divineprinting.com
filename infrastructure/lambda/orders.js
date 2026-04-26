// Get orders for a customer
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const ORDERS_TABLE = process.env.ORDERS_TABLE || 'divine-printing-orders';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Get email from query params
    const email = event.queryStringParameters?.email?.toLowerCase();
    
    if (!email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email required' }) };
    }

    // Query orders for this customer
    const result = await docClient.send(new QueryCommand({
      TableName: ORDERS_TABLE,
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email,
      },
      ScanIndexForward: false, // Newest first
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        orders: result.Items || [],
        count: result.Count || 0,
      }),
    };

  } catch (error) {
    console.error('Error fetching orders:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
