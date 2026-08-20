const mongoose = require('mongoose');

/**
 * Create the direct-message collections and their indexes explicitly.
 *
 * The application declares the same indexes on its schemas, so a development
 * database with Mongoose `autoIndex` enabled would eventually get them anyway.
 * This migration exists so a deployment does not *depend* on that:
 *
 *  - `autoIndex` is commonly disabled in production, and the two unique indexes
 *    here are correctness constraints, not optimisations. Without
 *    `uniq_hashKey` two concurrent "start a chat" requests create duplicate
 *    conversations for the same pair; without `uniq_conversationId_userId` two
 *    concurrent unread increments can split one person's count across two rows.
 *  - Building them at migration time surfaces a failure during deploy rather
 *    than at first write.
 *
 * Purely additive and idempotent: `createIndex` is a no-op when an identical
 * index already exists, and `createCollection` is guarded. No data is read,
 * written or removed, so it is safe on a populated database and safe to re-run.
 * A brand-new database needs nothing beyond this.
 */

const INDEXES = {
  conversations: [
    [{ hashKey: 1 }, { name: 'uniq_hashKey', unique: true }],
    [
      { recipientIds: 1, lastMessageCreatedAt: -1, _id: -1 },
      { name: 'idx_recipientIds_lastMessageCreatedAt_id_desc' }
    ]
  ],
  conversation_participants: [
    [{ conversationId: 1, userId: 1 }, { name: 'uniq_conversationId_userId', unique: true }],
    [{ userId: 1, lastMessageAt: -1, _id: -1 }, { name: 'idx_userId_lastMessageAt_id_desc' }],
    [{ userId: 1, unreadCount: 1 }, { name: 'idx_userId_unreadCount' }]
  ],
  messages: [
    [
      { conversationId: 1, createdAt: -1, _id: -1 },
      { name: 'idx_conversationId_createdAt_id_desc' }
    ],
    [{ fileIds: 1 }, { name: 'idx_fileIds' }]
  ]
};

module.exports.up = async function up(next) {
  try {
    const db = mongoose.connection.db;
    const existing = (await db.listCollections().toArray()).map((item) => item.name);
    const created = [];

    for (const [name, indexes] of Object.entries(INDEXES)) {
      if (!existing.includes(name)) {
        await db.createCollection(name);
        created.push(name);
      }

      const collection = db.collection(name);
      for (const [keys, options] of indexes) {
        await collection.createIndex(keys, options);
      }
    }

    console.log('[message-indexes]', JSON.stringify({
      collectionsCreated: created,
      indexesEnsured: Object.values(INDEXES).reduce((total, list) => total + list.length, 0)
    }));
    next();
  } catch (error) {
    next(error);
  }
};

module.exports.down = async function down(next) {
  // Only the indexes are dropped. The collections and every message in them are
  // left alone: rolling back a schema change must never destroy user data.
  try {
    const db = mongoose.connection.db;
    const existing = (await db.listCollections().toArray()).map((item) => item.name);

    for (const [name, indexes] of Object.entries(INDEXES)) {
      if (!existing.includes(name)) continue;
      const collection = db.collection(name);
      const present = (await collection.indexes()).map((index) => index.name);
      for (const [, options] of indexes) {
        if (present.includes(options.name)) await collection.dropIndex(options.name);
      }
    }
    next();
  } catch (error) {
    next(error);
  }
};
