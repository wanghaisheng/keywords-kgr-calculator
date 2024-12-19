-- Create table for data sources configuration
CREATE TABLE data_sources (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source_name VARCHAR(50) NOT NULL UNIQUE,
    priority INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_priority (priority),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create table for keyword metrics from different sources
CREATE TABLE keyword_metrics (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(255) NOT NULL,
    source_id INT NOT NULL,
    search_volume INT,
    difficulty_score DECIMAL(5,2),
    cpc DECIMAL(10,2),
    competition DECIMAL(5,2),
    recorded_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES data_sources(id),
    UNIQUE KEY uk_keyword_source_date (keyword, source_id, recorded_date),
    INDEX idx_keyword (keyword),
    INDEX idx_recorded_date (recorded_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create view for aggregated metrics
CREATE OR REPLACE VIEW vw_aggregated_metrics AS
SELECT 
    km.keyword,
    ROUND(AVG(km.search_volume)) as avg_search_volume,
    ROUND(AVG(km.difficulty_score), 2) as avg_difficulty,
    ROUND(AVG(km.cpc), 2) as avg_cpc,
    ROUND(AVG(km.competition), 2) as avg_competition,
    JSON_ARRAYAGG(
        JSON_OBJECT(
            'source', ds.source_name,
            'search_volume', km.search_volume,
            'difficulty', km.difficulty_score
        )
    ) as source_details,
    km.recorded_date
FROM keyword_metrics km
JOIN data_sources ds ON km.source_id = ds.id
WHERE ds.is_active = TRUE
GROUP BY km.keyword, km.recorded_date;

-- Create procedure to add/update metrics from a source
DELIMITER //
CREATE PROCEDURE sp_update_keyword_metrics(
    IN p_keyword VARCHAR(255),
    IN p_source_name VARCHAR(50),
    IN p_search_volume INT,
    IN p_difficulty_score DECIMAL(5,2),
    IN p_cpc DECIMAL(10,2),
    IN p_competition DECIMAL(5,2)
)
BEGIN
    DECLARE v_source_id INT;
    
    -- Get source ID
    SELECT id INTO v_source_id 
    FROM data_sources 
    WHERE source_name = p_source_name;
    
    -- Insert or update metrics
    INSERT INTO keyword_metrics (
        keyword,
        source_id,
        search_volume,
        difficulty_score,
        cpc,
        competition,
        recorded_date
    )
    VALUES (
        p_keyword,
        v_source_id,
        p_search_volume,
        p_difficulty_score,
        p_cpc,
        p_competition,
        CURRENT_DATE
    )
    ON DUPLICATE KEY UPDATE
        search_volume = p_search_volume,
        difficulty_score = p_difficulty_score,
        cpc = p_cpc,
        competition = p_competition,
        updated_at = CURRENT_TIMESTAMP;
END //

-- Create procedure to get metrics with source filtering
CREATE PROCEDURE sp_get_keyword_metrics(
    IN p_keyword VARCHAR(255),
    IN p_source_name VARCHAR(50) -- NULL for aggregated metrics
)
BEGIN
    IF p_source_name IS NULL THEN
        -- Return aggregated metrics
        SELECT * FROM vw_aggregated_metrics
        WHERE keyword = p_keyword;
    ELSE
        -- Return metrics from specific source
        SELECT 
            km.*,
            ds.source_name
        FROM keyword_metrics km
        JOIN data_sources ds ON km.source_id = ds.id
        WHERE km.keyword = p_keyword
        AND ds.source_name = p_source_name;
    END IF;
END //
DELIMITER ;

-- Insert sample data sources
INSERT INTO data_sources (source_name, priority) VALUES 
('ahrefs', 1),
('semrush', 2),
('spyfu', 3),
('google', 4);

-- Create procedure to calculate KGR using preferred source
DELIMITER //
CREATE PROCEDURE sp_calculate_kgr(
    IN p_preferred_source VARCHAR(50) -- NULL for using average
)
BEGIN
    WITH keyword_volumes AS (
        SELECT 
            kr.keyword,
            kr.count,
            CASE 
                WHEN p_preferred_source IS NOT NULL THEN
                    (SELECT search_volume 
                     FROM keyword_metrics km
                     JOIN data_sources ds ON km.source_id = ds.id
                     WHERE km.keyword = kr.keyword 
                     AND ds.source_name = p_preferred_source
                     ORDER BY km.recorded_date DESC
                     LIMIT 1)
                ELSE
                    (SELECT ROUND(AVG(search_volume))
                     FROM keyword_metrics km
                     WHERE km.keyword = kr.keyword
                     AND km.recorded_date = (
                         SELECT MAX(recorded_date)
                         FROM keyword_metrics
                         WHERE keyword = kr.keyword
                     ))
            END as search_volume
        FROM keyword_results kr
    )
    SELECT 
        kv.keyword,
        kv.count,
        kv.search_volume,
        CASE 
            WHEN kv.search_volume > 0 
            THEN ROUND(kv.count / kv.search_volume, 4)
            ELSE 0 
        END as kgr,
        CASE 
            WHEN kv.search_volume = 0 THEN 'NO_VOLUME'
            WHEN kv.count / kv.search_volume < 0.25 THEN 'BUY'
            WHEN kv.count / kv.search_volume <= 1 THEN 'CONSIDER'
            ELSE 'IGNORE'
        END as kgr_status
    FROM keyword_volumes kv;
END //
DELIMITER ;


-- Create table for Google Trends data
CREATE TABLE keyword_trends (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(255) NOT NULL,
    trend_value INT NOT NULL,
    trend_date DATE NOT NULL,
    time_range VARCHAR(20) DEFAULT '12m', -- e.g., '12m', '30d', '7d'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_keyword_date (keyword, trend_date),
    INDEX idx_keyword (keyword),
    INDEX idx_trend_date (trend_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //

-- Procedure to update/insert trend data
CREATE PROCEDURE sp_update_trend_data(
    IN p_keyword VARCHAR(255),
    IN p_trend_value INT,
    IN p_trend_date DATE,
    IN p_time_range VARCHAR(20)
)
BEGIN
    INSERT INTO keyword_trends (
        keyword,
        trend_value,
        trend_date,
        time_range
    )
    VALUES (
        p_keyword,
        p_trend_value,
        p_trend_date,
        IFNULL(p_time_range, '12m')
    )
    ON DUPLICATE KEY UPDATE
        trend_value = p_trend_value,
        time_range = IFNULL(p_time_range, time_range),
        updated_at = CURRENT_TIMESTAMP;
END //

-- Procedure to bulk update trend data
CREATE PROCEDURE sp_bulk_update_trends(
    IN p_keyword VARCHAR(255),
    IN p_trend_data JSON
)
BEGIN
    DECLARE i INT DEFAULT 0;
    DECLARE array_length INT;
    
    SET array_length = JSON_LENGTH(p_trend_data);
    
    WHILE i < array_length DO
        INSERT INTO keyword_trends (
            keyword,
            trend_value,
            trend_date,
            time_range
        )
        VALUES (
            p_keyword,
            JSON_EXTRACT(p_trend_data, CONCAT('$[', i, '].value')),
            DATE(JSON_EXTRACT(p_trend_data, CONCAT('$[', i, '].date'))),
            JSON_EXTRACT(p_trend_data, CONCAT('$[', i, '].timeRange'))
        )
        ON DUPLICATE KEY UPDATE
            trend_value = VALUES(trend_value),
            time_range = VALUES(time_range),
            updated_at = CURRENT_TIMESTAMP;
            
        SET i = i + 1;
    END WHILE;
END //

-- Procedure to get trend history
CREATE PROCEDURE sp_get_trend_history(
    IN p_keyword VARCHAR(255),
    IN p_start_date DATE,
    IN p_end_date DATE
)
BEGIN
    SELECT 
        keyword,
        trend_value,
        trend_date,
        time_range,
        created_at,
        updated_at
    FROM keyword_trends
    WHERE 
        keyword = p_keyword
        AND trend_date BETWEEN p_start_date AND p_end_date
    ORDER BY trend_date;
END //

-- Procedure to get latest trend value
CREATE PROCEDURE sp_get_latest_trend(
    IN p_keyword VARCHAR(255)
)
BEGIN
    SELECT 
        keyword,
        trend_value,
        trend_date,
        time_range
    FROM keyword_trends
    WHERE 
        keyword = p_keyword
        AND trend_date = (
            SELECT MAX(trend_date)
            FROM keyword_trends
            WHERE keyword = p_keyword
        );
END //

DELIMITER ;

-- Create table for monthly search volumes
CREATE TABLE search_volume_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(255) NOT NULL,
    source ENUM('google', 'ahrefs', 'spyfu') NOT NULL,
    volume INT NOT NULL,
    month_date DATE NOT NULL, -- First day of each month
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_keyword_source_month (keyword, source, month_date),
    INDEX idx_keyword (keyword),
    INDEX idx_month (month_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create table for technical analysis results
CREATE TABLE search_volume_analysis (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(255) NOT NULL,
    source ENUM('google', 'ahrefs', 'spyfu') NOT NULL,
    analysis_date DATE NOT NULL,
    
    -- Moving Averages
    sma_3 DECIMAL(10,2),  -- 3-month Simple Moving Average
    sma_6 DECIMAL(10,2),  -- 6-month Simple Moving Average
    ema_3 DECIMAL(10,2),  -- 3-month Exponential Moving Average
    ema_6 DECIMAL(10,2),  -- 6-month Exponential Moving Average
    
    -- Trend Indicators
    rsi_14 DECIMAL(10,2), -- 14-period Relative Strength Index
    macd_line DECIMAL(10,2), -- MACD Line
    macd_signal DECIMAL(10,2), -- MACD Signal Line
    macd_histogram DECIMAL(10,2), -- MACD Histogram
    
    -- Volatility Indicators
    bollinger_upper DECIMAL(10,2),
    bollinger_middle DECIMAL(10,2),
    bollinger_lower DECIMAL(10,2),
    
    -- Volume Analysis
    volume_change_pct DECIMAL(10,2), -- Month-over-month change
    volume_sma_ratio DECIMAL(10,2),  -- Current volume / SMA ratio
    
    -- Trend Direction
    trend_direction ENUM('STRONG_UP', 'UP', 'SIDEWAYS', 'DOWN', 'STRONG_DOWN'),
    
    -- Support and Resistance
    support_level DECIMAL(10,2),
    resistance_level DECIMAL(10,2),
    
    -- Signals
    buy_signal BOOLEAN,
    sell_signal BOOLEAN,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_keyword_source_date (keyword, source, analysis_date),
    INDEX idx_keyword (keyword),
    INDEX idx_analysis_date (analysis_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create stored procedures for analysis
DELIMITER //

-- Calculate technical indicators
CREATE PROCEDURE sp_calculate_technical_indicators(
    IN p_keyword VARCHAR(255),
    IN p_source ENUM('google', 'ahrefs', 'spyfu'),
    IN p_analysis_date DATE
)
BEGIN
    DECLARE v_sma_3, v_sma_6, v_ema_3, v_ema_6 DECIMAL(10,2);
    DECLARE v_current_volume, v_prev_volume INT;
    DECLARE v_rsi, v_macd, v_signal DECIMAL(10,2);
    
    -- Calculate SMAs
    SELECT 
        AVG(volume) INTO v_sma_3
    FROM (
        SELECT volume 
        FROM search_volume_history
        WHERE keyword = p_keyword
        AND source = p_source
        AND month_date <= p_analysis_date
        ORDER BY month_date DESC
        LIMIT 3
    ) t;
    
    SELECT 
        AVG(volume) INTO v_sma_6
    FROM (
        SELECT volume 
        FROM search_volume_history
        WHERE keyword = p_keyword
        AND source = p_source
        AND month_date <= p_analysis_date
        ORDER BY month_date DESC
        LIMIT 6
    ) t;
    
    -- Get current and previous volume
    SELECT 
        volume INTO v_current_volume
    FROM search_volume_history
    WHERE keyword = p_keyword
    AND source = p_source
    AND month_date = p_analysis_date;
    
    SELECT 
        volume INTO v_prev_volume
    FROM search_volume_history
    WHERE keyword = p_keyword
    AND source = p_source
    AND month_date = DATE_SUB(p_analysis_date, INTERVAL 1 MONTH);
    
    -- Calculate RSI
    -- (Simplified calculation for example)
    SET v_rsi = 100 - (100 / (1 + (
        SELECT AVG(CASE WHEN volume > LAG(volume) OVER (ORDER BY month_date) 
                       THEN volume - LAG(volume) OVER (ORDER BY month_date)
                       ELSE 0 END) /
        NULLIF(AVG(CASE WHEN volume < LAG(volume) OVER (ORDER BY month_date)
                       THEN LAG(volume) OVER (ORDER BY month_date) - volume
                       ELSE 0 END), 0)
        FROM search_volume_history
        WHERE keyword = p_keyword
        AND source = p_source
        AND month_date <= p_analysis_date
        ORDER BY month_date DESC
        LIMIT 14
    )));
    
    -- Insert analysis results
    INSERT INTO search_volume_analysis (
        keyword,
        source,
        analysis_date,
        sma_3,
        sma_6,
        rsi_14,
        volume_change_pct,
        trend_direction,
        buy_signal,
        sell_signal
    )
    VALUES (
        p_keyword,
        p_source,
        p_analysis_date,
        v_sma_3,
        v_sma_6,
        v_rsi,
        ((v_current_volume - v_prev_volume) / v_prev_volume) * 100,
        CASE
            WHEN v_current_volume > v_sma_3 AND v_sma_3 > v_sma_6 THEN 'STRONG_UP'
            WHEN v_current_volume > v_sma_3 THEN 'UP'
            WHEN v_current_volume < v_sma_3 AND v_sma_3 < v_sma_6 THEN 'STRONG_DOWN'
            WHEN v_current_volume < v_sma_3 THEN 'DOWN'
            ELSE 'SIDEWAYS'
        END,
        v_current_volume > v_sma_3 AND v_rsi < 70,
        v_current_volume < v_sma_3 AND v_rsi > 30
    )
    ON DUPLICATE KEY UPDATE
        sma_3 = v_sma_3,
        sma_6 = v_sma_6,
        rsi_14 = v_rsi,
        volume_change_pct = ((v_current_volume - v_prev_volume) / v_prev_volume) * 100,
        trend_direction = CASE
            WHEN v_current_volume > v_sma_3 AND v_sma_3 > v_sma_6 THEN 'STRONG_UP'
            WHEN v_current_volume > v_sma_3 THEN 'UP'
            WHEN v_current_volume < v_sma_3 AND v_sma_3 < v_sma_6 THEN 'STRONG_DOWN'
            WHEN v_current_volume < v_sma_3 THEN 'DOWN'
            ELSE 'SIDEWAYS'
        END,
        buy_signal = v_current_volume > v_sma_3 AND v_rsi < 70,
        sell_signal = v_current_volume < v_sma_3 AND v_rsi > 30;
END //

-- Get trend analysis
CREATE PROCEDURE sp_get_trend_analysis(
    IN p_keyword VARCHAR(255),
    IN p_source ENUM('google', 'ahrefs', 'spyfu')
)
BEGIN
    SELECT 
        h.keyword,
        h.source,
        h.month_date,
        h.volume,
        a.sma_3,
        a.sma_6,
        a.rsi_14,
        a.trend_direction,
        a.volume_change_pct,
        CASE
            WHEN a.trend_direction IN ('STRONG_UP', 'UP') 
            AND a.rsi_14 < 70 THEN 'Potential Growth'
            WHEN a.trend_direction IN ('STRONG_DOWN', 'DOWN') 
            AND a.rsi_14 > 30 THEN 'Potential Bottom'
            ELSE 'Neutral'
        END as opportunity_signal,
        a.buy_signal,
        a.sell_signal
    FROM search_volume_history h
    JOIN search_volume_analysis a ON 
        h.keyword = a.keyword 
        AND h.source = a.source 
        AND h.month_date = a.analysis_date
    WHERE h.keyword = p_keyword
    AND h.source = p_source
    ORDER BY h.month_date DESC
    LIMIT 12;
END //

-- Find trending keywords
CREATE PROCEDURE sp_find_trending_keywords(
    IN p_source ENUM('google', 'ahrefs', 'spyfu'),
    IN p_min_volume INT
)
BEGIN
    SELECT 
        h.keyword,
        h.volume as current_volume,
        a.sma_3,
        a.sma_6,
        a.trend_direction,
        a.volume_change_pct,
        CASE
            WHEN a.trend_direction IN ('STRONG_UP', 'UP') 
            AND a.rsi_14 < 70 THEN 'Growth Opportunity'
            WHEN a.trend_direction = 'SIDEWAYS' 
            AND h.volume > a.sma_6 THEN 'Breakout Potential'
            ELSE 'Monitor'
        END as recommendation
    FROM search_volume_history h
    JOIN search_volume_analysis a ON 
        h.keyword = a.keyword 
        AND h.source = a.source 
        AND h.month_date = a.analysis_date
    WHERE h.source = p_source
    AND h.volume >= p_min_volume
    AND h.month_date = (
        SELECT MAX(month_date) 
        FROM search_volume_history
        WHERE source = p_source
    )
    AND a.trend_direction IN ('STRONG_UP', 'UP', 'SIDEWAYS')
    ORDER BY a.volume_change_pct DESC;
END //

DELIMITER ;

-- Create view for keyword opportunities
CREATE OR REPLACE VIEW vw_keyword_opportunities AS
SELECT 
    h.keyword,
    h.source,
    h.volume as current_volume,
    a.sma_3,
    a.sma_6,
    a.rsi_14,
    a.trend_direction,
    a.volume_change_pct,
    CASE
        WHEN a.trend_direction IN ('STRONG_UP', 'UP') 
        AND a.rsi_14 < 70 THEN 'Strong Buy'
        WHEN a.trend_direction = 'SIDEWAYS' 
        AND h.volume > a.sma_6 THEN 'Buy'
        WHEN a.trend_direction IN ('STRONG_DOWN', 'DOWN') 
        AND a.rsi_14 > 70 THEN 'Sell'
        ELSE 'Hold'
    END as signal,
    h.month_date
FROM search_volume_history h
JOIN search_volume_analysis a ON 
    h.keyword = a.keyword 
    AND h.source = a.source 
    AND h.month_date = a.analysis_date
WHERE h.month_date = (
    SELECT MAX(month_date) 
    FROM search_volume_history
);

-- Create table for technical analysis of trends
CREATE TABLE trend_technical_analysis (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(255) NOT NULL,
    analysis_date DATE NOT NULL,
    time_range VARCHAR(20) NOT NULL, -- e.g., '12m', '30d', etc.
    
    -- Price Action (using trend_value as "price")
    trend_value INT NOT NULL,
    prev_value INT,
    change_pct DECIMAL(10,2),
    
    -- Moving Averages
    sma_7 DECIMAL(10,2),   -- 7-day Simple Moving Average
    sma_14 DECIMAL(10,2),  -- 14-day SMA
    sma_30 DECIMAL(10,2),  -- 30-day SMA
    ema_7 DECIMAL(10,2),   -- 7-day Exponential Moving Average
    
    -- Momentum Indicators
    rsi_14 DECIMAL(10,2),  -- 14-day Relative Strength Index
    macd DECIMAL(10,2),    -- MACD (12,26)
    macd_signal DECIMAL(10,2), -- 9-day MACD Signal
    
    -- Trend Indicators
    trend_direction ENUM('STRONG_UP', 'UP', 'SIDEWAYS', 'DOWN', 'STRONG_DOWN'),
    
    -- Signals
    buy_signal BOOLEAN,
    sell_signal BOOLEAN,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_keyword_date_range (keyword, analysis_date, time_range),
    INDEX idx_keyword (keyword),
    INDEX idx_analysis_date (analysis_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //

-- Calculate technical indicators for trend data
CREATE PROCEDURE sp_analyze_trend_data(
    IN p_keyword VARCHAR(255),
    IN p_time_range VARCHAR(20),
    IN p_analysis_date DATE
)
BEGIN
    DECLARE v_trend_value, v_prev_value INT;
    DECLARE v_sma_7, v_sma_14, v_sma_30 DECIMAL(10,2);
    DECLARE v_rsi DECIMAL(10,2);
    
    -- Get current and previous trend values
    SELECT 
        trend_value, 
        LAG(trend_value) OVER (ORDER BY trend_date)
    INTO v_trend_value, v_prev_value
    FROM keyword_trends
    WHERE keyword = p_keyword
    AND time_range = p_time_range
    AND trend_date <= p_analysis_date
    ORDER BY trend_date DESC
    LIMIT 2;
    
    -- Calculate SMAs
    SELECT AVG(trend_value) INTO v_sma_7
    FROM (
        SELECT trend_value 
        FROM keyword_trends
        WHERE keyword = p_keyword
        AND time_range = p_time_range
        AND trend_date <= p_analysis_date
        ORDER BY trend_date DESC
        LIMIT 7
    ) t;
    
    SELECT AVG(trend_value) INTO v_sma_14
    FROM (
        SELECT trend_value 
        FROM keyword_trends
        WHERE keyword = p_keyword
        AND time_range = p_time_range
        AND trend_date <= p_analysis_date
        ORDER BY trend_date DESC
        LIMIT 14
    ) t;
    
    SELECT AVG(trend_value) INTO v_sma_30
    FROM (
        SELECT trend_value 
        FROM keyword_trends
        WHERE keyword = p_keyword
        AND time_range = p_time_range
        AND trend_date <= p_analysis_date
        ORDER BY trend_date DESC
        LIMIT 30
    ) t;
    
    -- Calculate RSI
    SET v_rsi = (
        SELECT 100 - (100 / (1 + (
            SUM(CASE WHEN daily_change > 0 THEN daily_change ELSE 0 END) /
            ABS(SUM(CASE WHEN daily_change < 0 THEN daily_change ELSE 0 END))
        )))
        FROM (
            SELECT 
                trend_value - LAG(trend_value) OVER (ORDER BY trend_date) as daily_change
            FROM keyword_trends
            WHERE keyword = p_keyword
            AND time_range = p_time_range
            AND trend_date <= p_analysis_date
            ORDER BY trend_date DESC
            LIMIT 14
        ) t
    );
    
    -- Insert analysis results
    INSERT INTO trend_technical_analysis (
        keyword,
        analysis_date,
        time_range,
        trend_value,
        prev_value,
        change_pct,
        sma_7,
        sma_14,
        sma_30,
        rsi_14,
        trend_direction,
        buy_signal,
        sell_signal
    )
    VALUES (
        p_keyword,
        p_analysis_date,
        p_time_range,
        v_trend_value,
        v_prev_value,
        CASE WHEN v_prev_value > 0 
             THEN ((v_trend_value - v_prev_value) / v_prev_value) * 100
             ELSE 0 
        END,
        v_sma_7,
        v_sma_14,
        v_sma_30,
        v_rsi,
        CASE
            WHEN v_trend_value > v_sma_7 AND v_sma_7 > v_sma_14 AND v_sma_14 > v_sma_30 
            THEN 'STRONG_UP'
            WHEN v_trend_value > v_sma_7 AND v_sma_7 > v_sma_14 
            THEN 'UP'
            WHEN v_trend_value < v_sma_7 AND v_sma_7 < v_sma_14 AND v_sma_14 < v_sma_30 
            THEN 'STRONG_DOWN'
            WHEN v_trend_value < v_sma_7 AND v_sma_7 < v_sma_14 
            THEN 'DOWN'
            ELSE 'SIDEWAYS'
        END,
        v_trend_value > v_sma_7 AND v_rsi < 70,
        v_trend_value < v_sma_7 AND v_rsi > 30
    )
    ON DUPLICATE KEY UPDATE
        trend_value = v_trend_value,
        prev_value = v_prev_value,
        change_pct = CASE WHEN v_prev_value > 0 
                         THEN ((v_trend_value - v_prev_value) / v_prev_value) * 100
                         ELSE 0 
                    END,
        sma_7 = v_sma_7,
        sma_14 = v_sma_14,
        sma_30 = v_sma_30,
        rsi_14 = v_rsi,
        trend_direction = CASE
            WHEN v_trend_value > v_sma_7 AND v_sma_7 > v_sma_14 AND v_sma_14 > v_sma_30 
            THEN 'STRONG_UP'
            WHEN v_trend_value > v_sma_7 AND v_sma_7 > v_sma_14 
            THEN 'UP'
            WHEN v_trend_value < v_sma_7 AND v_sma_7 < v_sma_14 AND v_sma_14 < v_sma_30 
            THEN 'STRONG_DOWN'
            WHEN v_trend_value < v_sma_7 AND v_sma_7 < v_sma_14 
            THEN 'DOWN'
            ELSE 'SIDEWAYS'
        END,
        buy_signal = v_trend_value > v_sma_7 AND v_rsi < 70,
        sell_signal = v_trend_value < v_sma_7 AND v_rsi > 30;
END //

-- Get trend analysis for a keyword
CREATE PROCEDURE sp_get_trend_analysis(
    IN p_keyword VARCHAR(255),
    IN p_time_range VARCHAR(20)
)
BEGIN
    SELECT 
        t.keyword,
        t.trend_date,
        t.trend_value,
        ta.sma_7,
        ta.sma_14,
        ta.sma_30,
        ta.rsi_14,
        ta.trend_direction,
        ta.change_pct,
        CASE
            WHEN ta.trend_direction IN ('STRONG_UP', 'UP') AND ta.rsi_14 < 70 
            THEN 'Rising Interest'
            WHEN ta.trend_direction IN ('STRONG_DOWN', 'DOWN') AND ta.rsi_14 > 30 
            THEN 'Declining Interest'
            WHEN ta.trend_direction = 'SIDEWAYS' AND t.trend_value > ta.sma_30 
            THEN 'Sustained Interest'
            ELSE 'Stable'
        END as interest_signal,
        ta.buy_signal,
        ta.sell_signal
    FROM keyword_trends t
    JOIN trend_technical_analysis ta ON 
        t.keyword = ta.keyword 
        AND t.trend_date = ta.analysis_date
        AND t.time_range = ta.time_range
    WHERE t.keyword = p_keyword
    AND t.time_range = p_time_range
    ORDER BY t.trend_date DESC;
END //

-- Find trending topics
CREATE PROCEDURE sp_find_trending_topics(
    IN p_min_trend_value INT,
    IN p_time_range VARCHAR(20)
)
BEGIN
    SELECT 
        t.keyword,
        t.trend_value as current_interest,
        ta.sma_7,
        ta.sma_30,
        ta.trend_direction,
        ta.change_pct,
        ta.rsi_14,
        CASE
            WHEN ta.trend_direction = 'STRONG_UP' AND ta.rsi_14 < 70 
            THEN 'Strong Trend'
            WHEN ta.trend_direction = 'UP' AND ta.change_pct > 10 
            THEN 'Emerging Trend'
            WHEN ta.trend_direction = 'SIDEWAYS' AND t.trend_value > ta.sma_30 
            THEN 'Sustained Interest'
            ELSE 'Monitor'
        END as trend_status
    FROM keyword_trends t
    JOIN trend_technical_analysis ta ON 
        t.keyword = ta.keyword 
        AND t.trend_date = ta.analysis_date
        AND t.time_range = ta.time_range
    WHERE t.trend_date = (
        SELECT MAX(trend_date) 
        FROM keyword_trends 
        WHERE time_range = p_time_range
    )
    AND t.time_range = p_time_range
    AND t.trend_value >= p_min_trend_value
    AND ta.trend_direction IN ('STRONG_UP', 'UP', 'SIDEWAYS')
    ORDER BY ta.change_pct DESC;
END //

DELIMITER ;



