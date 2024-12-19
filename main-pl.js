const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

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
  const browser = await firefox.launch({ 
    headless: true,
    args: ['--no-sandbox'] // Added for better GitHub Actions compatibility
  });
  
  const page = await browser.newPage();
  
  // Set longer timeout for GitHub Actions environment
  page.setDefaultTimeout(30000);

  // Loop through keywords and start scraping
  for (const keyword of keywords) {
    try {
      await page.goto(`https://www.google.com/search?q=intitle%3A%22${encodeURIComponent(keyword)}%22`);
      
      // Wait for Google's result stats with increased timeout
      const statsElement = await page.waitForSelector('#result-stats', { 
        timeout: 20000,
        state: 'attached'
      });
      
      if (!statsElement) {
        console.log(`No stats found for keyword: ${keyword}`);
        results.push({ keyword, searchType: 'intitle', count: 0 });
        continue;
      }

      const resultStats = await statsElement.textContent();
      const match = resultStats.match(/About ([\d,]+) results/);
      const count = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
      
      results.push({ keyword, searchType: 'intitle', count });
      console.log(`Keyword: "${keyword}", Type: "intitle", Count: ${count}`);
      
      // Add delay between requests to avoid rate limiting
      await page.waitForTimeout(2000);
      
    } catch (error) {
      console.error(`Error for "${keyword}": ${error.message}`);
      retryList.push(keyword);
    }
  }

  // Retry failed requests with longer delays
  if (retryList.length > 0) {
    console.log(`Retrying ${retryList.length} failed keywords...`);
    for (const keyword of retryList) {
      try {
        await page.waitForTimeout(5000); // Longer delay for retries
        await page.goto(`https://www.google.com/search?q=intitle%3A%22${encodeURIComponent(keyword)}%22`);
        
        const statsElement = await page.waitForSelector('#result-stats', { 
          timeout: 30000 
        });
        
        if (!statsElement) {
          results.push({ keyword, searchType: 'intitle', count: 0 });
          continue;
        }

        const resultStats = await statsElement.textContent();
        const match = resultStats.match(/About ([\d,]+) results/);
        const count = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
        
        results.push({ keyword, searchType: 'intitle', count });
        console.log(`Retrying Keyword: "${keyword}", Type: "intitle", Count: ${count}`);
        
      } catch (error) {
        console.error(`Error retrying "${keyword}": ${error.message}`);
        // Add failed keyword with count 0
        results.push({ keyword, searchType: 'intitle', count: 0 });
      }
    }
  }

  // Close the browser
  await browser.close();

  // Ensure results directory exists
  const resultsDir = path.join(process.cwd(), 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  // Save results as CSV
  const resultPath = path.join(resultsDir, `${id}.csv`);
  const csvContent = 'Keyword,Search Type,Count\n' +
    results.map(r => `${r.keyword},${r.searchType},${r.count}`).join('\n');
  
  fs.writeFileSync(resultPath, csvContent, 'utf-8');
  console.log(`Results saved to ${resultPath}`);
  
  return results;
}

async function main() {
  const [,, id, inputKeywords, inputCsvPath] = process.argv;
  
  if (!id) {
    console.error('Error: ID is required to save the results.');
    process.exit(1);
  }

  console.log(`Starting crawler with ID: ${id}`);
  console.log(`Input Keywords: ${inputKeywords}`);
  console.log(`Input CSV Path: ${inputCsvPath}`);

  try {
    const keywords = await fetchKeywords(inputCsvPath, inputKeywords);
    
    if (keywords.length === 0) {
      console.error('No keywords provided. Exiting...');
      process.exit(1);
    }

    console.log(`Processing ${keywords.length} keywords: ${keywords.join(', ')}`);
    const results = await startCrawler(keywords, id);
    
    console.log(`Successfully processed ${results.length} keywords`);
    process.exit(0);
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Add error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
  process.exit(1);
});

main();
