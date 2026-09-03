import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AFFINITY_DECAY_HALF_LIFE_DAYS
} from 'src/common/constants/recommendation';
import {
  UserRecommendationAffinity,
  UserRecommendationAffinityDocument
} from 'src/schemas/content/recommendation';

export interface TopAffinity {
  key: string;
  decayedScore: number;
}

export interface AffinityEventInput {
  subjectId: string;
  isAuthenticatedUser: boolean;
  topicKey?: string | null;
  tags?: string[];
  creatorId?: string;
  /** Raw weight for this event (already includes any watch-ratio/dwell-ratio scaling). */
  weight: number;
  isPhoto?: boolean;
  isVideo?: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Reads and updates per-user (or per-anonymous-session) taste signal.
 *
 * Decay is analytic, not a background job: every stored `score` is a raw
 * accumulated weight as of `updatedAt`, and `decay()` below converts it to a
 * present-day value on read. This keeps every write a single O(1)
 * `$inc`-shaped upsert (cheap enough for the request path, same class as a
 * `Post.totalLike` bump) while still satisfying "sở thích có thể thay đổi
 * theo thời gian" without ever touching historical rows.
 */
@Injectable()
export class RecommendationAffinityService {
  constructor(
    @InjectModel(UserRecommendationAffinity.name)
    private readonly affinityModel: Model<UserRecommendationAffinityDocument>
  ) { }

  private decay(score: number, updatedAt: Date, now: Date, halfLifeDays = AFFINITY_DECAY_HALF_LIFE_DAYS): number {
    if (!score) return 0;
    const ageDays = Math.max(0, (now.getTime() - new Date(updatedAt).getTime()) / MS_PER_DAY);
    return score * Math.exp((-Math.LN2 * ageDays) / halfLifeDays);
  }

  /** Read the full affinity document, or null if the subject has no history yet. */
  public async getRaw(subjectId: string): Promise<UserRecommendationAffinityDocument | null> {
    if (!subjectId) return null;
    return this.affinityModel.findOne({ subjectId }).lean() as any;
  }

  /** Top-N decayed category/hashtag/creator affinities, highest first, ties broken by key for determinism. */
  public topAffinities(
    map: Map<string, { score: number; updatedAt: Date }> | Record<string, { score: number; updatedAt: Date }> | undefined,
    n: number,
    now = new Date()
  ): TopAffinity[] {
    if (!map) return [];
    const entries = map instanceof Map ? Array.from(map.entries()) : Object.entries(map);
    return entries
      .map(([key, signal]) => ({ key, decayedScore: this.decay(signal.score, signal.updatedAt, now) }))
      .filter((entry) => entry.decayedScore > 0.001)
      .sort((a, b) => b.decayedScore - a.decayedScore || a.key.localeCompare(b.key))
      .slice(0, n);
  }

  /** Decayed format preference in [-1, 1]-ish range: positive favors video, negative favors photo. */
  public formatPreferenceScore(affinity: UserRecommendationAffinityDocument | null, now = new Date()): number {
    if (!affinity) return 0;
    const video = this.decay(affinity.videoFormatPreference?.score || 0, affinity.videoFormatPreference?.updatedAt || now, now);
    const photo = this.decay(affinity.photoFormatPreference?.score || 0, affinity.photoFormatPreference?.updatedAt || now, now);
    return video - photo;
  }

  /**
   * Apply one interaction's affinity contribution.
   *
   * A single upsert per event. Category/hashtag/creator/format increments all
   * land in one `$inc` so a like on a video in "food" tagged `#pho` updates all
   * four signals as one round trip rather than four.
   */
  public async applyEvent(input: AffinityEventInput): Promise<void> {
    if (!input.subjectId || !input.weight) return;

    const now = new Date();
    const inc: Record<string, number> = {};
    const setUpdatedAt: Record<string, Date> = {};

    if (input.topicKey) {
      inc[`categoryScores.${input.topicKey}.score`] = input.weight;
      setUpdatedAt[`categoryScores.${input.topicKey}.updatedAt`] = now;
    }
    (input.tags || []).slice(0, 10).forEach((tag) => {
      inc[`hashtagScores.${tag}.score`] = input.weight;
      setUpdatedAt[`hashtagScores.${tag}.updatedAt`] = now;
    });
    if (input.creatorId) {
      inc[`creatorScores.${input.creatorId}.score`] = input.weight;
      setUpdatedAt[`creatorScores.${input.creatorId}.updatedAt`] = now;
    }
    if (input.isVideo) {
      inc['videoFormatPreference.score'] = input.weight;
      setUpdatedAt['videoFormatPreference.updatedAt'] = now;
    }
    if (input.isPhoto) {
      inc['photoFormatPreference.score'] = input.weight;
      setUpdatedAt['photoFormatPreference.updatedAt'] = now;
    }

    if (!Object.keys(inc).length) return;

    await this.affinityModel.updateOne(
      { subjectId: input.subjectId },
      {
        $inc: inc,
        $set: { ...setUpdatedAt, lastEventAt: now, isAuthenticatedUser: input.isAuthenticatedUser },
        $setOnInsert: { subjectId: input.subjectId }
      },
      { upsert: true }
    );
  }

  /** Track a served post as recently seen, bounded to a small ring buffer for cross-session suppression. */
  public async markSeen(
    subjectId: string,
    postIds: string[],
    isAuthenticatedUser: boolean,
    cap = 200
  ): Promise<void> {
    if (!subjectId || !postIds.length) return;
    await this.affinityModel.updateOne(
      { subjectId },
      {
        $push: {
          recentlySeenPostIds: {
            $each: postIds,
            $slice: -cap
          }
        },
        // Stated by the caller, never assumed. This used to hardcode `true`,
        // which meant a *guest's* very first impression created a profile
        // claiming to belong to a real account — `markSeen` is reached by an
        // impression, and an impression carries no affinity weight, so for a
        // guest browsing without interacting this was the only row ever
        // written and it was mislabelled every time. Anything that treats
        // account data differently from an anonymous session (retention,
        // export, deletion) would have been reading a lie.
        $setOnInsert: { subjectId, isAuthenticatedUser }
      },
      { upsert: true }
    );
  }
}
