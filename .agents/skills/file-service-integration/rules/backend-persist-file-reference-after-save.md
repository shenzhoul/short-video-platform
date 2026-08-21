---
title: Persist File Reference After Save
impact: HIGH
impactDescription: Prevents orphaned uploads and keeps admin-managed files reusable across later edits
tags: backend, ownership, file-reference, persistence
---

## Persist File Reference After Save

After an upload URL is used, do not trust the `fileId` blindly when the form submits. Re-validate the file ownership/type, save the entity, then attach the file reference with `updateFileOwnership()` or `addRef()`.

**Why**: Upload URL generation and entity persistence are separate steps. The second step is where we confirm the file is still allowed for this user/admin flow and where we make the file discoverable from the saved record.

**Incorrect:**

```typescript
async updateThing(payload: { imageFileId?: string }) {
  return this.thingModel.create(payload);
}
```

**Correct:**

```typescript
async updateThing(payload: { imageFileId?: string }, adminId: string) {
  await this.fileDomainService.validateFiles(payload, adminId);
  const doc = await this.thingModel.create(payload);

  await this.fileDomainService.assignFilesToAdminEntity(
    [doc.imageFileId].filter(Boolean) as string[],
    { itemId: doc._id.toString(), itemType: 'thing' },
    adminId
  );

  return doc;
}
```
