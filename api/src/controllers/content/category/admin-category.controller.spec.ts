/**
 * The controller pulls in the payload classes, which pull in the HTML sanitizer, which loads
 * `isomorphic-dompurify` — an ESM package Jest cannot parse under this project's CommonJS
 * transform. Nothing here exercises sanitization, so it is stubbed out rather than transformed.
 */
jest.mock('isomorphic-dompurify', () => ({ sanitize: (value: string) => value }));

import { HttpStatus } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum';
import { ObjectId } from 'mongodb';
import { PaginationGuard, RoleGuard } from 'src/common/guards';

import { AdminCategoryController } from './admin-category.controller';

const handlers = ['search', 'view', 'create', 'update', 'disable'] as const;

const rolesOf = (handler: string) => Reflect.getMetadata('roles', AdminCategoryController.prototype[handler]);
const guardsOf = (handler: string) => Reflect.getMetadata(GUARDS_METADATA, AdminCategoryController.prototype[handler]) || [];

describe('AdminCategoryController', () => {
  describe('authorization', () => {
    it.each(handlers)('restricts %s to the admin role', (handler) => {
      expect(rolesOf(handler)).toEqual(['admin']);
    });

    it.each(handlers)('enforces the admin role with RoleGuard on %s', (handler) => {
      // The @Roles decorator only writes metadata; without RoleGuard reading it the route is open.
      expect(guardsOf(handler)).toContain(RoleGuard);
    });

    it('bounds the listing with PaginationGuard', () => {
      expect(guardsOf('search')).toContain(PaginationGuard);
    });

    it('is mounted under the admin route prefix', () => {
      expect(Reflect.getMetadata(PATH_METADATA, AdminCategoryController)).toBe('admin/categories');
    });
  });

  describe('routes', () => {
    const methodOf = (handler: string) => Reflect.getMetadata(METHOD_METADATA, AdminCategoryController.prototype[handler]);

    it('exposes the destructive action as DELETE even though it disables rather than removes', () => {
      expect(methodOf('disable')).toBe(RequestMethod.DELETE);
    });

    it('uses POST to create and PUT to update', () => {
      expect(methodOf('create')).toBe(RequestMethod.POST);
      expect(methodOf('update')).toBe(RequestMethod.PUT);
    });

    it.each(handlers)('answers %s with 200', (handler) => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, AdminCategoryController.prototype[handler]))
        .toBe(HttpStatus.OK);
    });
  });

  describe('responses', () => {
    const category = {
      toAdminResponse: () => ({ _id: 'id', key: 'travel', name: 'Travel', status: 'active', ordering: 90 })
    };

    it('returns the admin shape, including status and ordering', async () => {
      const service = { create: jest.fn().mockResolvedValue(category) };
      const controller = new AdminCategoryController(service as any);

      const response: any = await controller.create({ key: 'travel', name: 'Travel' } as any);

      expect(response.data).toMatchObject({ key: 'travel', status: 'active', ordering: 90 });
    });

    it('maps every listed category through the admin shape and keeps the total', async () => {
      const service = {
        search: jest.fn().mockResolvedValue({ data: [category, category], total: 13 })
      };
      const controller = new AdminCategoryController(service as any);

      const response: any = await controller.search({ limit: 10, offset: 0 } as any);

      expect(response.data.total).toBe(13);
      expect(response.data.data).toHaveLength(2);
      expect(response.data.data[0]).toHaveProperty('status');
    });

    it('disables through the service rather than deleting', async () => {
      const service = { disable: jest.fn().mockResolvedValue(category) };
      const controller = new AdminCategoryController(service as any);
      const id = new ObjectId().toString();

      await controller.disable(id);

      expect(service.disable).toHaveBeenCalledWith(id);
      expect(service).not.toHaveProperty('delete');
    });
  });
});
