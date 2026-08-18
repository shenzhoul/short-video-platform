import { ObjectId } from 'mongodb';
import * as mongoose from 'mongoose';

export const isObjectId = (id: string): boolean => /^[0-9a-fA-F]{24}$/.test(id);

export const toObjectId = (id: string | ObjectId | mongoose.mongo.BSON.ObjectId | mongoose.mongo.BSON.ObjectIdLike | Uint8Array) => new mongoose.Types.ObjectId(id);