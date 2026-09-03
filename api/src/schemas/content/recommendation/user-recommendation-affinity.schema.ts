import {
  Prop, raw, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/**
 * A single decayable affinity score.
 *
 * `score` is the raw accumulated weight *as of* `updatedAt` — decay is applied
 * analytically at read time (`decayedScore = score * exp(-ageDays / halfLife)`)
 * rather than by a background recompute job. This keeps every write O(1) and
 * keeps the "affinity changes over time" requirement true without ever having
 * to touch old rows.
 *
 * Expressed as a plain interface plus a `raw()` schema definition, not a
 * `@Schema()`-decorated class: a decorated class is what a `Map`'s `of` needs
 * to be for a *reference/discriminator* relationship, but for a plain nested
 * subdocument shape `raw()` is the documented `@nestjs/mongoose` mechanism —
 * a bare class here compiles but fails at schema-build time with "is not a
 * valid type at path".
 */
export interface AffinitySignal {
  score: number;
  updatedAt: Date;
}

const AffinitySignalSchema = raw({
  score: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});

/**
 * One document per user (or per anonymous session id), holding decayable
 * affinity toward categories, hashtags and creators, plus lightweight format
 * preference. This is the "user interest" input to scoring — see
 * `RecommendationScoringService`.
 *
 * Guests never get a row here: `subjectId` is only ever a real user id or a
 * client-supplied anonymous session id the caller already trusts (never a
 * device fingerprint), matching the "no fabricated preference profile" rule.
 */
@Schema({
  collection: 'user_recommendation_affinities',
  timestamps: { createdAt: false, updatedAt: 'updatedAt' }
})
export class UserRecommendationAffinity {
  /** Authenticated user id, or an anonymous session id for guest-session learning. */
  @Prop({
    type: String,
    required: true
  })
  subjectId: string;

  /**
   * True when `subjectId` is a real user id rather than an anonymous session id.
   *
   * Defaults to `false`, and deliberately so. Both defaults are wrong in
   * principle — the field should always be stated by whoever writes the row —
   * but the two errors are not symmetric: labelling a guest's anonymous
   * session as a real account overstates what the row is and what may be done
   * with it, while labelling an account's row as anonymous only understates
   * it. The conservative direction is the safe one for anything that treats
   * account data differently (retention, export, deletion), so an unset field
   * reads as "not a known account" rather than as a confident claim.
   */
  @Prop({ type: Boolean, required: true, default: false })
  isAuthenticatedUser: boolean;

  @Prop({
    type: Map,
    of: AffinitySignalSchema,
    default: () => new Map()
  })
  categoryScores: Map<string, AffinitySignal>;

  @Prop({
    type: Map,
    of: AffinitySignalSchema,
    default: () => new Map()
  })
  hashtagScores: Map<string, AffinitySignal>;

  @Prop({
    type: Map,
    of: AffinitySignalSchema,
    default: () => new Map()
  })
  creatorScores: Map<string, AffinitySignal>;

  /** Photo vs. video preference, same decay model as the maps above. */
  @Prop({ type: AffinitySignalSchema, default: () => ({ score: 0, updatedAt: new Date() }) })
  photoFormatPreference: AffinitySignal;

  @Prop({ type: AffinitySignalSchema, default: () => ({ score: 0, updatedAt: new Date() }) })
  videoFormatPreference: AffinitySignal;

  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] })
  recentlySeenPostIds: ObjectId[];

  @Prop({ type: Date, default: null })
  lastEventAt: Date | null;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export type UserRecommendationAffinityDocument = HydratedDocument<UserRecommendationAffinity>;
export const UserRecommendationAffinitySchema = SchemaFactory.createForClass(UserRecommendationAffinity);

UserRecommendationAffinitySchema.index({ subjectId: 1 }, { unique: true, name: 'uq_user_recommendation_affinity_subject' });
