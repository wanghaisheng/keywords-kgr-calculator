const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync'); // Using synchronous CSV parsing
const cheerio = require('cheerio'); // For parsing HTML

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

  // Loop through keywords and start HTTP requests
  for (const keyword of keywords) {
    for (const searchType of ['intitle', 'allintitle']) {
      const url = `https://www.google.com/search?q=${searchType}%3A%22${encodeURIComponent(keyword)}%22`;
      try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });

        // Parse HTML response using cheerio
        const $ = cheerio.load(response.data);

    if (resultStatsDiv.length > 0) {
      const resultStats = resultStatsDiv.text().replace(/\u00A0/g, ' ').trim();
      console.log('Result stats found:', resultStats);
        
        
        // Extract the result stats from Google search page
        // const resultStats = $('#result-stats').text();
        const resultStats = $('#result-stats').text().replace(/\u00A0/g, ' ').trim();

        console.log(searchType,'raw result',resultStats)
        
        const match = resultStats.match(/About ([\d,]+) results/);
        const count = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
        console.log('clean result',count)

        results.push({ keyword, searchType, count });
        console.log(`Keyword: "${keyword}", Type: "${searchType}", Count: ${count}`);
    } else {
      console.log('No result stats div found on the page.');
    }

      
      } catch (error) {
        console.error(`Error for "${keyword}" (${searchType}): ${error.message}`);
        retryList.push({ keyword, searchType }); // Retry on failure
      }
    }
  }

  // Retry failed requests
  if (retryList.length > 0) {
    console.log(`Retrying ${retryList.length} failed requests...`);
    for (const { keyword, searchType } of retryList) {
      const url = `https://www.google.com/search?q=${searchType}%3A%22${encodeURIComponent(keyword)}%22`;
      try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const resultStats = $('#result-stats').text();
        console.log(searchType,'raw result',resultStats)
        const match = resultStats.match(/About ([\d,]+) results/);
        const count = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
        console.log('clean result',count)
        
        results.push({ keyword, searchType, count });
        console.log(`Retried Keyword: "${keyword}", Type: "${searchType}", Count: ${count}`);
      } catch (error) {
        console.error(`Error retrying "${keyword}" (${searchType}): ${error.message}`);
      }
    }
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
