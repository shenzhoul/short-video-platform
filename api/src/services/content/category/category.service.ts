import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model, SortOrder } from 'mongoose';
import { CategoryInactiveException, CategoryKeyTakenException } from 'src/common/exceptions/category';
import { createSafeSearchRegex } from 'src/common/utils/search-sanitizer.util';
import { CategoryDto } from 'src/dtos/content/category';
import { EntityNotFoundException } from 'src/kernel';
import { PageableData } from 'src/kernel/common';
import { isObjectId } from 'src/kernel/helpers/string.helper';
import {
  CategoryCreatePayload,
  CategorySearchRequest,
  CategoryUpdatePayload
} from 'src/payloads/content/category';
import { Category, CategoryDocument } from 'src/schemas/content/category';
import { __t } from 'src/utils/translation';

/** Display order for every list of categories, public and admin alike. */
const CATEGORY_SORT: Record<string, SortOrder> = {
  ordering: 1,
  name: 1,
  _id: 1
};

/**
 * Post categories: the catalogue creators file posts under, managed from the admin app.
 *
 * There is deliberately no cache. The collection holds a handful of documents, every read is an
 * indexed lookup, and a cache would need cross-instance invalidation to stay correct behind the
 * load balancer — cost and a correctness risk bought for a query that is already trivial. Add one
 * when there is a measurement saying it is needed.
 */
@Injectable()
export class CategoryService {
  constructor(
    @InjectModel(Category.name) private readonly CategoryModel: Model<CategoryDocument>
  ) { }

  /**
   * Active categories in display order — the public catalogue.
   */
  public async findActive(): Promise<CategoryDto[]> {
    const items = await this.CategoryModel
      .find({ status: 'active' })
      .sort(CATEGORY_SORT);

    return items.map((item) => CategoryDto.fromModel(item));
  }

  /**
   * Look up one category by its stable key, regardless of status.
   *
   * Returns null rather than throwing: callers need to tell "missing" from "disabled" apart and
   * answer each differently.
   */
  public async findByKey(key: string): Promise<CategoryDto | null> {
    const normalized = this.normalizeKey(key);
    if (!normalized) return null;

    const item = await this.CategoryModel.findOne({ key: normalized });
    return item ? CategoryDto.fromModel(item) : null;
  }

  /**
   * True when `key` names a category that exists and is currently active.
   *
   * Used by the feed filter, which must not throw on an unknown key — see PostSearchService.
   */
  public async isActiveKey(key: string): Promise<boolean> {
    const normalized = this.normalizeKey(key);
    if (!normalized) return false;

    const count = await this.CategoryModel.countDocuments({ key: normalized, status: 'active' });
    return count > 0;
  }

  /**
   * Resolve the category a post is being filed under, or throw.
   *
   * Only ever called when the request actually sent a non-empty `topicKey`; an absent or cleared
   * value never reaches here, so "no category" is not this method's concern.
   */
  public async resolveActiveKeyOrThrow(key: string): Promise<string> {
    const category = await this.findByKey(key);
    if (!category) {
      throw new EntityNotFoundException(__t('errors.category_not_found'));
    }
    if (category.status !== 'active') {
      throw new CategoryInactiveException();
    }
    return category.key;
  }

  public async findByIdOrKey(idOrKey: string | ObjectId): Promise<CategoryDto> {
    const raw = `${idOrKey}`;
    const query = isObjectId(raw) ? { _id: idOrKey } : { key: this.normalizeKey(raw) };
    const item = await this.CategoryModel.findOne(query);
    if (!item) {
      throw new EntityNotFoundException(__t('errors.category_not_found'));
    }
    return CategoryDto.fromModel(item);
  }

  public async create(payload: CategoryCreatePayload): Promise<CategoryDto> {
    const key = this.normalizeKey(payload.key);

    try {
      const item = await this.CategoryModel.create({
        key,
        name: payload.name,
        description: payload.description || '',
        status: payload.status || 'active',
        ordering: payload.ordering ?? 0
      });
      return CategoryDto.fromModel(item);
    } catch (error) {
      // Narrow on purpose: only a collision on the key index means "this key is taken". Any other
      // duplicate-key error is a different problem and must not be reported as one the admin can
      // fix by renaming.
      if (error?.code === 11000 && error?.keyPattern?.key) {
        throw new CategoryKeyTakenException();
      }
      throw error;
    }
  }

  /**
   * Update the presentation and availability of a category. `key` is never written here — posts
   * store it, so it is fixed for the life of the record.
   */
  public async update(id: string | ObjectId, payload: CategoryUpdatePayload): Promise<CategoryDto> {
    const update: Record<string, any> = { name: payload.name };
    if (payload.description !== undefined) update.description = payload.description || '';
    if (payload.status !== undefined) update.status = payload.status;
    if (payload.ordering !== undefined) update.ordering = payload.ordering;

    const item = await this.CategoryModel.findOneAndUpdate(
      { _id: id },
      { $set: update },
      { new: true }
    );
    if (!item) {
      throw new EntityNotFoundException(__t('errors.category_not_found'));
    }
    return CategoryDto.fromModel(item);
  }

  /**
   * Disable a category so it disappears from the catalogue and can no longer be chosen.
   *
   * This is what the admin app's destructive action does — there is no physical delete. Posts store
   * the key, and with MongoDB standalone there is no transaction that could make "count references,
   * then delete" safe against a post being created at the same moment. Keeping the record costs one
   * small document and makes that race impossible.
   */
  public async disable(id: string | ObjectId): Promise<CategoryDto> {
    const item = await this.CategoryModel.findOneAndUpdate(
      { _id: id },
      { $set: { status: 'inactive' } },
      { new: true }
    );
    if (!item) {
      throw new EntityNotFoundException(__t('errors.category_not_found'));
    }
    return CategoryDto.fromModel(item);
  }

  public async search(req: CategorySearchRequest): Promise<PageableData<CategoryDto>> {
    const query: Record<string, any> = {};

    if (req.q) {
      const searchRegex = createSafeSearchRegex(req.q);
      if (searchRegex) {
        query.$or = [
          { name: { $regex: searchRegex } },
          { key: { $regex: searchRegex } }
        ];
      }
    }
    if (req.status) query.status = req.status;

    const limit = Number(req.limit) || 10;
    const offset = Number(req.offset) || 0;

    // `ordering` is the natural order of the catalogue, so it stays the default. Any other sort the
    // admin picks still gets `_id` appended so equal values page deterministically.
    const sort: Record<string, SortOrder> = req.sortBy && req.sortBy !== 'ordering'
      ? { [req.sortBy]: req.sort === 'asc' ? 1 : -1, _id: 1 }
      : CATEGORY_SORT;

    const [items, total] = await Promise.all([
      this.CategoryModel.find(query).sort(sort).limit(limit).skip(offset),
      this.CategoryModel.countDocuments(query)
    ]);

    return {
      data: items.map((item) => CategoryDto.fromModel(item)),
      total
    };
  }

  private normalizeKey(key: string): string {
    return typeof key === 'string' ? key.trim().toLowerCase() : '';
  }
}
