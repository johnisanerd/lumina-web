const fs = require("fs");
const path = require("path");
const axios = require("axios");

require("dotenv").config({ path: "/opt/viberyte/lumina-web/.env" });

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) {
    console.error("❌ ERROR: Missing APIFY_API_TOKEN in .env");
    process.exit(1);
}

const ACTOR = "johnvc~yelp-search-api";

const INPUT_FILE = path.join(__dirname, "nyc_region_final.json");
const OUTPUT_FILE = path.join(__dirname, "nyc_region_with_yelp.json");

const venues = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));
console.log("🔵 Loaded venues:", venues.length);

// Apify client
const apifyClient = axios.create({
    baseURL: "https://api.apify.com/v2",
    timeout: 300000,
});

// Scrape Yelp using run-sync endpoint
async function scrapeYelp(name) {
    try {
        const response = await apifyClient.post(
            `/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
            {
                search_term: name,
                location: "New York, NY",
                max_pages: 1
            }
        );

        // One dataset item per search page; businesses are in organic_results
        const page = response.data[0];
        if (!page || page.error) {
            if (page) console.log("❌ Yelp search error:", page.error_message || page.error);
            return null;
        }

        return (page.organic_results || [])[0] || null;

    } catch (err) {
        console.log("❌ Yelp scrape error:", err.response?.data || err.message);
        return null;
    }
}

async function run() {
    const enriched = [];

    for (let i = 0; i < venues.length; i++) {
        const v = venues[i];
        const venueName = v.venueName;

        console.log(`➡️ [${i + 1}/${venues.length}] Scraping Yelp for: ${venueName}`);

        const yelp = await scrapeYelp(venueName);

        if (yelp) {
            console.log(`   ✔ Yelp match found: ${yelp.title || venueName}`);

            v.yelp = {
                name: yelp.title || null,
                rating: yelp.rating || null,
                review_count: yelp.reviews || null,
                price: yelp.price || null,
                categories: yelp.categories || [],
                photos: yelp.thumbnail ? [yelp.thumbnail] : [],
                website: null,
                url: yelp.link || null,
                address: yelp.address || null,
                reviews: []
            };
        } else {
            console.log(`   ⚠️ No Yelp data`);
            v.yelp = null;
        }

        enriched.push(v);

        await new Promise(r => setTimeout(r, 700)); // prevent rate-limit
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(enriched, null, 2));
    console.log(`\n✅ Yelp scraping complete → ${OUTPUT_FILE}`);
}

run();
