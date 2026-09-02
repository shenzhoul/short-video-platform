/**
 * The demo themes: one per active content category, plus the human-written
 * content that goes with each.
 *
 * ## One theme per category, and the catalogue is the source of truth
 *
 * `topicKey` must name a live, active row in the `categories` collection.
 * `demo:seed` reads that collection and refuses to run if a theme names a key
 * that is missing or inactive, and `demo:verify` fails if any active category
 * has no demo post. The list below is therefore a claim about coverage that the
 * tooling checks rather than a hardcoded copy of the catalogue — adding a
 * category to the product and not to this file is a verification failure, which
 * is the point.
 *
 * ## Accounts per theme
 *
 * Most themes carry one account. A few carry two, purely to reach the configured
 * minimum account count; `demo.config.js` owns that minimum and the per-account
 * post mix. Every account keeps a single consistent subject so a profile reads
 * as a person rather than a sampler.
 *
 * ## Caption pools
 *
 * Everything a reader sees is written here rather than generated. Each pool must
 * hold at least as many lines as the theme consumes:
 *
 *   videoCaptions >= accounts * (landscapeVideos + portraitVideos)
 *   photoCaptions >= accounts * photoPosts
 *
 * `demo:seed` checks this and refuses to start rather than repeat a line, so no
 * caption appears twice anywhere in the dataset.
 *
 * ## Queries are split by orientation
 *
 * `videoLandscape` and `videoPortrait` are separate query sets because they are
 * searched with different orientation filters and want different subjects — a
 * wide establishing shot and a phone-held close-up are not the same footage.
 * Orientation is confirmed from the downloaded file's real dimensions, never
 * from the query that found it.
 */

module.exports = [
  {
    key: 'street-food',
    label: 'Street Food',
    topicKey: 'food',
    queries: {
      photo: ['street food stall', 'noodle bowl close up', 'food market vendor'],
      videoLandscape: ['restaurant kitchen cooking', 'chef cooking wide', 'food market street', 'grill barbecue cooking'],
      videoPortrait: ['street food cooking', 'noodles cooking', 'pouring coffee', 'cooking pan close up'],
      cover: ['night food market', 'restaurant kitchen wide']
    },
    hashtags: ['streetfood', 'foodie', 'nightmarket', 'eatlocal', 'noodles', 'homecooking'],
    accounts: [
      { name: 'Mai Tran', username: 'maitran.eats', bio: 'Chasing the best bowl in every alley. Hanoi based, always hungry.' },
      { name: 'Diego Salas', username: 'diego.streetbites', bio: 'Line cook by night, market wanderer by day. I film what I eat.' }
    ],
    photoCaptions: [
      'Found this stall by accident and now it is the only place I go. #streetfood #eatlocal',
      'Chili oil made in house. I asked for the recipe and got a laugh. #foodie',
      'One plastic stool and the best thing I ate all week. #streetfood'
    ],
    videoCaptions: [
      'Watch the wok. That flame does the whole job. #streetfood #foodie',
      'Thirty seconds of noodle pulling I could watch all day. #noodles',
      'The market at 6am before anyone else shows up. #nightmarket #eatlocal',
      'She has folded ten thousand of these. It shows. #streetfood',
      'Sound on. That sizzle is the whole point. #foodie',
      'One pan, four minutes, dinner sorted. #homecooking',
      'How the broth actually gets made, start to finish. #noodles',
      'Closing time at the food market hits different. #nightmarket',
      'Charcoal, smoke, and thirty years of practice. #streetfood',
      'The queue was forty minutes. Worth every one. #eatlocal',
      'Knife work at a speed I will never reach. #foodie',
      'Broth simmering since 5am, and you can taste the hours. #noodles',
      'Second breakfast is a real meal and I will defend it. #eatlocal',
      'Rainy evening, hot bowl, no complaints. #nightmarket',
      'Took the long way home to pass this corner again. #streetfood',
      'Simple food done properly beats clever food done carelessly. #homecooking',
      'The grill at full tilt, right before the rush. #foodie',
      'He would not tell me what is in the sauce. Fair enough. #streetfood',
      'Dumplings, from flour to plate. #homecooking',
      'Last orders, and the wok is still going. #nightmarket'
    ],
    comments: [
      'Okay I need the address for this one.',
      'That broth looks unreal.',
      'Been there! The chili oil is dangerous.',
      'Saving this for my next trip.',
      'My stomach just growled out loud.',
      'The queue is worth it, can confirm.',
      'This is the content I follow you for.',
      'Making this at home tonight, wish me luck.'
    ]
  },

  {
    key: 'travel',
    label: 'Travel & Landscapes',
    topicKey: 'travel',
    queries: {
      photo: ['mountain hiker vertical', 'coastal cliff', 'desert dunes'],
      videoLandscape: ['drone mountain landscape', 'aerial coastline', 'road trip driving', 'waterfall forest wide'],
      videoPortrait: ['hiking trail walking', 'ocean waves close', 'travel walking street', 'waterfall vertical'],
      cover: ['mountain range panorama', 'coastline aerial wide']
    },
    hashtags: ['travel', 'wanderlust', 'slowtravel', 'roadtrip', 'mountains', 'coastline'],
    accounts: [
      { name: 'Elena Vasquez', username: 'elena.offmap', bio: 'Two backpacks, no itinerary. Currently somewhere with bad signal.' },
      { name: 'Kai Nakamura', username: 'kai.wanders', bio: 'Landscape work and long drives. I go back to the same places on purpose.' }
    ],
    photoCaptions: [
      'Four hours up for ten minutes of this. Fair trade. #mountains #travel',
      'Sat here an hour and did not take a photo until the end. #slowtravel',
      'Last light before the fog took everything. #coastline'
    ],
    videoCaptions: [
      'Straight off the ridge, no cuts. #mountains #travel',
      'The waves down there are much bigger than they look. #coastline',
      'Two thousand kilometres in ninety days, compressed. #roadtrip',
      'Found the waterfall on the third attempt. #wanderlust',
      'Sunrise over the pass, in real time. #slowtravel',
      'Turn the sound up. That is just the wind. #mountains',
      'What the drive actually looks like at 6am. #roadtrip',
      'Ten seconds of water doing what it always has. #travel',
      'The coast road, early, before the buses. #coastline',
      'No plan for tomorrow and that is the point. #slowtravel',
      'Same viewpoint, third year running. Never repeats. #travel',
      'Got lost, found this, stopped being annoyed. #wanderlust',
      'Six hours of driving for a place I cannot pronounce. #roadtrip',
      'Above the cloud line, finally. #mountains',
      'Packed light for once and missed nothing. #slowtravel',
      'The valley opening up after the last switchback. #travel',
      'Tide coming in faster than I expected. #coastline',
      'Everything I own fits in this frame. #wanderlust',
      'The last hour of light on the ridge. #mountains',
      'Pulled over because it would have been rude not to. #roadtrip'
    ],
    comments: [
      'Where is this? Adding it to the list immediately.',
      'That light is ridiculous.',
      'Been following for the landscapes and you keep delivering.',
      'How long was the hike in?',
      'Genuinely calming, thank you.',
      'The scale of that is hard to process.',
      'Bookmarking for next summer.',
      'Third time watching this.'
    ]
  },

  {
    key: 'music',
    label: 'Music & Performance',
    topicKey: 'music',
    queries: {
      photo: ['guitar close up', 'vinyl records', 'piano keys detail'],
      videoLandscape: ['live concert stage', 'music studio recording', 'orchestra performing', 'band rehearsal'],
      videoPortrait: ['guitar playing hands', 'drummer playing', 'singing microphone', 'piano playing close'],
      cover: ['concert stage wide', 'recording studio panorama']
    },
    hashtags: ['livemusic', 'guitar', 'homestudio', 'songwriting', 'vinyl', 'practice'],
    accounts: [
      { name: 'Marcus Bell', username: 'marcus.sixstring', bio: 'Guitarist, small rooms only. Recording an album in a bedroom, slowly.' },
      { name: 'Yuki Sato', username: 'yuki.homestudio', bio: 'Producer and drummer. I make loops at 2am and regret it at 8am.' }
    ],
    photoCaptions: [
      'Found this pressing for four euros. #vinyl',
      'This pedal has been on the board for eight years. #guitar',
      'Soundcheck light is the best light. #livemusic'
    ],
    videoCaptions: [
      'One take, one mic, no editing. #guitar #practice',
      'How the drum loop came together. #homestudio',
      'Last song of the night, small room, full volume. #livemusic',
      'Building the track from the first bar up. #songwriting',
      'Practising the part I keep getting wrong. #practice',
      'Thirty seconds of the chorus, rough mix. #homestudio',
      'The riff that started the whole album. #guitar',
      'Behind the kit for the final chorus. #livemusic',
      'Forty people in the room and it sounded enormous. #livemusic',
      'Restrung and finally in tune above the twelfth. #guitar',
      'Bedroom studio, treated with blankets, works fine. #homestudio',
      'Wrote three verses and kept half a line. #songwriting',
      'An hour of scales. Not glamorous. #practice',
      'Take nineteen was the one. #homestudio',
      'The song finally told me what it wanted. #songwriting',
      'Room mic only. You can hear the floor. #livemusic',
      'Slowed it down until my hands agreed. #practice',
      'Two amps, one room, no pedals. #guitar',
      'Everything you hear was recorded in one afternoon. #homestudio',
      'The bridge, finally sitting right. #songwriting'
    ],
    comments: [
      'That tone is gorgeous.',
      'Bedroom studios punching way above their weight.',
      'The timing on that fill is so clean.',
      'Please release this properly.',
      'One take? Absurd.',
      'This is going straight on my playlist.',
      'The room sound is doing so much here.',
      'More of the songwriting process please.'
    ]
  },

  {
    key: 'fitness',
    label: 'Fitness & Movement',
    topicKey: 'sports',
    queries: {
      photo: ['runner portrait', 'gym weights detail', 'climbing wall'],
      videoLandscape: ['gym training wide', 'running track athletics', 'basketball game', 'swimming pool training'],
      videoPortrait: ['workout exercise', 'yoga flow', 'running outdoor person', 'stretching mobility'],
      cover: ['gym interior wide', 'running track panorama']
    },
    hashtags: ['fitness', 'training', 'running', 'mobility', 'strength', 'consistency'],
    accounts: [
      { name: 'Priya Raman', username: 'priya.moves', bio: 'Coach. Mobility first, ego second. Progress is boring and that is fine.' }
    ],
    photoCaptions: [
      'Week eleven. Nothing dramatic, just showed up again. #consistency',
      'Hips were the problem the whole time. #mobility'
    ],
    videoCaptions: [
      'The mobility flow I do before every session. #mobility #training',
      'Tempo work, last interval, absolutely cooked. #running',
      'Fixing this one cue changed my whole squat. #strength',
      'Full warm up in under four minutes. #fitness',
      'What week one of a rebuild actually looks like. #consistency',
      'Slow it down and the movement gets easier. #training',
      'Race pace, uphill, and I am not smiling. #running',
      'Three drills that fixed my overhead position. #mobility',
      'Form over load, every single time. #strength',
      'Six kilometres before work. Cold, dark, worth it. #running',
      'Rest day counts as training. Took years to believe it. #fitness'
    ],
    comments: [
      'Needed to hear this today.',
      'That cue actually helped, thank you.',
      'Consistency really is the whole thing.',
      'How many sessions a week are you running?',
      'Respect for documenting the rebuild.',
      'Trying this flow tomorrow morning.',
      'Great form on that last rep.',
      'This is the realistic fitness content I want.'
    ]
  },

  {
    key: 'pets',
    label: 'Pets & Companions',
    topicKey: 'animals',
    queries: {
      photo: ['dog portrait', 'cat sitting window', 'puppy close up'],
      videoLandscape: ['dog running field', 'horses field', 'birds flying wide', 'dogs playing park'],
      videoPortrait: ['cat playing', 'puppy playing close', 'kitten', 'dog looking camera'],
      cover: ['dog running field wide', 'cat lying panorama']
    },
    hashtags: ['dogsofdouyin', 'catlife', 'rescue', 'petcare', 'goodboy', 'adoptdontshop'],
    accounts: [
      { name: 'Owen Fitzgerald', username: 'owen.fosters', bio: 'Foster carer, four years in. Twenty three cats placed and counting.' }
    ],
    photoCaptions: [
      'Two years since the shelter. Look at him now. #rescue #adoptdontshop',
      'Somebody discovered the sunbeam. #catlife'
    ],
    videoCaptions: [
      'Zoomies at 7am, uninvited. #dogsofdouyin #goodboy',
      'The exact moment she decided the box was hers. #catlife',
      'Teaching recall, day nine. Getting there. #petcare',
      'Foster kitten discovering stairs for the first time. #rescue',
      'Full send into the water, no hesitation. #goodboy',
      'He does this every time the door opens. #dogsofdouyin',
      'Ten seconds of pure chaos, sound on. #catlife',
      'The walk-up when he knows it is dinner. #petcare',
      'Adoption day. I am fine. Everything is fine. #adoptdontshop',
      'First proper walk after the vet cleared him. #petcare',
      'He has one toy he likes and it is this one. #dogsofdouyin'
    ],
    comments: [
      'Oh he is PERFECT.',
      'This made my whole day better.',
      'Thank you for fostering, genuinely.',
      'The little sigh at the end got me.',
      'What breed is she? Those ears!',
      'Rewatching this instead of working.',
      'Adoption day posts always get me.',
      'That is a very good boy indeed.'
    ]
  },

  {
    key: 'fashion',
    label: 'Style & Wear',
    topicKey: 'beauty',
    queries: {
      photo: ['outfit details', 'clothing rack detail', 'fabric texture close'],
      videoLandscape: ['fashion runway show', 'clothing studio wide', 'tailor workshop', 'textile factory'],
      videoPortrait: ['fashion model walking', 'sewing hands close', 'outfit styling', 'makeup close up'],
      cover: ['clothing studio wide', 'fashion atelier panorama']
    },
    hashtags: ['style', 'slowfashion', 'outfit', 'tailoring', 'secondhand', 'wardrobe'],
    accounts: [
      { name: 'Noor Haddad', username: 'noor.thread', bio: 'Pattern cutter. I make one garment a month and wear it for years.' }
    ],
    photoCaptions: [
      'Four fittings to get this shoulder right. Finally happy. #tailoring',
      'The details nobody photographs are the ones that last. #style'
    ],
    videoCaptions: [
      'Start to finish on the sleeve, sped up. #tailoring',
      'How I actually alter a thrifted shirt. #secondhand #style',
      'The drape only reads properly in motion. #outfit',
      'Three ways with one jacket. #wardrobe',
      'Cutting the pattern, real time, no music. #slowfashion',
      'Fitting session and everything that went wrong first. #tailoring',
      'Charity shop haul, honest reactions. #secondhand',
      'Why this fabric moves like that. #style #outfit',
      'Same coat, fifth winter. That is the philosophy. #slowfashion',
      'Took it in at the waist and it became a different garment. #secondhand',
      'One good jacket beats five mediocre ones. #wardrobe'
    ],
    comments: [
      'The tailoring on this is so clean.',
      'Secondhand finds like this give me hope.',
      'Please do a full pattern breakdown.',
      'Wearing things for years is underrated.',
      'That alteration completely changed it.',
      'Saving for my own wardrobe audit.',
      'The fabric choice is doing a lot of work here.',
      'You have convinced me to learn to sew.'
    ]
  },

  {
    key: 'tech',
    label: 'Tech & Making',
    topicKey: 'knowledge',
    queries: {
      photo: ['circuit board macro', 'mechanical keyboard close', 'soldering workbench'],
      videoLandscape: ['electronics workshop wide', 'laboratory research', 'robot arm factory', 'server room'],
      videoPortrait: ['soldering close up', '3d printer printing', 'hands assembling electronics', 'typing keyboard'],
      cover: ['electronics workbench wide', 'workshop desk panorama']
    },
    hashtags: ['electronics', 'making', '3dprinting', 'diy', 'workshop', 'repair'],
    accounts: [
      { name: 'Sofia Almeida', username: 'sofia.builds', bio: 'Hardware engineer. Repair cafe volunteer. Most things are fixable.' }
    ],
    photoCaptions: [
      'Two blown capacitors and a fifteen year old board saved. #repair',
      'Bench finally tidy. It will last a day. #workshop'
    ],
    videoCaptions: [
      'Six hours of printing in twenty seconds. #3dprinting',
      'Reflowing the joint, macro lens, sound on. #repair #electronics',
      'The arm finally moving under its own control. #making',
      'Full build, start to finish, failures included. #diy',
      'Why this joint kept cracking, explained on the bench. #workshop',
      'First power on. It did not catch fire. #electronics',
      'Assembly in real time, no cuts. #making #diy',
      'Testing the mechanism before I trust it. #workshop',
      'Someone threw this out. It needed one resistor. #repair',
      'Print eleven. Print eleven fits. #3dprinting',
      'Whole thing runs off one microcontroller. #electronics'
    ],
    comments: [
      'Repair content is the best content.',
      'That macro shot of the joint is beautiful.',
      'Print eleven! The struggle is real.',
      'What microcontroller are you running?',
      'Genuinely learned something, thanks.',
      'The fact that it needed one resistor is criminal.',
      'Please post the files for this.',
      'Watching this instead of fixing my own bench.'
    ]
  },

  {
    key: 'nature',
    label: 'Nature Photography',
    topicKey: 'photography',
    queries: {
      photo: ['macro insect flower', 'bird close up', 'misty forest path'],
      videoLandscape: ['forest landscape wide', 'river flowing forest', 'wildlife savanna', 'mountains timelapse'],
      videoPortrait: ['macro insect moving', 'bird close vertical', 'rain leaves close', 'flowers blooming'],
      cover: ['forest canopy wide', 'lake landscape panorama']
    },
    hashtags: ['wildlife', 'naturephotography', 'birding', 'macro', 'forest', 'conservation'],
    accounts: [
      { name: 'Iris Lindqvist', username: 'iris.inthefield', bio: 'Field ecologist with a camera. Mostly birds, occasionally patient.' }
    ],
    photoCaptions: [
      'Six mornings in the hide for this one frame. #birding #wildlife',
      'Focus stacked from fourteen frames. #macro #naturephotography'
    ],
    videoCaptions: [
      'Ten seconds of the river doing nothing in particular. #forest',
      'The whole flock lifting at once. #birding #wildlife',
      'Macro in motion is much harder than it looks. #macro',
      'Dawn chorus, unedited, headphones recommended. #naturephotography',
      'This week is survey work, not photography. #conservation',
      'It noticed me at the very end. #wildlife',
      'Canopy in the wind, nothing else. #forest',
      'What two centimetres of the world looks like. #macro',
      'Same nest, third season, same pair. #birding',
      'Fog does half the work and takes no credit. #forest',
      'Counted forty two this survey. Up from last year. #conservation'
    ],
    comments: [
      'The patience this takes is unreal.',
      'Focus stacking pays off, this is stunning.',
      'Dawn chorus with headphones, absolutely.',
      'Great to see the numbers going up.',
      'How close were you actually?',
      'This is why I follow you.',
      'That fog is doing incredible work.',
      'Macro world is genuinely alien.'
    ]
  },

  {
    key: 'gaming',
    label: 'Games & Play',
    topicKey: 'games',
    queries: {
      photo: ['gaming controller close', 'arcade machine', 'gaming keyboard rgb'],
      videoLandscape: ['esports arena', 'gaming setup wide', 'arcade hall', 'board game table'],
      videoPortrait: ['hands gaming controller', 'gaming keyboard typing', 'arcade playing', 'dice rolling table'],
      cover: ['esports arena wide', 'gaming room panorama']
    },
    hashtags: ['gaming', 'esports', 'arcade', 'boardgames', 'retrogaming', 'setup'],
    accounts: [
      { name: 'Tomas Berg', username: 'tomasberg.plays', bio: 'Local tournaments, retro cabinets, and far too many board games.' }
    ],
    photoCaptions: [
      'Restored this cabinet over four months. Worth it. #retrogaming #arcade',
      'The setup is finally cable-managed. Do not look behind it. #setup'
    ],
    videoCaptions: [
      'Grand final, last round, the room went silent. #esports',
      'Twenty minutes of soldering to fix one stuck button. #arcade',
      'The setup tour nobody asked for. #setup #gaming',
      'Teaching the rules badly, as usual. #boardgames',
      'This machine is older than I am and still perfect. #retrogaming',
      'Practice session, same combo, ninety times. #esports',
      'Opening night at the local arcade. #arcade',
      'Four hours of a game that says it takes ninety minutes. #boardgames',
      'Cleaned forty years of dust out of this board. #retrogaming',
      'The crowd reaction says everything. #esports',
      'New keyboard, first hour. #setup'
    ],
    comments: [
      'That restoration is beautiful work.',
      'The crowd reaction gave me chills.',
      'Which cabinet is that?',
      'Board game nights are the best nights.',
      'Ninety minutes, they said.',
      'Retro hardware always looks better.',
      'What switches are those?',
      'Local scene content is underrated.'
    ]
  },

  {
    key: 'illustration',
    label: 'Anime & Illustration',
    topicKey: 'anime',
    queries: {
      photo: ['comic book pages', 'illustration drawing desk', 'colourful character art'],
      videoLandscape: ['artist studio drawing', 'comic convention hall', 'animation workspace', 'art gallery illustration'],
      videoPortrait: ['drawing tablet hands', 'sketching close up', 'cosplay costume', 'painting character art'],
      cover: ['art studio wide', 'comic convention panorama']
    },
    hashtags: ['illustration', 'anime', 'cosplay', 'drawing', 'characterdesign', 'inking'],
    accounts: [
      { name: 'Hana Morimoto', username: 'hana.inks', bio: 'Character designer. Ink first, colour later, deadlines never.' }
    ],
    photoCaptions: [
      'Twelve pages inked this month. My wrist has opinions. #inking',
      'Character sheet finally settled after six versions. #characterdesign'
    ],
    videoCaptions: [
      'Rough to final in ninety seconds. #drawing #illustration',
      'The inking pass, real time, no undo. #inking',
      'Building a character from one silhouette. #characterdesign',
      'Convention floor at opening hour. #anime',
      'Three weeks of sewing for one costume. #cosplay',
      'Colour flats going down, the boring good part. #illustration',
      'How I fix a face that is not working. #drawing',
      'Studio tour, mostly unfinished pages. #illustration',
      'The panel layout I redrew four times. #inking',
      'Armour build, foam to finish. #cosplay',
      'Same character, five expressions. #characterdesign'
    ],
    comments: [
      'The linework here is so confident.',
      'Please do a full process video.',
      'That costume build is insane.',
      'The silhouette read is perfect.',
      'Six versions and it shows, in a good way.',
      'Convention footage always makes me want to go.',
      'What brush are you inking with?',
      'Colour flats are weirdly satisfying.'
    ]
  },

  {
    key: 'cinema',
    label: 'Film & Screen',
    topicKey: 'film',
    queries: {
      photo: ['film camera detail', 'cinema seats', 'clapperboard close'],
      videoLandscape: ['film production crew', 'movie theater interior', 'camera crane shot', 'film set lighting'],
      videoPortrait: ['camera operator filming', 'projector running', 'clapperboard take', 'film reel close'],
      cover: ['cinema hall wide', 'film set panorama']
    },
    hashtags: ['filmmaking', 'cinema', 'shortfilm', 'cinematography', 'onset', 'editing'],
    accounts: [
      { name: 'Adrien Moreau', username: 'adrien.onset', bio: 'Camera assistant. Short films at weekends. I collect bad call sheets.' }
    ],
    photoCaptions: [
      'Call time was 5am. This was 5:04. #onset #filmmaking',
      'Still shooting on this body after nine years. #cinematography'
    ],
    videoCaptions: [
      'Setting up the crane shot that took all morning. #onset',
      'One take, one lens, natural light only. #cinematography',
      'The projector booth nobody gets to see. #cinema',
      'Cutting the opening sequence, third pass. #editing',
      'Lighting a night exterior with almost nothing. #filmmaking',
      'Behind the monitor on the last day of the shoot. #onset',
      'Our short screened. Full room. Still processing it. #shortfilm',
      'Focus pull practice, over and over. #cinematography',
      'Sound department earning their keep. #onset',
      'The edit that finally made the scene work. #editing',
      'Empty cinema before the first screening. #cinema'
    ],
    comments: [
      'That crane move is beautiful.',
      'Natural light only? Incredible.',
      'Projection booths are magic.',
      'The edit completely changes the scene.',
      'Congratulations on the screening!',
      'Call sheets are a genre of horror.',
      'What lens is that?',
      'More on-set content please.'
    ]
  },

  {
    key: 'everyday',
    label: 'Life on Vlog',
    topicKey: 'lifestyle',
    queries: {
      photo: ['cozy apartment interior', 'morning coffee table', 'plants home interior'],
      videoLandscape: ['city street walking wide', 'apartment interior tour', 'cafe interior people', 'market day city'],
      videoPortrait: ['morning routine coffee', 'watering plants close', 'walking city street', 'cooking breakfast'],
      cover: ['city skyline panorama', 'living room wide']
    },
    hashtags: ['dailylife', 'slowliving', 'morningroutine', 'homeliving', 'citylife', 'vlog'],
    accounts: [
      { name: 'Camille Roy', username: 'camille.everyday', bio: 'Small flat, good light, slow mornings. Documenting the ordinary parts.' }
    ],
    photoCaptions: [
      'The corner of the flat that gets the good light. #homeliving',
      'Same mug, same chair, same ten minutes. #slowliving'
    ],
    videoCaptions: [
      'The whole morning, in ninety seconds. #morningroutine',
      'Flat tour, including the bits I have not finished. #homeliving',
      'Walking home the long way. #citylife',
      'Repotting everything on a Sunday. #slowliving',
      'Market run, then breakfast. #vlog',
      'What 6am actually looks like here. #morningroutine',
      'The cafe I go to when I need to leave the house. #citylife',
      'Nothing happens in this one and that is the point. #slowliving',
      'Cooking the same breakfast for the fourth day running. #dailylife',
      'Evening light across the room. #homeliving',
      'A whole day, compressed, no talking. #vlog'
    ],
    comments: [
      'This is so calming to watch.',
      'The light in your flat is unreal.',
      'Slow living content done properly.',
      'Where is that mug from?',
      'Needed this on a Monday.',
      'The long way home is always better.',
      'More flat tours please.',
      'Nothing happening is exactly what I wanted.'
    ]
  },

  {
    key: 'family',
    label: 'Parent & Child',
    topicKey: 'parenting',
    queries: {
      photo: ['child playing blocks', 'family hands together', 'kids drawing table'],
      videoLandscape: ['family playing park', 'children playground wide', 'family cooking kitchen', 'kids playing garden'],
      videoPortrait: ['toddler playing close', 'child drawing hands', 'parent child reading', 'baby playing toys'],
      cover: ['family park wide', 'playground panorama']
    },
    hashtags: ['parenting', 'toddlerlife', 'familytime', 'playtime', 'firsttimeparent', 'slowparenting'],
    accounts: [
      { name: 'Hannah Weber', username: 'hannah.andco', bio: 'Two under five. Documenting the ordinary days, mess included.' }
    ],
    photoCaptions: [
      'Forty minutes of concentration on one tower. #toddlerlife',
      'The drawing is of me, apparently. #parenting'
    ],
    videoCaptions: [
      'Park morning, no agenda. #familytime #playtime',
      'She has explained this game to me four times. #toddlerlife',
      'Cooking together, which means mostly cleaning. #parenting',
      'First time down the big slide. #playtime',
      'Reading the same book for the ninetieth night. #slowparenting',
      'Garden afternoon, everyone muddy. #familytime',
      'The bit of the day nobody films. #firsttimeparent',
      'Building something. Unclear what. #toddlerlife',
      'Walking to nursery, very slowly. #slowparenting',
      'He waited all week for this. #playtime',
      'Bedtime routine, honest version. #parenting'
    ],
    comments: [
      'The concentration on that face!',
      'Ninety nights of the same book, I feel this.',
      'Honest parenting content is so rare.',
      'The slide moment got me.',
      'Mine explains games to me too.',
      'Muddy afternoons are the best ones.',
      'Thank you for showing the unfiltered bits.',
      'Walking very slowly is the whole toddler experience.'
    ]
  }
];
