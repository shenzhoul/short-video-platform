import { ObjectId } from 'mongodb';
import { CategoryInactiveException, CategoryKeyTakenException } from 'src/common/exceptions/category';
import { EntityNotFoundException } from 'src/kernel';

import { CategoryService } from './category.service';

/** A stored category as Mongoose would hand it back. */
const categoryDoc = (overrides: Record<string, any> = {}) => ({
  _id: new ObjectId(),
  key: 'travel',
  name: 'Travel',
  description: '',
  status: 'active',
  ordering: 90,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides
});

/** Minimal Mongoose model double: only the methods CategoryService actually calls. */
const buildModel = (overrides: Record<string, any> = {}) => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
  ...overrides
});

const chainedFind = (result: any[], captured?: { sort?: any; skip?: number; limit?: number }) => {
  const chain: any = {
    sort: jest.fn((value: any) => {
      if (captured) captured.sort = value;
      return chain;
    }),
    limit: jest.fn((value: number) => {
      if (captured) captured.limit = value;
      return chain;
    }),
    skip: jest.fn((value: number) => {
      if (captured) captured.skip = value;
      return chain;
    }),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
  };
  return chain;
};

describe('CategoryService', () => {
  describe('findActive', () => {
    it('returns only active categories, ordered by ordering then name then id', async () => {
      const captured: { sort?: any } = {};
      const model = buildModel({
        find: jest.fn().mockReturnValue(chainedFind([categoryDoc()], captured))
      });
      const service = new CategoryService(model as any);

      const result = await service.findActive();

      expect(model.find).toHaveBeenCalledWith({ status: 'active' });
      expect(captured.sort).toEqual({ ordering: 1, name: 1, _id: 1 });
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('travel');
    });

    it('maps to the unchanged public topic shape', async () => {
      const model = buildModel({
        find: jest.fn().mockReturnValue(chainedFind([categoryDoc({ key: 'food', name: 'Gourmet' })]))
      });
      const service = new CategoryService(model as any);

      const [category] = await service.findActive();

      expect(category.toTopicResponse()).toEqual({ key: 'food', label: 'Gourmet' });
    });
  });

  describe('create', () => {
    it('stores the admin-supplied key normalized to lowercase', async () => {
      const model = buildModel({
        create: jest.fn().mockImplementation((data) => Promise.resolve(categoryDoc(data)))
      });
      const service = new CategoryService(model as any);

      await service.create({
        key: '  Street-Food  ',
        name: 'Street food',
        description: 'Food stalls',
        status: 'active',
        ordering: 40
      } as any);

      expect(model.create).toHaveBeenCalledWith({
        key: 'street-food',
        name: 'Street food',
        description: 'Food stalls',
        status: 'active',
        ordering: 40
      });
    });

    it('reports a duplicate key as a conflict instead of inventing a suffixed key', async () => {
      const duplicate: any = new Error('E11000 duplicate key');
      duplicate.code = 11000;
      duplicate.keyPattern = { key: 1 };
      const model = buildModel({ create: jest.fn().mockRejectedValue(duplicate) });
      const service = new CategoryService(model as any);

      await expect(service.create({ key: 'travel', name: 'Travel' } as any))
        .rejects.toBeInstanceOf(CategoryKeyTakenException);
      // The point of the test: no retry, no random suffix, one attempt only.
      expect(model.create).toHaveBeenCalledTimes(1);
    });

    it('rethrows a duplicate-key error raised by a different index', async () => {
      const duplicate: any = new Error('E11000 duplicate key');
      duplicate.code = 11000;
      duplicate.keyPattern = { somethingElse: 1 };
      const model = buildModel({ create: jest.fn().mockRejectedValue(duplicate) });
      const service = new CategoryService(model as any);

      await expect(service.create({ key: 'travel', name: 'Travel' } as any))
        .rejects.toBe(duplicate);
    });
  });

  describe('update', () => {
    it('never writes the key, even when one is smuggled into the payload', async () => {
      const model = buildModel({
        findOneAndUpdate: jest.fn().mockResolvedValue(categoryDoc())
      });
      const service = new CategoryService(model as any);
      const id = new ObjectId().toString();

      await service.update(id, {
        key: 'hijacked',
        name: 'Travel & Places',
        status: 'inactive',
        ordering: 15
      } as any);

      const [filter, update] = model.findOneAndUpdate.mock.calls[0];
      expect(filter).toEqual({ _id: id });
      expect(update).toEqual({
        $set: { name: 'Travel & Places', status: 'inactive', ordering: 15 }
      });
      expect(update.$set).not.toHaveProperty('key');
    });

    it('leaves status and ordering alone when the payload omits them', async () => {
      const model = buildModel({
        findOneAndUpdate: jest.fn().mockResolvedValue(categoryDoc())
      });
      const service = new CategoryService(model as any);

      await service.update(new ObjectId().toString(), { name: 'Travel' } as any);

      expect(model.findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: { name: 'Travel' } });
    });

    it('throws when the category does not exist', async () => {
      const model = buildModel({ findOneAndUpdate: jest.fn().mockResolvedValue(null) });
      const service = new CategoryService(model as any);

      await expect(service.update(new ObjectId().toString(), { name: 'Travel' } as any))
        .rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  describe('disable', () => {
    it('flips status to inactive rather than removing the record', async () => {
      const model = buildModel({
        findOneAndUpdate: jest.fn().mockResolvedValue(categoryDoc({ status: 'inactive' }))
      });
      const service = new CategoryService(model as any);
      const id = new ObjectId().toString();

      const result = await service.disable(id);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: id },
        { $set: { status: 'inactive' } },
        { new: true }
      );
      expect(result.status).toBe('inactive');
      // There is no delete path at all — posts keep a resolvable key forever.
      expect(model).not.toHaveProperty('deleteOne');
    });

    it('throws when the category does not exist', async () => {
      const model = buildModel({ findOneAndUpdate: jest.fn().mockResolvedValue(null) });
      const service = new CategoryService(model as any);

      await expect(service.disable(new ObjectId().toString()))
        .rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  describe('isActiveKey', () => {
    it('is true for an active key', async () => {
      const model = buildModel({ countDocuments: jest.fn().mockResolvedValue(1) });
      const service = new CategoryService(model as any);

      await expect(service.isActiveKey('Travel')).resolves.toBe(true);
      expect(model.countDocuments).toHaveBeenCalledWith({ key: 'travel', status: 'active' });
    });

    it('is false for an inactive or unknown key', async () => {
      const model = buildModel({ countDocuments: jest.fn().mockResolvedValue(0) });
      const service = new CategoryService(model as any);

      await expect(service.isActiveKey('gone')).resolves.toBe(false);
    });

    it('is false for an empty key without querying', async () => {
      const model = buildModel({ countDocuments: jest.fn() });
      const service = new CategoryService(model as any);

      await expect(service.isActiveKey('')).resolves.toBe(false);
      expect(model.countDocuments).not.toHaveBeenCalled();
    });
  });

  describe('resolveActiveKeyOrThrow', () => {
    it('returns the stored key for an active category', async () => {
      const model = buildModel({ findOne: jest.fn().mockResolvedValue(categoryDoc()) });
      const service = new CategoryService(model as any);

      await expect(service.resolveActiveKeyOrThrow('TRAVEL')).resolves.toBe('travel');
    });

    it('rejects a key that names no category', async () => {
      const model = buildModel({ findOne: jest.fn().mockResolvedValue(null) });
      const service = new CategoryService(model as any);

      await expect(service.resolveActiveKeyOrThrow('nope'))
        .rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('rejects a disabled category with its own error, not "not found"', async () => {
      const model = buildModel({
        findOne: jest.fn().mockResolvedValue(categoryDoc({ status: 'inactive' }))
      });
      const service = new CategoryService(model as any);

      await expect(service.resolveActiveKeyOrThrow('travel'))
        .rejects.toBeInstanceOf(CategoryInactiveException);
    });
  });

  describe('search', () => {
    it('defaults to catalogue order and reports the total', async () => {
      const captured: { sort?: any; skip?: number; limit?: number } = {};
      const model = buildModel({
        find: jest.fn().mockReturnValue(chainedFind([categoryDoc()], captured)),
        countDocuments: jest.fn().mockResolvedValue(13)
      });
      const service = new CategoryService(model as any);

      const result = await service.search({ limit: 10, offset: 0, sortBy: 'ordering' } as any);

      expect(captured.sort).toEqual({ ordering: 1, name: 1, _id: 1 });
      expect(captured.limit).toBe(10);
      expect(captured.skip).toBe(0);
      expect(result.total).toBe(13);
      expect(result.data).toHaveLength(1);
    });

    it('appends _id to any other sort so equal values page deterministically', async () => {
      const captured: { sort?: any } = {};
      const model = buildModel({
        find: jest.fn().mockReturnValue(chainedFind([], captured)),
        countDocuments: jest.fn().mockResolvedValue(0)
      });
      const service = new CategoryService(model as any);

      await service.search({ limit: 10, offset: 0, sortBy: 'name', sort: 'asc' } as any);

      expect(captured.sort).toEqual({ name: 1, _id: 1 });
    });

    it('filters by status and searches name and key together', async () => {
      const model = buildModel({
        find: jest.fn().mockReturnValue(chainedFind([])),
        countDocuments: jest.fn().mockResolvedValue(0)
      });
      const service = new CategoryService(model as any);

      await service.search({ q: 'trav', status: 'inactive', limit: 10, offset: 0 } as any);

      const query = model.find.mock.calls[0][0];
      expect(query.status).toBe('inactive');
      expect(query.$or).toHaveLength(2);
      expect(query.$or[0]).toHaveProperty('name');
      expect(query.$or[1]).toHaveProperty('key');
    });
  });

  describe('findByIdOrKey', () => {
    it('looks up by _id when given an ObjectId', async () => {
      const model = buildModel({ findOne: jest.fn().mockResolvedValue(categoryDoc()) });
      const service = new CategoryService(model as any);
      const id = new ObjectId().toString();

      await service.findByIdOrKey(id);

      expect(model.findOne).toHaveBeenCalledWith({ _id: id });
    });

    it('looks up by key when given anything else', async () => {
      const model = buildModel({ findOne: jest.fn().mockResolvedValue(categoryDoc()) });
      const service = new CategoryService(model as any);

      await service.findByIdOrKey('Travel');

      expect(model.findOne).toHaveBeenCalledWith({ key: 'travel' });
    });

    it('throws when nothing matches', async () => {
      const model = buildModel({ findOne: jest.fn().mockResolvedValue(null) });
      const service = new CategoryService(model as any);

      await expect(service.findByIdOrKey('missing'))
        .rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });
});
