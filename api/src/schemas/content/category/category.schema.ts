import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { POST_CATEGORY_KEY_MAX_LENGTH, POST_CATEGORY_STATUSES } from 'src/common/constants';

/**
 * Broad content category a creator can file a post under.
 *
 * Posts reference a category by its `key`, not by `_id`. The key is the stable identifier: it is
 * written once at creation and never changes, so an admin can rename a category without touching a
 * single post. That is also why there is no `slug` — a slug regenerated from a renamed name would
 * break every post pointing at it.
 */
@Schema({
  collection: 'categories',
  timestamps: true
})
export class Category {
  /**
   * Stable identifier stored on `Post.topicKey`.
   *
   * Immutable after creation. `CategoryService.update` never writes it, and admins who need a
   * different key create a new category and disable the old one instead.
   */
  @Prop({
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    maxlength: POST_CATEGORY_KEY_MAX_LENGTH
  })
  key: string;

  /**
   * Display label. Free to change at any time — presentation only.
   */
  @Prop({
    type: String,
    required: true,
    trim: true
  })
  name: string;

  /**
   * Optional admin-facing note about what belongs in this category.
   */
  @Prop({
    type: String,
    trim: true
  })
  description: string;

  /**
   * `inactive` hides the category from the public list and stops new posts choosing it. Posts that
   * already reference it keep working — the record is never removed.
   */
  @Prop({
    type: String,
    enum: POST_CATEGORY_STATUSES,
    default: 'active'
  })
  status: string;

  /**
   * Display order, ascending. Seeded in steps of ten so a new category can be slotted between two
   * existing ones without renumbering the rest.
   */
  @Prop({
    type: Number,
    default: 0
  })
  ordering: number;

  createdAt: Date;

  updatedAt: Date;
}

export type CategoryDocument = HydratedDocument<Category>;

export const CategorySchema = SchemaFactory.createForClass(Category);

/**
 * UNIQUE CATEGORY KEY INDEX
 *
 * Purpose: guarantee one category per key, and make the key lookup on every post create/update and
 * every feed filter an index hit.
 *
 * Query Pattern:
 * - db.categories.findOne({ key: 'photography' })
 * - db.categories.findOne({ key: 'photography', status: 'active' })
 *
 * Constraint: the uniqueness that lets `Post.topicKey` be an unambiguous reference. A duplicate
 * insert surfaces as E11000 with keyPattern.key, which CategoryService turns into a 409.
 *
 * The seed migration creates this index with the same name and options before inserting, so
 * autoIndex at boot finds it already present and does nothing.
 */
CategorySchema.index({ key: 1 }, {
  name: 'idx_category_key_unique',
  unique: true
});

/**
 * PUBLIC LISTING INDEX
 *
 * Purpose: serve the public topic list — active categories in display order — from one index.
 *
 * Query Pattern:
 * - db.categories.find({ status: 'active' }).sort({ ordering: 1, name: 1, _id: 1 })
 *
 * `name` is part of the key so equal `ordering` values still sort deterministically rather than
 * falling back to an in-memory sort.
 */
CategorySchema.index({ status: 1, ordering: 1, name: 1 }, {
  name: 'idx_category_status_ordering_name'
});
