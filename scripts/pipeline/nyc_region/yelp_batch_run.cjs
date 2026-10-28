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

// Build Yelp search URLs for all venues
const startUrls = venues.map(v => ({
  url:
    "https://www.yelp.com/search?find_desc=" +
    encodeURIComponent(v.venueName) +
    "&find_loc=" +
    encodeURIComponent("New York, NY")
}));

console.log("📄 Total Yelp search URLs created:", startUrls.length);

(async () => {
  console.log("\n🚀 Starting BATCH Yelp scrape via startUrls…");

  // One run per search URL; each dataset item is a search page
  let results = [];
  for (const { url } of startUrls) {
    try {
      const res = await axios.post(
        `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
        { search_url: url, max_pages: 1 },
        { timeout: 1800000 }
      );

      for (const page of res.data) {
        if (page.error) {
          console.log("❌ Search FAILED:", page.error_message || page.error);
          continue;
        }
        results = results.concat(page.organic_results || []);
      }
    } catch (err) {
      console.log("❌ Batch scrape FAILED:", err.response?.data || err.message);
    }
  }

  const OUT = path.join(__dirname, "yelp_batch_results.json");
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));

  console.log(`\n✅ Batch Yelp scrape DONE → ${OUT}`);
})();
