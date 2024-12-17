const { PuppeteerCrawler, CheerioCrawler } = require('crawlee');
const fs = require('fs');
const axios = require('axios');
const { parse } = require('csv-parse');

async function fetchKeywords(input) {
  let keywords = input.keywords || [];

  // If input is a file or URL, fetch keywords
  if (input.keywordsUrl) {
    try {
      const response = await axios.get(input.keywordsUrl);
      const csvData = await parse(response.data, { columns: false });
      keywords = csvData.flat();
    } catch (error) {
      console.error('Error fetching CSV:', error.message);
    }
  }

  // If keywords are a string, split by commas
  if (typeof keywords === 'string') {
    keywords = keywords.split(',').map(keyword => keyword.trim());
  }

  return keywords;
}

async function startCrawler(keywords) {
  // Prepare to store results and retry list
  const results = [];
  let retryList = [];

  const proxyConfiguration = {
    // You can customize proxy settings here
    groups: ['DEFAULT'],
  };

  const crawler = new PuppeteerCrawler({
    proxyConfiguration,
    requestHandler: async ({ page, request }) => {
      const { keyword, searchType } = request.userData;

      try {
        // Wait for the results page to load
        await page.waitForSelector('#result-stats', { timeout: 10000 });

        // Extract the result count from the page
        const resultStats = await page.$eval('#result-stats', el => el.textContent);
        const match = resultStats.match(/About ([\d,]+) results/);
        const count = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;

        // Store the result
        results.push({ keyword, searchType, count });
        console.log(`Keyword: "${keyword}", Search Type: "${searchType}", Count: ${count}`);
      } catch (error) {
        if (error.message.includes('429')) {
          console.warn(`Retrying keyword "${keyword}" for "${searchType}" due to 429 error.`);
          retryList.push(request);
        } else {
          console.error(`Failed to process keyword "${keyword}" for "${searchType}": ${error.message}`);
          results.push({ keyword, searchType, count: 0 });
        }
      }
    },
  });

  // Construct start URLs for both "intitle" and "allintitle"
  const startUrls = keywords.flatMap(keyword => [
    {
      url: `https://www.google.com/search?q=intitle%3A%22${encodeURIComponent(keyword.replace(/\s+/g, '+'))}%22`,
      userData: { keyword, searchType: 'intitle' },
    },
    {
      url: `https://www.google.com/search?q=allintitle%3A%22${encodeURIComponent(keyword.replace(/\s+/g, '+'))}%22`,
      userData: { keyword, searchType: 'allintitle' },
    },
  ]);

  // Run the crawler with start URLs
  await crawler.run(startUrls);

  // Retry requests with 429 errors
  if (retryList.length > 0) {
    console.log(`Retrying ${retryList.length} requests with the original proxy...`);
    await crawler.run(retryList);
  }

  // Retry failed requests using an alternative proxy group
  if (retryList.length > 0) {
    console.log(`Retrying ${retryList.length} requests with a different proxy configuration...`);

    const altProxyConfiguration = {
      groups: ['GOOGLE_SERP'], // Alternative proxy group
    };

    const altCrawler = new CheerioCrawler({
      proxyConfiguration: altProxyConfiguration,
      requestHandler: async ({ request }) => {
        try {
          // Assume response parsing logic (for Cheerio)
          const response = await axios.get(request.url);
          console.log(`Successfully retried: ${request.url}`);
          results.push({ url: request.url, success: true });
        } catch (error) {
          console.error(`Failed to retry: ${request.url}`);
        }
      },
    });

    await altCrawler.run(retryList.map(req => req.url));
  }

  // Save results (can be to a file or database, for now just log)
  console.log('Results:', results);
}

async function main() {
  // Example input (This could be received from GitHub Action's input)
  const input = {
    keywords: 'apple,banana,carrot',  // Example keywords list
    keywordsUrl: '',  // Optional CSV file URL
  };

  // Fetch keywords from input (URL or CSV file)
  const keywords = await fetchKeywords(input);

  if (keywords.length > 0) {
    // Start the crawler with the fetched keywords
    await startCrawler(keywords);
  } else {
    console.error('No keywords to search.');
  }
}

// Run the main function
main();
