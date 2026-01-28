/**
 * Object Storage client for SquirrelDB
 * Provides S3-compatible storage operations
 */

export interface StorageOptions {
  /** Storage server URL (default: http://localhost:9000) */
  endpoint: string;
  /** Access key ID for authentication */
  accessKeyId?: string;
  /** Secret access key for authentication */
  secretAccessKey?: string;
  /** Region (default: us-east-1) */
  region?: string;
}

export interface Bucket {
  name: string;
  creationDate: Date;
}

export interface StorageObject {
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
  contentType?: string;
}

export interface ListObjectsOptions {
  prefix?: string;
  delimiter?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface ListObjectsResult {
  objects: StorageObject[];
  commonPrefixes: string[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

export interface PutObjectOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface GetObjectResult {
  data: Uint8Array;
  contentType: string;
  etag: string;
  size: number;
  metadata: Record<string, string>;
}

export interface MultipartUpload {
  uploadId: string;
  bucket: string;
  key: string;
}

export interface UploadPart {
  partNumber: number;
  etag: string;
}

/**
 * Storage client for object storage operations
 */
export class Storage {
  private endpoint: string;
  private accessKeyId?: string;
  private secretAccessKey?: string;
  private region: string;

  constructor(options: StorageOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.region = options.region ?? "us-east-1";
  }

  /**
   * Create a new storage client
   */
  static connect(options: StorageOptions): Storage {
    return new Storage(options);
  }

  private async request(
    method: string,
    path: string,
    body?: Uint8Array | string,
    headers: Record<string, string> = {}
  ): Promise<Response> {
    const url = `${this.endpoint}${path}`;
    const reqHeaders: Record<string, string> = {
      ...headers,
    };

    // Add auth headers if credentials provided
    if (this.accessKeyId && this.secretAccessKey) {
      // Simplified auth - in production use AWS Signature V4
      reqHeaders["x-amz-access-key-id"] = this.accessKeyId;
    }

    const response = await fetch(url, {
      method,
      headers: reqHeaders,
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new StorageError(response.status, text);
    }

    return response;
  }

  // =========================================================================
  // Bucket Operations
  // =========================================================================

  /**
   * List all buckets
   */
  async listBuckets(): Promise<Bucket[]> {
    const response = await this.request("GET", "/");
    const xml = await response.text();
    return this.parseListBucketsResponse(xml);
  }

  /**
   * Create a new bucket
   */
  async createBucket(name: string): Promise<void> {
    await this.request("PUT", `/${name}`);
  }

  /**
   * Delete a bucket (must be empty)
   */
  async deleteBucket(name: string): Promise<void> {
    await this.request("DELETE", `/${name}`);
  }

  /**
   * Check if a bucket exists
   */
  async bucketExists(name: string): Promise<boolean> {
    try {
      await this.request("HEAD", `/${name}`);
      return true;
    } catch (e) {
      if (e instanceof StorageError && e.statusCode === 404) {
        return false;
      }
      throw e;
    }
  }

  // =========================================================================
  // Object Operations
  // =========================================================================

  /**
   * List objects in a bucket
   */
  async listObjects(bucket: string, options: ListObjectsOptions = {}): Promise<ListObjectsResult> {
    const params = new URLSearchParams();
    params.set("list-type", "2");
    if (options.prefix) params.set("prefix", options.prefix);
    if (options.delimiter) params.set("delimiter", options.delimiter);
    if (options.maxKeys) params.set("max-keys", options.maxKeys.toString());
    if (options.continuationToken) params.set("continuation-token", options.continuationToken);

    const response = await this.request("GET", `/${bucket}?${params}`);
    const xml = await response.text();
    return this.parseListObjectsResponse(xml);
  }

  /**
   * Get an object
   */
  async getObject(bucket: string, key: string): Promise<GetObjectResult> {
    const response = await this.request("GET", `/${bucket}/${encodeURIComponent(key)}`);
    const data = new Uint8Array(await response.arrayBuffer());

    return {
      data,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      etag: response.headers.get("etag")?.replace(/"/g, "") ?? "",
      size: data.length,
      metadata: this.extractMetadata(response.headers),
    };
  }

  /**
   * Get object as text
   */
  async getObjectText(bucket: string, key: string): Promise<string> {
    const result = await this.getObject(bucket, key);
    return new TextDecoder().decode(result.data);
  }

  /**
   * Get object as JSON
   */
  async getObjectJson<T = unknown>(bucket: string, key: string): Promise<T> {
    const text = await this.getObjectText(bucket, key);
    return JSON.parse(text);
  }

  /**
   * Put an object
   */
  async putObject(
    bucket: string,
    key: string,
    data: Uint8Array | string,
    options: PutObjectOptions = {}
  ): Promise<string> {
    const body = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const headers: Record<string, string> = {};

    if (options.contentType) {
      headers["content-type"] = options.contentType;
    } else if (typeof data === "string") {
      headers["content-type"] = "text/plain";
    }

    if (options.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        headers[`x-amz-meta-${k}`] = v;
      }
    }

    const response = await this.request("PUT", `/${bucket}/${encodeURIComponent(key)}`, body, headers);
    return response.headers.get("etag")?.replace(/"/g, "") ?? "";
  }

  /**
   * Put JSON object
   */
  async putObjectJson(
    bucket: string,
    key: string,
    data: unknown,
    options: Omit<PutObjectOptions, "contentType"> = {}
  ): Promise<string> {
    return this.putObject(bucket, key, JSON.stringify(data), {
      ...options,
      contentType: "application/json",
    });
  }

  /**
   * Delete an object
   */
  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.request("DELETE", `/${bucket}/${encodeURIComponent(key)}`);
  }

  /**
   * Check if an object exists
   */
  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.request("HEAD", `/${bucket}/${encodeURIComponent(key)}`);
      return true;
    } catch (e) {
      if (e instanceof StorageError && e.statusCode === 404) {
        return false;
      }
      throw e;
    }
  }

  /**
   * Copy an object
   */
  async copyObject(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string
  ): Promise<string> {
    const response = await this.request(
      "PUT",
      `/${destBucket}/${encodeURIComponent(destKey)}`,
      undefined,
      {
        "x-amz-copy-source": `/${sourceBucket}/${encodeURIComponent(sourceKey)}`,
      }
    );
    return response.headers.get("etag")?.replace(/"/g, "") ?? "";
  }

  // =========================================================================
  // Multipart Upload Operations
  // =========================================================================

  /**
   * Initiate a multipart upload
   */
  async createMultipartUpload(bucket: string, key: string): Promise<MultipartUpload> {
    const response = await this.request(
      "POST",
      `/${bucket}/${encodeURIComponent(key)}?uploads`
    );
    const xml = await response.text();
    const uploadId = this.extractXmlValue(xml, "UploadId");

    return {
      uploadId,
      bucket,
      key,
    };
  }

  /**
   * Upload a part
   */
  async uploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    data: Uint8Array
  ): Promise<UploadPart> {
    const response = await this.request(
      "PUT",
      `/${bucket}/${encodeURIComponent(key)}?partNumber=${partNumber}&uploadId=${uploadId}`,
      data
    );

    return {
      partNumber,
      etag: response.headers.get("etag")?.replace(/"/g, "") ?? "",
    };
  }

  /**
   * Complete a multipart upload
   */
  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: UploadPart[]
  ): Promise<string> {
    const body = this.buildCompleteMultipartXml(parts);
    const response = await this.request(
      "POST",
      `/${bucket}/${encodeURIComponent(key)}?uploadId=${uploadId}`,
      body,
      { "content-type": "application/xml" }
    );

    const xml = await response.text();
    return this.extractXmlValue(xml, "ETag").replace(/"/g, "");
  }

  /**
   * Abort a multipart upload
   */
  async abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/${bucket}/${encodeURIComponent(key)}?uploadId=${uploadId}`
    );
  }

  /**
   * Upload a large object using multipart upload
   * Automatically splits data into parts
   */
  async uploadLargeObject(
    bucket: string,
    key: string,
    data: Uint8Array,
    partSize = 5 * 1024 * 1024 // 5MB default
  ): Promise<string> {
    const upload = await this.createMultipartUpload(bucket, key);
    const parts: UploadPart[] = [];

    try {
      let partNumber = 1;
      for (let offset = 0; offset < data.length; offset += partSize) {
        const chunk = data.slice(offset, offset + partSize);
        const part = await this.uploadPart(bucket, key, upload.uploadId, partNumber, chunk);
        parts.push(part);
        partNumber++;
      }

      return await this.completeMultipartUpload(bucket, key, upload.uploadId, parts);
    } catch (e) {
      await this.abortMultipartUpload(bucket, key, upload.uploadId);
      throw e;
    }
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  private extractMetadata(headers: Headers): Record<string, string> {
    const metadata: Record<string, string> = {};
    headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("x-amz-meta-")) {
        metadata[key.slice(11)] = value;
      }
    });
    return metadata;
  }

  private extractXmlValue(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return match?.[1] ?? "";
  }

  private parseListBucketsResponse(xml: string): Bucket[] {
    const buckets: Bucket[] = [];
    const bucketMatches = xml.matchAll(/<Bucket>[\s\S]*?<Name>([^<]*)<\/Name>[\s\S]*?<CreationDate>([^<]*)<\/CreationDate>[\s\S]*?<\/Bucket>/g);

    for (const match of bucketMatches) {
      buckets.push({
        name: match[1],
        creationDate: new Date(match[2]),
      });
    }

    return buckets;
  }

  private parseListObjectsResponse(xml: string): ListObjectsResult {
    const objects: StorageObject[] = [];
    const commonPrefixes: string[] = [];

    // Parse objects
    const contentMatches = xml.matchAll(/<Contents>[\s\S]*?<Key>([^<]*)<\/Key>[\s\S]*?<Size>([^<]*)<\/Size>[\s\S]*?<ETag>([^<]*)<\/ETag>[\s\S]*?<LastModified>([^<]*)<\/LastModified>[\s\S]*?<\/Contents>/g);

    for (const match of contentMatches) {
      objects.push({
        key: match[1],
        size: parseInt(match[2], 10),
        etag: match[3].replace(/"/g, ""),
        lastModified: new Date(match[4]),
      });
    }

    // Parse common prefixes
    const prefixMatches = xml.matchAll(/<CommonPrefixes>[\s\S]*?<Prefix>([^<]*)<\/Prefix>[\s\S]*?<\/CommonPrefixes>/g);
    for (const match of prefixMatches) {
      commonPrefixes.push(match[1]);
    }

    // Parse pagination
    const isTruncated = xml.includes("<IsTruncated>true</IsTruncated>");
    const nextToken = this.extractXmlValue(xml, "NextContinuationToken");

    return {
      objects,
      commonPrefixes,
      isTruncated,
      nextContinuationToken: nextToken || undefined,
    };
  }

  private buildCompleteMultipartXml(parts: UploadPart[]): string {
    const partXml = parts
      .map(p => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${p.etag}"</ETag></Part>`)
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${partXml}</CompleteMultipartUpload>`;
  }
}

/**
 * Storage error with status code
 */
export class StorageError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * Convenience function to create a storage client
 */
export function connectStorage(options: StorageOptions): Storage {
  return Storage.connect(options);
}
