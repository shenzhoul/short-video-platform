/**
 * The post category catalogue a fresh installation starts with.
 *
 * These are exactly the thirteen topics that used to live in `POST_TOPICS` in
 * `api/src/common/constants/content.ts`, with the same keys and the same labels.
 * Keeping the keys identical is what makes this a pure addition: every post
 * already stores one of these keys in `topicKey`, so seeding the collection
 * gives those keys something to resolve against without a single post being
 * rewritten.
 *
 * `ordering` steps by ten so an admin can slot a new category between two
 * existing ones without renumbering the rest.
 */
module.exports = [
  { key: 'knowledge', name: 'Knowledge' },
  { key: 'games', name: 'Games' },
  { key: 'anime', name: 'Anime' },
  { key: 'music', name: 'Music' },
  { key: 'film', name: 'Film and television' },
  { key: 'food', name: 'Gourmet' },
  { key: 'lifestyle', name: 'Life on Vlog' },
  { key: 'sports', name: 'Sports' },
  { key: 'travel', name: 'Travel' },
  { key: 'parenting', name: 'Parent-child' },
  { key: 'animals', name: 'Animals' },
  { key: 'beauty', name: 'Wearing beauty' },
  { key: 'photography', name: 'Photography' }
].map((category, index) => ({
  ...category,
  description: '',
  status: 'active',
  ordering: (index + 1) * 10
}));
