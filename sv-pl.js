const { firefox } = require('playwright');  // Use firefox for headless browser
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parse } = require('csv-parse/sync');  // Using synchronous CSV parsing

// Function to fetch keywords from either a CSV file or from the input string
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

async function startCrawler(keywords, id) {
  const results = [];
  const retryList = [];

  // Launch a headless browser with Playwright
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();

  // Loop through keywords and start scraping
  for (const keyword of keywords) {
    try {
      // Open search URL
      await page.goto(`https://www.spyfu.com/keyword/overview?vwot=aa=^&query={encodeURIComponent(keyword)}%22`);
      // Wait for Google's result stats
      const visible = await page.locator('css=#root > main > div > div > main > div > div > div.grid.outer > aside > div > div.tw-flex.tw-flex-wrap > div.volume-and-clicks.tw-w-full.xs\:tw-w-1\/2.lg\:tw-w-full > div.monthly-volume.tw-border-b.tw-border-gray-200.tw-mb-6.tw-p-6.xs\:tw-mb-0.xs\:tw-border-b-0.lg\:tw-mb-6.lg\:tw-border-b').isVisible();
      if(visible){
        console.log('there is no search volume showing at all')
        return 
      }
      const resultStats = await page.locator('xpath=//*[@id="root"]/main/div/div/main/div/div/div[1]/aside/div/div[1]/div[1]/div[1]/div[1]/div[1]').allInnerTexts();
      console.log('========',t)
      // Extract result count
      const resultStats = await page.$eval('.tw-mb-1 tw-text-2xl', el => el.textContent);
      const count = resultStats

      results.push({ keyword, searchType: 'spyfu', count });
    } catch (error) {
      console.error(`Error for "${keyword}": ${error.message}`);
      retryList.push(keyword); // Retry on failure
    }
  }

  // Retry failed requests
  if (retryList.length > 0) {
    console.log(`Retrying ${retryList.length} failed keywords...`);
    for (const keyword of retryList) {
      try {
      await page.goto(`https://www.spyfu.com/keyword/overview?vwot=aa=^&query={encodeURIComponent(keyword)}%22`);
      const visible = await page.locator('css=#root > main > div > div > main > div > div > div.grid.outer > aside > div > div.tw-flex.tw-flex-wrap > div.volume-and-clicks.tw-w-full.xs\:tw-w-1\/2.lg\:tw-w-full > div.monthly-volume.tw-border-b.tw-border-gray-200.tw-mb-6.tw-p-6.xs\:tw-mb-0.xs\:tw-border-b-0.lg\:tw-mb-6.lg\:tw-border-b').isVisible();

      const resultStats = await page.locator('xpath=//*[@id="root"]/main/div/div/main/div/div/div[1]/aside/div/div[1]/div[1]/div[1]/div[1]/div[1]').allInnerTexts();
      const count = resultStats

        results.push({ keyword, searchVolume: 'spyfu', count });
        console.log(`Retrying Keyword: "${keyword}", Type: "intitle", Count: ${count}`);
      } catch (error) {
        console.error(`Error retrying "${keyword}": ${error.message}`);
      }
    }
  }

  // Close the browser
  await browser.close();

  // Save results as CSV
  const resultPath = path.join(__dirname, 'results', `${id}-.csv`);
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });

  const csvContent = 'Keyword,Search Type,Count\n' +
    results.map(r => `${r.keyword},${r.searchType},${r.count}`).join('\n');

  fs.writeFileSync(resultPath, csvContent, 'utf-8');
  console.log(`Results saved to ${resultPath}`);
}

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

main();
