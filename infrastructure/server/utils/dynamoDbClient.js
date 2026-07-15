// utils/dynamoDbClient.js
// Reusable DynamoDB DocumentClient for all server modules.
// On Lightsail: uses attached IAM role automatically.
// Locally: uses AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION env vars.

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    // Automatically convert empty strings, blobs, and sets to null.
    convertEmptyValues: false,
    // Remove undefined values while marshalling.
    removeUndefinedValues: true,
    // Convert typeof object to map attribute.
    convertClassInstanceToMap: false,
  },
  unmarshallOptions: {
    // Return numbers as native JS numbers rather than BigInt.
    wrapNumbers: false,
  },
});

module.exports = { docClient };
