const { firefox } = require('playwright'); // For headless browser
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync'); // CSV parsing
const Database = require('better-sqlite3');
require('dotenv').config();

// Turso DB credentials (set these in a .env file)
const TURSO_DB_URL = process.env.TURSO_DB_URL;
const TURSO_DB_TOKEN = process.env.TURSO_DB_TOKEN;

// Function to connect to the Turso database
function connectToDB() {
  const db = new Database(TURSO_DB_URL, {
    readonly: false,
    verbose: console.log,
  });
  db.pragma(`key='${TURSO_DB_TOKEN}'`);
  return db;
}

// Function to initialize the database schema
function initializeDB() {
  const db = connectToDB();
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS keyword_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      search_type TEXT NOT NULL,
      count INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  db.exec(createTableSQL);
  db.close();
}

// Function to save results to the database
function saveResultsToDB(results) {
  const db = connectToDB();
  const insertSQL = `
    INSERT INTO keyword_results (keyword, search_type, count, timestamp)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `;
  const stmt = db.prepare(insertSQL);

  for (const result of results) {
    stmt.run(result.keyword, result.searchType, result.count);
  }

  console.log('Results saved to Turso database.');
  db.close();
}

// Function to fetch keywords from a CSV file or string
async function fetchKeywords(inputCsvPath, inputKeywords) {
  let keywords = [];

  // If a CSV file path is provided, parse the CSV
  if (inputCsvPath && fs.existsSync(inputCsvPath)) {
    const fileContent = fs.readFileSync(inputCsvPath, 'utf-8');
    const records = parse(fileContent, { columns: false, skip_empty_lines: true });
    keywords = records.flat();
  }

  // If keywords are provided as a string, split by commas
  if (inputKeywords) {
    keywords = [...keywords, ...inputKeywords.split(',').map(k => k.trim())];
  }

  return keywords.filter(Boolean);
}

// Function to crawl Google search results
async function startCrawler(keywords, id) {
  const results = [];
  const retryList = [];

  // Launch a headless browser with Playwright
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();

  for (const keyword of keywords) {
    try {
      // Perform Google search
      await page.goto(`https://www.google.com/search?q=intitle%3A%22${encodeURIComponent(keyword)}%22`);
      await page.waitForSelector('#result-stats', { timeout: 10000 });

      // Extract search result stats
      const resultStats = await page.$eval('#result-stats', el => el.textContent);
      const match = resultStats.match(/About ([\d,]+) results/);
      const count = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;

      results.push({ keyword, searchType: 'intitle', count });
      console.log(`Keyword: "${keyword}", Type: "intitle", Count: ${count}`);
    } catch (error) {
      console.error(`Error for "${keyword}": ${error.message}`);
      retryList.push(keyword); // Retry on failure
    }
  }

  // Retry failed keywords
  if (retryList.length > 0) {
    console.log(`Retrying ${retryList.length} failed keywords...`);
    for (const keyword of retryList) {
      try {
        await page.goto(`https://www.google.com/search?q=intitle%3A%22${encodeURIComponent(keyword)}%22`);
        await page.waitForSelector('#result-stats', { timeout: 10000 });

        const resultStats = await page.$eval('#result-stats', el => el.textContent);
        const match = resultStats.match(/About ([\d,]+) results/);
        const count = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;

        results.push({ keyword, searchType: 'intitle', count });
        console.log(`Retrying Keyword: "${keyword}", Type: "intitle", Count: ${count}`);
      } catch (error) {
        console.error(`Error retrying "${keyword}": ${error.message}`);
      }
    }
  }

  // Close the browser
  await browser.close();

  // Save results to Turso DB
  saveResultsToDB(results);

  // Save results to CSV as a backup
  const resultPath = path.join(__dirname, 'results', `${id}.csv`);
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });

  const csvContent = 'Keyword,Search Type,Count\n' +
    results.map(r => `${r.keyword},${r.searchType},${r.count}`).join('\n');
  fs.writeFileSync(resultPath, csvContent, 'utf-8');
  console.log(`Results saved to ${resultPath}`);
}

// Main function
async function main() {
  const [,, id, inputKeywords, inputCsvPath] = process.argv;

  if (!id) {
    console.error('Error: ID is required to save the results.');
    process.exit(1);
  }

  console.log(`Starting crawler with ID: ${id}`);
  const keywords = await fetchKeywords(inputCsvPath, inputKeywords);

  if (keywords.length === 0) {
    console.error('No keywords provided. Exiting...');
    process.exit(1);
  }

  console.log(`Fetched Keywords: ${keywords.join(', ')}`);
  await startCrawler(keywords, id);
}

// Initialize the database schema and start the crawler
initializeDB();
main();
