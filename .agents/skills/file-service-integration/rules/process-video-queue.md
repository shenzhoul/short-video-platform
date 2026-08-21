---
title: Always Queue Video Processing
impact: CRITICAL
impactDescription: Prevents timeouts and server overload
tags: processing, video, performance, async
---

## Always Queue Video Processing

Always set `immediateProcess: false` for video uploads - videos must be processed in background queues.

**Why**: Video processing is CPU-intensive and time-consuming. Immediate processing will cause timeouts and server overload.

**Incorrect (immediate video processing):**

```typescript
async badVideoUpload() {
  return this.fileServerService.generateVideoUploadUrl({
    mediaType: 'video',
    processingOptions: {
      immediateProcess: true // WRONG! Will timeout
    }
  });
}
```

**Correct (queue video processing with webhook):**

```typescript
async uploadVideo() {
  return this.fileServerService.generateVideoUploadUrl({
    mediaType: 'video',
    type: 'content',
    processingOptions: {
      immediateProcess: false, // ✅ Always false for videos
      generateThumbnail: true,
      generatePreview: true,
      videoFormat: 'mp4',
      quality: 80,
      webhookUrl: `${process.env.WEBHOOK_BASE_URL}/webhooks/video-processed`
    }
  });
}

// Handle webhook notification
@Post('/webhooks/video-processed')
async handleVideoProcessed(@Body() payload: WebhookPayload) {
  if (payload.status === 'completed') {
    // Video is ready, update database
    await this.videoService.updateProcessingStatus(
      payload.fileId,
      'completed',
      payload.processedFiles
    );

    // Notify user
    await this.notificationService.notifyUser(
      payload.metadata.uploadedBy,
      'Your video has been processed and is now available'
    );
  } else if (payload.status === 'failed') {
    // Handle processing failure
    await this.videoService.handleProcessingError(
      payload.fileId,
      payload.error
    );
  }
}
```
