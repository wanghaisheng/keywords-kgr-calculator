const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const mysql = require('mysql2/promise');
require('dotenv').config();

// Get configuration from GitHub Actions inputs or environment variables
const SAVE_TO_CSV = (process.env.INPUT_SAVE_CSV || 'false').toLowerCase() === 'true';
const SAVE_TO_DB = (process.env.INPUT_SAVE_DB || 'true').toLowerCase() === 'true';

// MySQL configuration
const DB_CONFIG = SAVE_TO_DB ? {
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'keyword_crawler',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: 'Z'
} : null;

// Create pool only if database saving is enabled
const pool = SAVE_TO_DB ? mysql.createPool(DB_CONFIG) : null;

async function initializeDB() {
    if (!SAVE_TO_DB) {
        console.log('Database saving is disabled, skipping initialization');
        return;
    }

    try {
        const connection = await pool.getConnection();
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS keyword_results (
                id INT AUTO_INCREMENT PRIMARY KEY,
                keyword VARCHAR(255) NOT NULL,
                search_type VARCHAR(50) NOT NULL,
                count INT NOT NULL,
                batch_id VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_batch_id (batch_id),
                INDEX idx_keyword (keyword),
                INDEX idx_updated_at (updated_at)
            );
        `;
        await connection.query(createTableSQL);
        console.log('Database initialized successfully');
        connection.release();
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    }
}

async function saveResultsToDB(results, batchId) {
    if (!SAVE_TO_DB) {
        console.log('Database saving is disabled, skipping DB save');
        return;
    }

    try {
        const connection = await pool.getConnection();
        const insertSQL = `
            INSERT INTO keyword_results 
            (keyword, search_type, count, batch_id, created_at, updated_at) 
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE 
            count = VALUES(count),
            updated_at = CURRENT_TIMESTAMP,
            batch_id = VALUES(batch_id)
        `;

        const stmt = await connection.prepare(insertSQL);
        const BATCH_SIZE = 100;
        
        for (let i = 0; i < results.length; i += BATCH_SIZE) {
            const batch = results.slice(i, i + BATCH_SIZE);
            const promises = batch.map(result => 
                stmt.execute([
                    result.keyword,
                    result.searchType,
                    result.count,
                    batchId
                ])
            );
            await Promise.all(promises);
        }

        await stmt.close();
        console.log(`Results saved to MySQL database for batch ${batchId}`);
        connection.release();
    } catch (error) {
        console.error('Error saving to database:', error);
        throw error;
    }
}

async function saveResultsToCSV(results, id) {
    if (!SAVE_TO_CSV) {
        console.log('CSV saving is disabled, skipping CSV save');
        return;
    }

    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const resultPath = path.join(__dirname, 'results', `${id}_${timestamp}.csv`);
        fs.mkdirSync(path.dirname(resultPath), { recursive: true });
        
        const csvContent = 'Keyword,Search Type,Count,Timestamp\n' +
            results.map(r => `${r.keyword},${r.searchType},${r.count},${new Date().toISOString()}`).join('\n');
        fs.writeFileSync(resultPath, csvContent, 'utf-8');
        console.log(`Results saved to ${resultPath}`);
    } catch (error) {
        console.error('Error saving to CSV:', error);
        throw error;
    }
}

async function getHistoricalData(keywords) {
    if (!SAVE_TO_DB) {
        return new Map();
    }

    try {
        const connection = await pool.getConnection();
        const query = `
            SELECT 
                keyword,
                count,
                created_at,
                updated_at
            FROM keyword_results
            WHERE keyword IN (?)
            ORDER BY keyword, created_at DESC;
        `;
        
        const [rows] = await connection.query(query, [keywords]);
        connection.release();
        
        const historicalMap = new Map();
        rows.forEach(record => {
            if (!historicalMap.has(record.keyword) || 
                new Date(record.updated_at) > new Date(historicalMap.get(record.keyword).updated_at)) {
                historicalMap.set(record.keyword, record);
            }
        });
        return historicalMap;
    } catch (error) {
        console.error('Error fetching historical data:', error);
        return new Map();
    }
}

// ... rest of the code remains the same until startCrawler function

async function startCrawler(keywords, id) {
    const results = [];
    const retryList = [];
    const browser = await firefox.launch({ headless: true });
    const page = await browser.newPage();

    const DELAY_BETWEEN_REQUESTS = 2000;
    const MAX_RETRIES = 3;

    // Get historical data only if DB is enabled
    const historicalData = SAVE_TO_DB ? await getHistoricalData(keywords) : new Map();

    // ... rest of the crawler logic remains the same ...

    await browser.close();

    // Save results based on configuration
    if (SAVE_TO_DB) {
        await saveResultsToDB(results, id);
    }

    if (SAVE_TO_CSV) {
        await saveResultsToCSV(results, id);
    }

    return results;
}

async function main() {
    try {
        const [,, id, inputKeywords, inputCsvPath] = process.argv;
        
        if (!id) {
            console.error('Error: ID is required.');
            process.exit(1);
        }

        console.log(`Starting crawler with ID: ${id} at ${new Date().toISOString()}`);
        console.log(`Save to CSV: ${SAVE_TO_CSV}`);
        console.log(`Save to DB: ${SAVE_TO_DB}`);
        
        if (SAVE_TO_DB) {
            await initializeDB();
        }

        const keywords = await fetchKeywords(inputCsvPath, inputKeywords);
        if (keywords.length === 0) {
            console.error('No keywords provided. Exiting...');
            process.exit(1);
        }

        console.log(`Processing ${keywords.length} keywords`);
        const results = await startCrawler(keywords, id);
        
        if (SAVE_TO_DB) {
            await pool.end();
        }
        
        return results;
    } catch (error) {
        console.error('Fatal error:', error);
        if (SAVE_TO_DB && pool) {
            await pool.end();
        }
        process.exit(1);
    }
}

main();
