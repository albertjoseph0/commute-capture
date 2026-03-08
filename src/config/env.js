const required = ['DATABASE_URL', 'S3_BUCKET', 'MINIO_ENDPOINT', 'MINIO_PUBLIC_ENDPOINT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  s3: {
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET,
    endpoint: process.env.MINIO_ENDPOINT,
    publicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT,
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
    presignTtl: parseInt(process.env.PRESIGN_TTL_SECONDS || '120', 10),
  },
};
