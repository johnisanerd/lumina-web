const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config({ path: "/opt/viberyte/lumina-web/.env" });

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) {
  console.error("❌ Missing APIFY_API_TOKEN");
  process.exit(1);
}

const ACTOR = "johnvc~yelp-search-api";
const INPUT_FILE = path.join(__dirname, "nyc_region_final.json");

const venues = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));
console.log("🔵 Loaded venues:", venues.length);

// Split venues into chunks of 100
function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size)
    chunks.push(list.slice(i, i + size));
  return chunks;
}

const venueChunks = chunk(venues, 100);
console.log("📦 Total chunks:", venueChunks.length);

(async () => {
  let allResults = [];

  for (let idx = 0; idx < venueChunks.length; idx++) {
    const chunk = venueChunks[idx];
    console.log(`\n🚀 Running chunk ${idx + 1}/${venueChunks.length}`);

    const startUrls = chunk.map(v => ({
      url:
        "https://www.yelp.com/search?find_desc=" +
        encodeURIComponent(v.venueName) +
        "&find_loc=" +
        encodeURIComponent("New York, NY")
    }));

    // One run per search URL; each dataset item is a search page
    for (const { url } of startUrls) {
      try {
        const res = await axios.post(
          `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
          {
            search_url: url,
            max_pages: 1
          },
          { timeout: 1800000 }
        );

        for (const page of res.data) {
          if (page.error) {
            console.log("   ❌ Search FAILED:", page.error_message || page.error);
            continue;
          }
          allResults = allResults.concat(page.organic_results || []);
        }

      } catch (err) {
        console.log("   ❌ Search FAILED:", err.response?.data || err.message);
      }
    }

    console.log(`   ✔ Chunk complete: ${allResults.length} items so far`);

    await new Promise(r => setTimeout(r, 3000)); // pause between chunks
  }

  const OUT = path.join(__dirname, "yelp_batch_results.json");
  fs.writeFileSync(OUT, JSON.stringify(allResults, null, 2));

  console.log(`\n✅ ALL CHUNKS COMPLETE → ${OUT}`);
})();
