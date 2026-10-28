const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('/opt/viberyte/lumina-web/data/lumina.db');
const APIFY_API_KEY = process.env.APIFY_API_TOKEN;
if (!APIFY_API_KEY) {
  console.error('Missing APIFY_API_TOKEN');
  process.exit(1);
}
const ACTOR_ID = 'johnvc~yelp-search-api';

// Yelp category → Lumina lens
const YELP_TO_LENS = {
  'ethiopian': 'african', 'african': 'african', 'nigerian': 'african', 
  'senegalese': 'african', 'moroccan': 'african', 'somali': 'african',
  'eritrean': 'african', 'ghanaian': 'african',
  'japanese': 'japanese', 'sushi bars': 'japanese', 'ramen': 'japanese', 'izakaya': 'japanese',
  'chinese': 'chinese', 'dim sum': 'chinese', 'cantonese': 'chinese', 'szechuan': 'chinese',
  'korean': 'korean', 'korean barbeque': 'korean',
  'thai': 'thai', 'vietnamese': 'thai', 'pho': 'thai',
  'indian': 'indian', 'pakistani': 'indian', 'himalayan/nepalese': 'indian',
  'italian': 'italian', 'pizza': 'italian', 'pasta shops': 'italian',
  'french': 'french', 'bistros': 'french',
  'mediterranean': 'mediterranean', 'greek': 'mediterranean', 'turkish': 'mediterranean',
  'lebanese': 'mediterranean', 'middle eastern': 'mediterranean',
  'mexican': 'mexican', 'tacos': 'mexican', 'tex-mex': 'mexican',
  'latin american': 'latin_american', 'peruvian': 'latin_american', 'colombian': 'latin_american',
  'brazilian': 'latin_american', 'argentine': 'latin_american', 'venezuelan': 'latin_american',
  'spanish': 'latin_american',
  'caribbean': 'caribbean', 'jamaican': 'caribbean', 'haitian': 'caribbean',
  'cuban': 'caribbean', 'puerto rican': 'caribbean', 'dominican': 'caribbean',
  'soul food': 'soul_food', 'southern': 'soul_food', 'cajun/creole': 'soul_food',
  'seafood': 'seafood', 'crab': 'seafood', 'lobster': 'seafood',
  'steakhouses': 'steakhouse', 'steak': 'steakhouse',
  'american (traditional)': 'american', 'american (new)': 'american', 
  'burgers': 'american', 'comfort food': 'american',
  'vegan': 'vegan', 'vegetarian': 'vegan',
  'asian fusion': 'fusion', 'tapas/small plates': 'fusion',
  'cocktail bars': 'LOW_LIGHT', 'wine bars': 'LOW_LIGHT', 'speakeasies': 'LOW_LIGHT',
  'jazz & blues': 'LOW_LIGHT', 'piano bars': 'LOW_LIGHT',
  'lounges': 'OUTSIDE', 'hookah bars': 'OUTSIDE',
  'dance clubs': 'MAIN_STAGE', 'music venues': 'MAIN_STAGE', 'nightlife': 'MAIN_STAGE',
};

const TAG_KEYWORDS = {
  'vegan': 'vegan', 'vegetarian': 'vegetarian',
  'rooftop': 'rooftop', 'outdoor': 'outdoor',
  'live music': 'live_music', 'dj': 'live_music',
  'happy hour': 'happy_hour',
  'late night': 'late_night',
  'good for groups': 'group_friendly',
  'romantic': 'date_night', 'intimate': 'date_night',
  'upscale': 'upscale', 'fine dining': 'upscale',
  'casual': 'casual',
  'brunch': 'brunch',
  'hookah': 'hookah',
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startYelpRun(searchTerm, location) {
  const input = {
    search_term: searchTerm,
    location: location,
    max_pages: 1,
  };

  const response = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const data = await response.json();
  
  if (data.error) {
    console.error('Apify error:', data.error);
    return null;
  }
  
  return data.data?.id;
}

async function waitForRun(runId) {
  let attempts = 0;
  while (attempts < 60) {
    const response = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`);
    const data = await response.json();
    const status = data.data?.status;
    
    if (status === 'SUCCEEDED') return true;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      console.error('Run failed:', status);
      return false;
    }
    
    process.stdout.write('.');
    await sleep(5000);
    attempts++;
  }
  return false;
}

async function getRunResults(runId) {
  const response = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_API_KEY}`);
  const pages = await response.json();
  // One dataset item per search page; businesses are in organic_results
  const businesses = [];
  for (const page of pages) {
    if (page.error) {
      console.error('Yelp search error:', page.error_message || page.error);
      continue;
    }
    for (const biz of page.organic_results || []) {
      businesses.push({ ...biz, name: biz.title });
    }
  }
  return businesses;
}

function normalizeString(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function matchYelpToVenue(yelpBiz, venues) {
  const yelpName = normalizeString(yelpBiz.name);
  let bestMatch = null, bestScore = 0;
  
  for (const venue of venues) {
    const venueName = normalizeString(venue.name);
    let score = 0;
    
    if (yelpName === venueName) score = 100;
    else if (yelpName.includes(venueName) || venueName.includes(yelpName)) score = 50;
    else {
      const y3 = yelpName.split(' ').slice(0, 3).join(' ');
      const v3 = venueName.split(' ').slice(0, 3).join(' ');
      if (y3 === v3 && y3.length > 5) score = 40;
    }
    
    if (score > bestScore) { bestScore = score; bestMatch = venue; }
  }
  
  return bestScore >= 40 ? bestMatch : null;
}

function extractLens(categories) {
  if (!categories) return null;
  for (const cat of categories) {
    const catLower = (typeof cat === 'string' ? cat : cat.title || '').toLowerCase();
    if (YELP_TO_LENS[catLower]) return YELP_TO_LENS[catLower];
    for (const [key, lens] of Object.entries(YELP_TO_LENS)) {
      if (catLower.includes(key)) return lens;
    }
  }
  return null;
}

function extractTags(yelpBiz) {
  const tags = new Set();
  const text = [...(yelpBiz.categories || []).map(c => typeof c === 'string' ? c : c.title || ''), yelpBiz.name || ''].join(' ').toLowerCase();
  for (const [kw, tag] of Object.entries(TAG_KEYWORDS)) {
    if (text.includes(kw)) tags.add(tag);
  }
  return Array.from(tags);
}

async function main() {
  try { db.exec(`ALTER TABLE venues ADD COLUMN yelp_categories TEXT`); } catch {}
  try { db.exec(`ALTER TABLE venues ADD COLUMN yelp_rating REAL`); } catch {}
  try { db.exec(`ALTER TABLE venues ADD COLUMN yelp_matched INTEGER DEFAULT 0`); } catch {}

  const venues = db.prepare(`
    SELECT id, name, address, city, state, primary_lens, secondary_lens, category
    FROM venues WHERE explore_ready = 1 ORDER BY city, id
  `).all();

  console.log(`Total venues: ${venues.length}`);

  // Group by city
  const byCity = {};
  for (const v of venues) {
    const city = (v.city || 'New York').replace(/_/g, ' ');
    if (!byCity[city]) byCity[city] = [];
    byCity[city].push(v);
  }

  // Sort cities by venue count (do biggest first)
  const cities = Object.entries(byCity).sort((a, b) => b[1].length - a[1].length);
  console.log(`Processing ${cities.length} cities, largest first\n`);

  const updateStmt = db.prepare(`
    UPDATE venues SET primary_lens = COALESCE(?, primary_lens), secondary_lens = COALESCE(?, secondary_lens),
    yelp_categories = ?, yelp_rating = ?, yelp_matched = 1 WHERE id = ?
  `);

  let totalMatched = 0, totalUpdated = 0;
  const allResults = [];

  for (const [city, cityVenues] of cities) {
    console.log(`\n=== ${city} (${cityVenues.length} venues) ===`);
    
    const BATCH_SIZE = 20;
    for (let i = 0; i < cityVenues.length; i += BATCH_SIZE) {
      const batch = cityVenues.slice(i, i + BATCH_SIZE);
      const location = `${city}, ${batch[0]?.state || 'NY'}`;
      
      console.log(`[Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(cityVenues.length/BATCH_SIZE)}] ${batch.length} venues...`);
      
      try {
        const results = [];
        for (const venue of batch) {
          const runId = await startYelpRun(venue.name, location);
          if (!runId) continue;

          process.stdout.write('Waiting');
          if (!await waitForRun(runId)) continue;
          console.log('');

          results.push(...await getRunResults(runId));
        }
        console.log(`Got ${results.length} results`);
        allResults.push(...results);
        
        for (const yelpBiz of results) {
          const matched = matchYelpToVenue(yelpBiz, batch);
          if (matched) {
            totalMatched++;
            const newLens = extractLens(yelpBiz.categories);
            const newTags = extractTags(yelpBiz);
            const yelpCats = JSON.stringify((yelpBiz.categories || []).map(c => typeof c === 'string' ? c : c.title));
            
            if (newLens && newLens !== matched.primary_lens) {
              console.log(`  ✓ "${matched.name}": ${matched.primary_lens} → ${newLens}`);
              totalUpdated++;
            }
            
            updateStmt.run(newLens, newTags.length ? JSON.stringify(newTags) : null, yelpCats, yelpBiz.rating, matched.id);
          }
        }
        
        fs.writeFileSync('/opt/viberyte/lumina-web/data/yelp-progress.json', JSON.stringify({ matched: totalMatched, updated: totalUpdated, results: allResults.length }));
        await sleep(2000);
      } catch (e) {
        console.error('Error:', e.message);
      }
    }
  }

  fs.writeFileSync('/opt/viberyte/lumina-web/data/yelp-results-all.json', JSON.stringify(allResults, null, 2));

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Matched: ${totalMatched} | Updated: ${totalUpdated}`);
  
  const counts = db.prepare(`SELECT primary_lens, COUNT(*) as count FROM venues WHERE explore_ready = 1 GROUP BY primary_lens ORDER BY count DESC`).all();
  console.log('\n--- Final Counts ---');
  counts.forEach(r => console.log(`  ${r.primary_lens}: ${r.count}`));

  db.close();
  console.log('\n✅ Done!');
}

main().catch(console.error);
