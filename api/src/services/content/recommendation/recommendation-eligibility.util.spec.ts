import { ObjectId } from 'mongodb';
import { STATUS } from 'src/kernel/constants';
import { buildEligibilityMatch } from './recommendation-eligibility.util';

describe('buildEligibilityMatch', () => {
  it('always requires active status and excludes deleted-creator posts', () => {
    const match = buildEligibilityMatch({ excludedCreatorIds: [], excludedPostIds: [] });
    expect(match.status).toBe(STATUS.ACTIVE);
    expect(match.isCreatorDeleted).toEqual({ $ne: true });
    expect(match.$and).toBeUndefined();
  });

  it('excludes the viewer\'s own posts', () => {
    const viewerId = new ObjectId().toString();
    const match = buildEligibilityMatch({ viewerId, excludedCreatorIds: [], excludedPostIds: [] });
    expect(match.$and).toContainEqual({ userId: { $ne: new ObjectId(viewerId) } });
  });

  it('excludes blocked-either-direction creators', () => {
    const blockedId = new ObjectId().toString();
    const match = buildEligibilityMatch({ excludedCreatorIds: [blockedId], excludedPostIds: [] });
    expect(match.$and).toContainEqual({ userId: { $nin: [new ObjectId(blockedId)] } });
  });

  it('excludes already-seen post ids', () => {
    const seenId = new ObjectId().toString();
    const match = buildEligibilityMatch({ excludedCreatorIds: [], excludedPostIds: [seenId] });
    expect(match.$and).toContainEqual({ _id: { $nin: [new ObjectId(seenId)] } });
  });

  it('never lets pinned state leak into eligibility (pinning is profile-only)', () => {
    const match = buildEligibilityMatch({ excludedCreatorIds: [], excludedPostIds: [] });
    expect(match.isPinned).toBeUndefined();
    expect(JSON.stringify(match)).not.toMatch(/pinned/i);
  });
});
