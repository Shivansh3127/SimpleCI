/**
 * artifactService.ts — Level 5.2
 *
 * Uploads build artifacts to MinIO (S3-compatible object storage).
 * MinIO runs as a Docker container alongside the other services.
 *
 * Artifacts are tarred inside the pipeline container, extracted on the host,
 * then streamed to MinIO via the AWS S3 SDK (compatible with MinIO).
 *
 * Bucket: simpleci-artifacts
 * Key pattern: runs/<runId>/<filename>
 */
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';

export const s3 = new S3Client({
  endpoint:        process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
  region:          'us-east-1',  // MinIO ignores region but SDK requires it
  credentials: {
    accessKeyId:     process.env.MINIO_ACCESS_KEY     ?? 'simpleci',
    secretAccessKey: process.env.MINIO_SECRET_KEY     ?? 'simpleci123',
  },
  forcePathStyle: true, // required for MinIO
});

export const ARTIFACT_BUCKET = 'simpleci-artifacts';

/**
 * Upload a local file to MinIO.
 * Returns the S3 key (e.g. "runs/<runId>/<filename>").
 */
export async function uploadArtifact(
  runId:     string,
  localPath: string,
): Promise<string> {
  const filename = path.basename(localPath);
  const key      = `runs/${runId}/${filename}`;
  const body     = fs.createReadStream(localPath);

  await s3.send(new PutObjectCommand({
    Bucket:      ARTIFACT_BUCKET,
    Key:         key,
    Body:        body,
    ContentType: 'application/octet-stream',
  }));

  return key;
}

/**
 * Generate a pre-signed download URL valid for 1 hour.
 */
export async function getArtifactUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: ARTIFACT_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

/**
 * List all artifact keys for a run.
 */
export async function listArtifacts(runId: string): Promise<string[]> {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: ARTIFACT_BUCKET,
    Prefix: `runs/${runId}/`,
  }));
  return (res.Contents ?? []).map((obj) => obj.Key!).filter(Boolean);
}
