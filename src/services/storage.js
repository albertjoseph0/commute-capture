import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';

// Client for actual S3 operations (uses internal Docker endpoint)
const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
});

// Client for presigning (uses public endpoint so URLs work from outside Docker)
const presignClient = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.publicEndpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
});

export async function createPresignedUpload({ commuteId, promptId, contentType }) {
  const hex = randomUUID().replace(/-/g, '');
  const objectKey = `commutes/${commuteId}/${promptId}-${hex}.wav`;
  const objectUrl = `${config.s3.publicEndpoint}/${config.s3.bucket}/${objectKey}`;

  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: objectKey,
    ContentType: contentType || 'audio/wav',
  });

  const uploadUrl = await getSignedUrl(presignClient, command, {
    expiresIn: config.s3.presignTtl,
  });

  return {
    upload_url: uploadUrl,
    object_url: objectUrl,
    object_key: objectKey,
    expires_in: config.s3.presignTtl,
  };
}
