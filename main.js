const { PuppeteerCrawler } = require('crawlee');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parse } = require('csv-parse/sync'); // Using synchronous CSV parsing

async function fetchKeywords(inputCsvPath, inputKeywords) {
  let keywords = [];

  // If a Base64 CSV file path is provided, parse the CSV
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

  const crawler = new PuppeteerCrawler({
      requestHandler: async ({ page, request }) => {
      const { keyword, searchType } = request.userData;

      try {
        // Wait for Google's result stats
        await page.waitForSelector('#result-stats', { timeout: 10000 });

        // Extract result count
        const resultStats = await page.$eval('#result-stats', el => el.textContent);
        const match = resultStats.match(/About ([\d,]+) results/);
        const count = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;

        results.push({ keyword, searchType, count });
        console.log(`Keyword: "${keyword}", Type: "${searchType}", Count: ${count}`);
      } catch (error) {
        console.error(`Error for "${keyword}" (${searchType}): ${error.message}`);
        retryList.push(request); // Retry on failure
      }
    },
  });

  const startUrls = keywords.flatMap(keyword => [
    {
      url: `https://www.google.com/search?q=intitle%3A%22${encodeURIComponent(keyword)}%22`,
      userData: { keyword, searchType: 'intitle' },
    },
    {
      url: `https://www.google.com/search?q=allintitle%3A%22${encodeURIComponent(keyword)}%22`,
      userData: { keyword, searchType: 'allintitle' },
    },
  ]);

  await crawler.run(startUrls);

  // Retry failed requests
  if (retryList.length > 0) {
    console.log(`Retrying ${retryList.length} failed requests...`);
    await crawler.run(retryList);
  }

  // Save results as CSV
  const resultPath = path.join(__dirname, 'results', `${id}.csv`);
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
