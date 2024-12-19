const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

async function fetchKeywords(inputCsvPath, inputKeywords) {
    let keywords = [];
    if (inputCsvPath && fs.existsSync(inputCsvPath)) {
        const fileContent = fs.readFileSync(inputCsvPath, 'utf-8');
        const records = parse(fileContent, { columns: false, skip_empty_lines: true });
        keywords = records.flat();
    }
    if (inputKeywords) {
        keywords = [...keywords, ...inputKeywords.split(',').map(k => k.trim())];
    }
    return keywords.filter(Boolean);
}

async function searchKeyword(page, keyword, searchType) {
    try {
        const searchQuery = searchType === 'intitle' 
            ? `intitle:"${keyword}"`
            : `allintitle:"${keyword}"`;

        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`);
        
        const statsElement = await page.waitForSelector('#result-stats', { 
            timeout: 20000,
            state: 'attached'
        });

        if (!statsElement) {
            console.log(`No stats found for keyword: ${keyword} (${searchType})`);
            return { keyword, searchType, count: 0 };
        }

        const resultStats = await statsElement.textContent();
        const match = resultStats.match(/About ([\d,]+) results/);
        const count = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
        
        console.log(`Keyword: "${keyword}", Type: "${searchType}", Count: ${count}`);
        return { keyword, searchType, count };

    } catch (error) {
        console.error(`Error for "${keyword}" (${searchType}): ${error.message}`);
        return null;
    }
}

async function startCrawler(keywords, id) {
    const results = [];
    const retryList = [];

    const browser = await firefox.launch({ 
        headless: true,
        args: ['--no-sandbox']
    });
    
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);

    // First pass: Process all keywords with both search types
    for (const keyword of keywords) {
        // Process intitle search
        const intitleResult = await searchKeyword(page, keyword, 'intitle');
        if (intitleResult) {
            results.push(intitleResult);
        } else {
            retryList.push({ keyword, searchType: 'intitle' });
        }

        // Add delay between searches
        await page.waitForTimeout(2000);

        // Process allintitle search
        const allintitleResult = await searchKeyword(page, keyword, 'allintitle');
        if (allintitleResult) {
            results.push(allintitleResult);
        } else {
            retryList.push({ keyword, searchType: 'allintitle' });
        }

        // Add delay between keywords
        await page.waitForTimeout(2000);
    }

    // Retry failed requests
    if (retryList.length > 0) {
        console.log(`Retrying ${retryList.length} failed searches...`);
        for (const { keyword, searchType } of retryList) {
            await page.waitForTimeout(5000); // Longer delay for retries
            const retryResult = await searchKeyword(page, keyword, searchType);
            results.push(retryResult || { 
                keyword, 
                searchType, 
                count: 0 
            });
        }
    }

    await browser.close();

    // Ensure results directory exists
    const resultsDir = path.join(process.cwd(), 'results');
    fs.mkdirSync(resultsDir, { recursive: true });

    // Save results as CSV
    const resultPath = path.join(resultsDir, `${id}.csv`);
    const csvContent = 'Keyword,Search Type,Count\n' +
        results
            .sort((a, b) => a.keyword.localeCompare(b.keyword) || a.searchType.localeCompare(b.searchType))
            .map(r => `${r.keyword},${r.searchType},${r.count}`)
            .join('\n');
    
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
        
        const totalKeywords = keywords.length;
        const totalSearches = results.length;
        const successfulSearches = results.filter(r => r.count > 0).length;
        
        console.log(`
Processing Summary:
------------------
Total Keywords: ${totalKeywords}
Total Searches: ${totalSearches}
Successful Searches: ${successfulSearches}
Failed Searches: ${totalSearches - successfulSearches}
        `);
        
        process.exit(0);
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
    process.exit(1);
});

main();
