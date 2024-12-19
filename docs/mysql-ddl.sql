-- Create database if not exists
CREATE DATABASE IF NOT EXISTS keyword_crawler
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE keyword_crawler;

-- Drop existing objects if they exist
DROP VIEW IF EXISTS vw_latest_results;
DROP VIEW IF EXISTS vw_daily_averages;
DROP VIEW IF EXISTS vw_batch_summary;
DROP VIEW IF EXISTS vw_kgr_analysis;
DROP VIEW IF EXISTS vw_opportunity_keywords;
DROP VIEW IF EXISTS vw_keyword_trends;

DROP PROCEDURE IF EXISTS sp_clean_old_data;
DROP PROCEDURE IF EXISTS sp_keyword_trends;
DROP PROCEDURE IF EXISTS sp_analyze_batch;
DROP PROCEDURE IF EXISTS sp_update_search_volume;
DROP PROCEDURE IF EXISTS sp_analyze_kgr;
DROP PROCEDURE IF EXISTS sp_batch_kgr_summary;
DROP PROCEDURE IF EXISTS sp_update_batch_status;

DROP TABLE IF EXISTS keyword_results;
DROP TABLE IF EXISTS batch_status;
DROP TABLE IF EXISTS search_volume_history;

-- Create batch status table
CREATE TABLE batch_status (
    batch_id VARCHAR(50) PRIMARY KEY,
    status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
    total_keywords INT DEFAULT 0,
    processed_keywords INT DEFAULT 0,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP NULL,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_status (status),
    INDEX idx_start_time (start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create search volume history table
CREATE TABLE search_volume_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(255) NOT NULL,
    search_volume INT NOT NULL,
    source VARCHAR(50) NOT NULL,
    recorded_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_keyword_date_source (keyword, recorded_date, source),
    INDEX idx_keyword (keyword),
    INDEX idx_recorded_date (recorded_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create main keyword results table
CREATE TABLE keyword_results (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(255) NOT NULL,
    search_type VARCHAR(50) NOT NULL,
    count INT NOT NULL,
    search_volume INT DEFAULT 0,
    kgr DECIMAL(10,4) GENERATED ALWAYS AS (
        CASE 
            WHEN search_volume > 0 THEN count / search_volume 
            ELSE 0 
        END
    ) STORED,
    kgr_status VARCHAR(20) GENERATED ALWAYS AS (
        CASE 
            WHEN search_volume = 0 THEN 'NO_VOLUME'
            WHEN count / search_volume < 0.25 THEN 'BUY'
            WHEN count / search_volume >= 0.25 AND count / search_volume <= 1 THEN 'CONSIDER'
            ELSE 'IGNORE'
        END
    ) STORED,
    batch_id VARCHAR(50),
    difficulty_score DECIMAL(5,2) DEFAULT NULL,
    serp_features JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_batch_id (batch_id),
    INDEX idx_keyword (keyword),
    INDEX idx_updated_at (updated_at),
    INDEX idx_search_type (search_type),
    INDEX idx_created_at (created_at),
    INDEX idx_kgr (kgr),
    INDEX idx_kgr_status (kgr_status),
    INDEX idx_search_volume (search_volume),
    
    -- Composite indexes
    INDEX idx_keyword_type (keyword, search_type),
    INDEX idx_batch_date (batch_id, created_at),
    INDEX idx_kgr_volume (kgr, search_volume),
    
    -- Foreign keys
    FOREIGN KEY (batch_id) REFERENCES batch_status(batch_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create views
CREATE OR REPLACE VIEW vw_latest_results AS
SELECT 
    kr1.*,
    COALESCE(
        (kr1.count - COALESCE(kr2.count, 0)) / NULLIF(kr2.count, 0) * 100,
        0
    ) as count_change_percentage,
    COALESCE(
        (kr1.kgr - COALESCE(kr2.kgr, 0)) / NULLIF(kr2.kgr, 0) * 100,
        0
    ) as kgr_change_percentage,
    bs.status as batch_status
FROM keyword_results kr1
LEFT JOIN keyword_results kr2 ON 
    kr1.keyword = kr2.keyword AND 
    kr1.search_type = kr2.search_type AND
    kr2.created_at = (
        SELECT MAX(created_at) 
        FROM keyword_results kr3 
        WHERE kr3.keyword = kr1.keyword 
        AND kr3.search_type = kr1.search_type 
        AND kr3.created_at < kr1.created_at
    )
LEFT JOIN batch_status bs ON kr1.batch_id = bs.batch_id
WHERE kr1.created_at = (
    SELECT MAX(created_at)
    FROM keyword_results
    WHERE keyword = kr1.keyword
    AND search_type = kr1.search_type
);

CREATE OR REPLACE VIEW vw_daily_averages AS
SELECT 
    keyword,
    search_type,
    DATE(created_at) as date,
    AVG(count) as avg_count,
    AVG(search_volume) as avg_search_volume,
    AVG(kgr) as avg_kgr,
    MIN(count) as min_count,
    MAX(count) as max_count,
    COUNT(*) as measurements,
    STD(count) as std_dev
FROM keyword_results
GROUP BY 
    keyword,
    search_type,
    DATE(created_at);

CREATE OR REPLACE VIEW vw_batch_summary AS
SELECT 
    kr.batch_id,
    bs.status,
    COUNT(DISTINCT kr.keyword) as unique_keywords,
    MIN(kr.created_at) as batch_start,
    MAX(kr.created_at) as batch_end,
    TIMESTAMPDIFF(SECOND, MIN(kr.created_at), MAX(kr.created_at)) as duration_seconds,
    AVG(kr.count) as avg_count,
    AVG(kr.search_volume) as avg_search_volume,
    AVG(kr.kgr) as avg_kgr,
    COUNT(CASE WHEN kr.kgr_status = 'BUY' THEN 1 END) as buy_keywords,
    COUNT(CASE WHEN kr.kgr_status = 'CONSIDER' THEN 1 END) as consider_keywords,
    COUNT(CASE WHEN kr.kgr_status = 'IGNORE' THEN 1 END) as ignore_keywords
FROM keyword_results kr
JOIN batch_status bs ON kr.batch_id = bs.batch_id
GROUP BY kr.batch_id, bs.status;

CREATE OR REPLACE VIEW vw_kgr_analysis AS
SELECT 
    keyword,
    search_type,
    count,
    search_volume,
    kgr,
    kgr_status,
    difficulty_score,
    created_at,
    CASE 
        WHEN search_volume = 0 THEN 'No search volume data'
        WHEN kgr < 0.25 THEN 'High potential - Consider targeting'
        WHEN kgr BETWEEN 0.25 AND 1 THEN 'Moderate potential - Research further'
        ELSE 'Low potential - High competition'
    END as recommendation,
    CASE 
        WHEN search_volume < 50 THEN 'Very Low'
        WHEN search_volume < 100 THEN 'Low'
        WHEN search_volume < 500 THEN 'Moderate'
        WHEN search_volume < 1000 THEN 'High'
        ELSE 'Very High'
    END as volume_category
FROM keyword_results
WHERE created_at = (
    SELECT MAX(created_at)
    FROM keyword_results kr2
    WHERE kr2.keyword = keyword_results.keyword
);

CREATE OR REPLACE VIEW vw_opportunity_keywords AS
SELECT 
    keyword,
    search_type,
    count,
    search_volume,
    kgr,
    kgr_status,
    difficulty_score,
    created_at,
    CASE 
        WHEN search_volume >= 100 AND kgr < 0.25 THEN 'High Priority'
        WHEN search_volume >= 50 AND kgr < 0.5 THEN 'Medium Priority'
        ELSE 'Low Priority'
    END as opportunity_level
FROM keyword_results
WHERE 
    created_at = (
        SELECT MAX(created_at)
        FROM keyword_results kr2
        WHERE kr2.keyword = keyword_results.keyword
    )
    AND search_volume > 0
    AND kgr < 1
ORDER BY 
    CASE 
        WHEN search_volume >= 100 AND kgr < 0.25 THEN 1
        WHEN search_volume >= 50 AND kgr < 0.5 THEN 2
        ELSE 3
    END,
    search_volume DESC;

-- Create stored procedures
DELIMITER //

CREATE PROCEDURE sp_clean_old_data(IN days_to_keep INT)
BEGIN
    DELETE FROM keyword_results 
    WHERE created_at < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    
    DELETE FROM search_volume_history
    WHERE created_at < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
END //

CREATE PROCEDURE sp_keyword_trends(
    IN p_keyword VARCHAR(255),
    IN p_days INT
)
BEGIN
    SELECT 
        DATE(created_at) as date,
        AVG(count) as avg_count,
        AVG(search_volume) as avg_search_volume,
        AVG(kgr) as avg_kgr,
        MIN(count) as min_count,
        MAX(count) as max_count,
        COUNT(*) as measurements
    FROM keyword_results
    WHERE 
        keyword = p_keyword AND
        created_at >= DATE_SUB(NOW(), INTERVAL p_days DAY)
    GROUP BY DATE(created_at)
    ORDER BY DATE(created_at);
END //

CREATE PROCEDURE sp_analyze_batch(IN p_batch_id VARCHAR(50))
BEGIN
    -- Basic batch statistics
    SELECT 
        COUNT(DISTINCT keyword) as total_keywords,
        MIN(created_at) as start_time,
        MAX(created_at) as end_time,
        TIMESTAMPDIFF(SECOND, MIN(created_at), MAX(created_at)) as duration_seconds,
        AVG(count) as avg_count,
        AVG(search_volume) as avg_search_volume,
        AVG(kgr) as avg_kgr,
        COUNT(CASE WHEN kgr_status = 'BUY' THEN 1 END) as buy_keywords,
        COUNT(CASE WHEN kgr_status = 'CONSIDER' THEN 1 END) as consider_keywords
    FROM keyword_results
    WHERE batch_id = p_batch_id;

    -- KGR distribution
    SELECT 
        kgr_status,
        COUNT(*) as keyword_count,
        AVG(search_volume) as avg_search_volume
    FROM keyword_results
    WHERE batch_id = p_batch_id
    GROUP BY kgr_status;
END //

CREATE PROCEDURE sp_update_search_volume(
    IN p_keyword VARCHAR(255),
    IN p_search_volume INT,
    IN p_source VARCHAR(50)
)
BEGIN
    -- Update current search volume
    UPDATE keyword_results 
    SET 
        search_volume = p_search_volume,
        updated_at = CURRENT_TIMESTAMP
    WHERE keyword = p_keyword;

    -- Record in history
    INSERT INTO search_volume_history (keyword, search_volume, source, recorded_date)
    VALUES (p_keyword, p_search_volume, p_source, CURRENT_DATE)
    ON DUPLICATE KEY UPDATE
        search_volume = p_search_volume;
END //

CREATE PROCEDURE sp_analyze_kgr(
    IN p_min_volume INT,
    IN p_max_kgr DECIMAL(10,4)
)
BEGIN
    SELECT 
        keyword,
        search_type,
        count,
        search_volume,
        kgr,
        kgr_status,
        difficulty_score,
        created_at,
        CASE 
            WHEN search_volume >= 100 AND kgr < 0.25 THEN 'High Priority'
            WHEN search_volume >= 50 AND kgr < 0.5 THEN 'Medium Priority'
            ELSE 'Low Priority'
        END as opportunity_level
    FROM keyword_results
    WHERE 
        search_volume >= p_min_volume
        AND kgr <= p_max_kgr
        AND created_at = (
            SELECT MAX(created_at)
            FROM keyword_results kr2
            WHERE kr2.keyword = keyword_results.keyword
        )
    ORDER BY 
        search_volume DESC,
        kgr ASC;
END //

CREATE PROCEDURE sp_update_batch_status(
    IN p_batch_id VARCHAR(50),
    IN p_status VARCHAR(20),
    IN p_error_message TEXT
)
BEGIN
    UPDATE batch_status
    SET 
        status = p_status,
        error_message = CASE 
            WHEN p_status = 'failed' THEN p_error_message
            ELSE NULL
        END,
        end_time = CASE 
            WHEN p_status IN ('completed', 'failed') THEN CURRENT_TIMESTAMP
            ELSE NULL
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE batch_id = p_batch_id;
END //

DELIMITER ;

-- Create event to clean old data
CREATE EVENT IF NOT EXISTS e_clean_old_data
ON SCHEDULE EVERY 1 DAY
DO CALL sp_clean_old_data(90);

-- Enable event scheduler
SET GLOBAL event_scheduler = ON;

-- Create user and grant permissions
-- Replace 'your_user' and 'your_password' with actual values
CREATE USER IF NOT EXISTS 'your_user'@'%' IDENTIFIED BY 'your_password';

GRANT SELECT, INSERT, UPDATE, DELETE ON keyword_crawler.* TO 'your_user'@'%';
GRANT EXECUTE ON keyword_crawler.* TO 'your_user'@'%';
FLUSH PRIVILEGES;

-- Add sample data
INSERT INTO batch_status (batch_id, status, total_keywords)
VALUES ('test-batch-1', 'completed', 2);

INSERT INTO keyword_results (keyword, search_type, count, search_volume, batch_id)
VALUES 
    ('test keyword', 'intitle', 1000, 5000, 'test-batch-1'),
    ('another test', 'intitle', 2000, 10000, 'test-batch-1');

INSERT INTO search_volume_history (keyword, search_volume, source, recorded_date)
VALUES 
    ('test keyword', 5000, 'google', CURRENT_DATE),
    ('another test', 10000, 'google', CURRENT_DATE);


-- Create Google Trends data table
CREATE TABLE keyword_trends (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(255) NOT NULL,
    trend_value INT NOT NULL,
    trend_date DATE NOT NULL,
    region VARCHAR(50) DEFAULT 'US',
    time_range VARCHAR(20) DEFAULT '12m', -- e.g., '12m', '30d', etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_keyword (keyword),
    INDEX idx_trend_date (trend_date),
    INDEX idx_region (region),
    UNIQUE KEY uk_keyword_date_region (keyword, trend_date, region)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create view for trend analysis
CREATE OR REPLACE VIEW vw_keyword_trend_analysis AS
SELECT 
    k.keyword,
    k.search_volume,
    k.kgr,
    k.kgr_status,
    t.trend_value,
    t.trend_date,
    t.region,
    t.time_range,
    CASE 
        WHEN t.trend_value > 75 THEN 'High'
        WHEN t.trend_value > 50 THEN 'Medium'
        WHEN t.trend_value > 25 THEN 'Low'
        ELSE 'Very Low'
    END as trend_category,
    k.created_at
FROM keyword_results k
LEFT JOIN keyword_trends t ON 
    k.keyword = t.keyword 
    AND t.trend_date = (
        SELECT MAX(trend_date) 
        FROM keyword_trends t2 
        WHERE t2.keyword = k.keyword
    );

-- Create stored procedure to save trend data
DELIMITER //

CREATE PROCEDURE sp_save_trend_data(
    IN p_keyword VARCHAR(255),
    IN p_trend_value INT,
    IN p_trend_date DATE,
    IN p_region VARCHAR(50),
    IN p_time_range VARCHAR(20)
)
BEGIN
    INSERT INTO keyword_trends (
        keyword, 
        trend_value, 
        trend_date, 
        region, 
        time_range
    )
    VALUES (
        p_keyword, 
        p_trend_value, 
        p_trend_date, 
        IFNULL(p_region, 'US'), 
        IFNULL(p_time_range, '12m')
    )
    ON DUPLICATE KEY UPDATE
        trend_value = p_trend_value,
        updated_at = CURRENT_TIMESTAMP;
END //

-- Create stored procedure to get trend history
CREATE PROCEDURE sp_get_trend_history(
    IN p_keyword VARCHAR(255),
    IN p_start_date DATE,
    IN p_end_date DATE,
    IN p_region VARCHAR(50)
)
BEGIN
    SELECT 
        keyword,
        trend_value,
        trend_date,
        region,
        time_range,
        created_at
    FROM keyword_trends
    WHERE 
        keyword = p_keyword
        AND trend_date BETWEEN p_start_date AND p_end_date
        AND (p_region IS NULL OR region = p_region)
    ORDER BY trend_date;
END //

-- Create stored procedure for trend analysis
CREATE PROCEDURE sp_analyze_trends(
    IN p_min_trend_value INT,
    IN p_region VARCHAR(50)
)
BEGIN
    SELECT 
        k.keyword,
        k.search_volume,
        k.kgr,
        t.trend_value,
        t.trend_date,
        CASE 
            WHEN t.trend_value > 75 THEN 'High'
            WHEN t.trend_value > 50 THEN 'Medium'
            WHEN t.trend_value > 25 THEN 'Low'
            ELSE 'Very Low'
        END as trend_category,
        CASE
            WHEN k.kgr < 0.25 AND t.trend_value > 50 THEN 'High Priority'
            WHEN k.kgr < 0.5 AND t.trend_value > 25 THEN 'Medium Priority'
            ELSE 'Low Priority'
        END as opportunity_score
    FROM keyword_results k
    JOIN keyword_trends t ON k.keyword = t.keyword
    WHERE 
        t.trend_value >= p_min_trend_value
        AND t.region = p_region
        AND t.trend_date = (
            SELECT MAX(trend_date) 
            FROM keyword_trends t2 
            WHERE t2.keyword = k.keyword
        )
    ORDER BY t.trend_value DESC, k.kgr ASC;
END //

-- Create stored procedure for trend summary
CREATE PROCEDURE sp_trend_summary(
    IN p_batch_id VARCHAR(50)
)
BEGIN
    SELECT 
        kt.region,
        COUNT(*) as total_keywords,
        AVG(kt.trend_value) as avg_trend_value,
        COUNT(CASE WHEN kt.trend_value > 75 THEN 1 END) as high_trend_keywords,
        COUNT(CASE WHEN kt.trend_value BETWEEN 50 AND 75 THEN 1 END) as medium_trend_keywords,
        COUNT(CASE WHEN kt.trend_value BETWEEN 25 AND 49 THEN 1 END) as low_trend_keywords,
        COUNT(CASE WHEN kt.trend_value < 25 THEN 1 END) as very_low_trend_keywords
    FROM keyword_results kr
    JOIN keyword_trends kt ON kr.keyword = kt.keyword
    WHERE 
        kr.batch_id = p_batch_id
        AND kt.trend_date = (
            SELECT MAX(trend_date) 
            FROM keyword_trends kt2 
            WHERE kt2.keyword = kr.keyword
        )
    GROUP BY kt.region;
END //

DELIMITER ;

-- Grant additional permissions
GRANT EXECUTE ON PROCEDURE keyword_crawler.sp_save_trend_data TO 'your_user'@'%';
GRANT EXECUTE ON PROCEDURE keyword_crawler.sp_get_trend_history TO 'your_user'@'%';
GRANT EXECUTE ON PROCEDURE keyword_crawler.sp_analyze_trends TO 'your_user'@'%';
GRANT EXECUTE ON PROCEDURE keyword_crawler.sp_trend_summary TO 'your_user'@'%';

-- Add sample trend data
INSERT INTO keyword_trends (keyword, trend_value, trend_date, region)
VALUES 
    ('test keyword', 65, CURRENT_DATE, 'US'),
    ('another test', 45, CURRENT_DATE, 'US');

-- Create table for trend technical analysis
CREATE TABLE keyword_trend_analysis (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(255) NOT NULL,
    trend_date DATE NOT NULL,
    region VARCHAR(50) NOT NULL,
    trend_value INT NOT NULL,
    
    -- Moving Averages
    sma_5 DECIMAL(10,2),  -- 5-day Simple Moving Average
    sma_10 DECIMAL(10,2), -- 10-day Simple Moving Average
    ema_5 DECIMAL(10,2),  -- 5-day Exponential Moving Average
    ema_10 DECIMAL(10,2), -- 10-day Exponential Moving Average
    
    -- Trend Indicators
    rsi_14 DECIMAL(10,2), -- 14-day Relative Strength Index
    macd DECIMAL(10,2),   -- Moving Average Convergence Divergence
    macd_signal DECIMAL(10,2), -- MACD Signal Line
    macd_histogram DECIMAL(10,2), -- MACD Histogram
    
    -- Volatility Indicators
    bollinger_upper DECIMAL(10,2), -- Bollinger Band Upper
    bollinger_middle DECIMAL(10,2), -- Bollinger Band Middle
    bollinger_lower DECIMAL(10,2), -- Bollinger Band Lower
    
    -- Momentum Indicators
    momentum_10 DECIMAL(10,2), -- 10-day Momentum
    roc_10 DECIMAL(10,2),      -- 10-day Rate of Change
    
    -- Trend Direction
    trend_direction ENUM('STRONG_UP', 'UP', 'SIDEWAYS', 'DOWN', 'STRONG_DOWN'),
    
    -- Support and Resistance
    support_level DECIMAL(10,2),
    resistance_level DECIMAL(10,2),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_keyword_date (keyword, trend_date),
    INDEX idx_trend_direction (trend_direction),
    UNIQUE KEY uk_keyword_date_region (keyword, trend_date, region)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create view for trend analysis with technical indicators
CREATE OR REPLACE VIEW vw_keyword_trend_technical AS
SELECT 
    k.keyword,
    k.search_volume,
    k.kgr,
    ta.*,
    CASE 
        WHEN ta.trend_direction = 'STRONG_UP' AND k.kgr < 0.25 THEN 'STRONG_BUY'
        WHEN ta.trend_direction = 'UP' AND k.kgr < 0.5 THEN 'BUY'
        WHEN ta.trend_direction = 'SIDEWAYS' THEN 'HOLD'
        ELSE 'MONITOR'
    END as action_signal,
    CASE
        WHEN ta.rsi_14 > 70 THEN 'Overbought'
        WHEN ta.rsi_14 < 30 THEN 'Oversold'
        ELSE 'Neutral'
    END as rsi_signal,
    CASE
        WHEN ta.macd > ta.macd_signal THEN 'Bullish'
        ELSE 'Bearish'
    END as macd_signal
FROM keyword_results k
JOIN keyword_trend_analysis ta ON k.keyword = ta.keyword
WHERE ta.trend_date = (
    SELECT MAX(trend_date) 
    FROM keyword_trend_analysis 
    WHERE keyword = k.keyword
);

-- Stored procedures for technical analysis
DELIMITER //

-- Calculate technical indicators for a keyword
CREATE PROCEDURE sp_calculate_technical_indicators(
    IN p_keyword VARCHAR(255),
    IN p_region VARCHAR(50),
    IN p_start_date DATE,
    IN p_end_date DATE
)
BEGIN
    -- Temporary table for calculations
    CREATE TEMPORARY TABLE IF NOT EXISTS temp_calculations (
        trend_date DATE,
        trend_value INT,
        sma_5 DECIMAL(10,2),
        sma_10 DECIMAL(10,2),
        ema_5 DECIMAL(10,2),
        ema_10 DECIMAL(10,2),
        rsi_14 DECIMAL(10,2),
        macd DECIMAL(10,2),
        macd_signal DECIMAL(10,2),
        macd_histogram DECIMAL(10,2)
    );

    -- Calculate SMAs
    INSERT INTO temp_calculations (trend_date, trend_value, sma_5, sma_10)
    SELECT 
        t1.trend_date,
        t1.trend_value,
        (
            SELECT AVG(t2.trend_value)
            FROM keyword_trends t2
            WHERE t2.keyword = t1.keyword
            AND t2.trend_date <= t1.trend_date
            AND t2.trend_date > DATE_SUB(t1.trend_date, INTERVAL 5 DAY)
        ) as sma_5,
        (
            SELECT AVG(t2.trend_value)
            FROM keyword_trends t2
            WHERE t2.keyword = t1.keyword
            AND t2.trend_date <= t1.trend_date
            AND t2.trend_date > DATE_SUB(t1.trend_date, INTERVAL 10 DAY)
        ) as sma_10
    FROM keyword_trends t1
    WHERE 
        t1.keyword = p_keyword
        AND t1.region = p_region
        AND t1.trend_date BETWEEN p_start_date AND p_end_date;

    -- Update trend analysis table
    INSERT INTO keyword_trend_analysis (
        keyword,
        trend_date,
        region,
        trend_value,
        sma_5,
        sma_10,
        trend_direction
    )
    SELECT 
        p_keyword,
        tc.trend_date,
        p_region,
        tc.trend_value,
        tc.sma_5,
        tc.sma_10,
        CASE
            WHEN tc.sma_5 > tc.sma_10 AND 
                 tc.trend_value > tc.sma_5 THEN 'STRONG_UP'
            WHEN tc.sma_5 > tc.sma_10 THEN 'UP'
            WHEN tc.sma_5 < tc.sma_10 AND 
                 tc.trend_value < tc.sma_5 THEN 'STRONG_DOWN'
            WHEN tc.sma_5 < tc.sma_10 THEN 'DOWN'
            ELSE 'SIDEWAYS'
        END
    FROM temp_calculations tc
    ON DUPLICATE KEY UPDATE
        trend_value = tc.trend_value,
        sma_5 = tc.sma_5,
        sma_10 = tc.sma_10,
        updated_at = CURRENT_TIMESTAMP;

    DROP TEMPORARY TABLE IF EXISTS temp_calculations;
END //

-- Get trend patterns
CREATE PROCEDURE sp_get_trend_patterns(
    IN p_min_trend_value INT,
    IN p_region VARCHAR(50)
)
BEGIN
    SELECT 
        k.keyword,
        k.search_volume,
        k.kgr,
        ta.trend_value,
        ta.trend_direction,
        ta.sma_5,
        ta.sma_10,
        ta.rsi_14,
        ta.macd,
        ta.macd_signal,
        CASE 
            WHEN ta.trend_direction = 'STRONG_UP' AND k.kgr < 0.25 THEN 'STRONG_BUY'
            WHEN ta.trend_direction = 'UP' AND k.kgr < 0.5 THEN 'BUY'
            WHEN ta.trend_direction = 'SIDEWAYS' THEN 'HOLD'
            ELSE 'MONITOR'
        END as recommendation
    FROM keyword_results k
    JOIN keyword_trend_analysis ta ON k.keyword = ta.keyword
    WHERE 
        ta.trend_value >= p_min_trend_value
        AND ta.region = p_region
        AND ta.trend_date = (
            SELECT MAX(trend_date) 
            FROM keyword_trend_analysis 
            WHERE keyword = k.keyword
        )
    ORDER BY 
        CASE ta.trend_direction
            WHEN 'STRONG_UP' THEN 1
            WHEN 'UP' THEN 2
            WHEN 'SIDEWAYS' THEN 3
            WHEN 'DOWN' THEN 4
            WHEN 'STRONG_DOWN' THEN 5
        END,
        ta.trend_value DESC;
END //

-- Find breakout keywords
CREATE PROCEDURE sp_find_breakout_keywords(
    IN p_region VARCHAR(50),
    IN p_days_lookback INT
)
BEGIN
    SELECT 
        k.keyword,
        k.search_volume,
        k.kgr,
        ta.trend_value,
        ta.trend_direction,
        ta.bollinger_upper,
        ta.bollinger_middle,
        ta.bollinger_lower,
        CASE
            WHEN ta.trend_value > ta.bollinger_upper 
                 AND ta.trend_direction IN ('STRONG_UP', 'UP') THEN 'Breakout Up'
            WHEN ta.trend_value < ta.bollinger_lower 
                 AND ta.trend_direction IN ('STRONG_DOWN', 'DOWN') THEN 'Breakout Down'
            ELSE 'Normal Range'
        END as breakout_status
    FROM keyword_results k
    JOIN keyword_trend_analysis ta ON k.keyword = ta.keyword
    WHERE 
        ta.region = p_region
        AND ta.trend_date >= DATE_SUB(CURRENT_DATE, INTERVAL p_days_lookback DAY)
        AND ta.trend_date = (
            SELECT MAX(trend_date) 
            FROM keyword_trend_analysis 
            WHERE keyword = k.keyword
        )
    HAVING breakout_status IN ('Breakout Up', 'Breakout Down')
    ORDER BY ta.trend_value DESC;
END //

DELIMITER ;

-- Grant permissions
GRANT EXECUTE ON PROCEDURE keyword_crawler.sp_calculate_technical_indicators TO 'your_user'@'%';
GRANT EXECUTE ON PROCEDURE keyword_crawler.sp_get_trend_patterns TO 'your_user'@'%';
GRANT EXECUTE ON PROCEDURE keyword_crawler.sp_find_breakout_keywords TO 'your_user'@'%';

-- Add sample technical analysis data
INSERT INTO keyword_trend_analysis (
    keyword, 
    trend_date, 
    region, 
    trend_value, 
    sma_5, 
    sma_10, 
    trend_direction
)
VALUES 
    ('test keyword', CURRENT_DATE, 'US', 65, 63, 60, 'UP'),
    ('another test', CURRENT_DATE, 'US', 45, 47, 50, 'DOWN');



