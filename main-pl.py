from playwright.sync_api import sync_playwright
import csv
import os
import sys
from typing import List, Dict
import re

def fetch_keywords(input_csv_path: str = None, input_keywords: str = None) -> List[str]:
    """Fetch keywords from either a CSV file or from the input string."""
    keywords = []
    
    # If a CSV file path is provided, parse the CSV
    if input_csv_path and os.path.exists(input_csv_path):
        with open(input_csv_path, 'r', encoding='utf-8') as file:
            reader = csv.reader(file)
            keywords.extend([item for sublist in reader for item in sublist])
    
    # If keywords are provided as a string, split by commas
    if input_keywords:
        keywords.extend([k.strip() for k in input_keywords.split(',')])
    
    # Remove empty strings and duplicates
    return [k for k in keywords if k]

def start_crawler(keywords: List[str], id: str) -> None:
    """Start the crawler and process keywords."""
    results = []
    retry_list = []
    
    with sync_playwright() as p:
        browser = p.firefox.launch(headless=True)
        page = browser.new_page()
        
        # Loop through keywords and start scraping
        for keyword in keywords:
            try:
                # Open search URL
                page.goto(f'https://www.google.com/search?q=intitle%3A%22{keyword}%22')
                
                # Wait for Google's result stats
                visible = page.locator('#result-stats').is_visible()
                if not visible:
                    print('There is no stats showing at all')
                    continue
                
                t = page.locator('#result-stats').all_text_contents()
                print('========', t)
                
                # Extract result count
                result_stats = page.locator('#result-stats').text_content()
                match = re.search(r'About ([\d,]+) results', result_stats)
                count = int(match.group(1).replace(',', '')) if match else 0
                
                results.append({
                    'keyword': keyword,
                    'searchType': 'intitle',
                    'count': count
                })
                print(f'Keyword: "{keyword}", Type: "intitle", Count: {count}')
                
            except Exception as error:
                print(f'Error for "{keyword}": {str(error)}')
                retry_list.append(keyword)
        
        # Retry failed requests
        if retry_list:
            print(f'Retrying {len(retry_list)} failed keywords...')
            for keyword in retry_list:
                try:
                    page.goto(f'https://www.google.com/search?q=intitle%3A%22{keyword}%22')
                    page.wait_for_selector('#result-stats', timeout=10000)
                    result_stats = page.locator('#result-stats').text_content()
                    match = re.search(r'About ([\d,]+) results', result_stats)
                    count = int(match.group(1).replace(',', '')) if match else 0
                    
                    results.append({
                        'keyword': keyword,
                        'searchType': 'intitle',
                        'count': count
                    })
                    print(f'Retrying Keyword: "{keyword}", Type: "intitle", Count: {count}')
                    
                except Exception as error:
                    print(f'Error retrying "{keyword}": {str(error)}')
        
        browser.close()
    
    # Save results as CSV
    result_path = os.path.join(os.path.dirname(__file__), 'results', f'{id}.csv')
    os.makedirs(os.path.dirname(result_path), exist_ok=True)
    
    with open(result_path, 'w', newline='', encoding='utf-8') as file:
        writer = csv.DictWriter(file, fieldnames=['keyword', 'searchType', 'count'])
        writer.writeheader()
        writer.writerows(results)
    
    print(f'Results saved to {result_path}')

def main():
    """Main function to run the crawler."""
    # Get command line arguments
    args = sys.argv[1:]
    if len(args) < 1:
        print('Error: ID is required to save the results.')
        sys.exit(1)
    
    id = args[0]
    input_keywords = args[1] if len(args) > 1 else None
    input_csv_path = args[2] if len(args) > 2 else None
    
    print(f'Starting crawler with ID: {id}')
    
    keywords = fetch_keywords(input_csv_path, input_keywords)
    if not keywords:
        print('No keywords provided. Exiting...')
        sys.exit(1)
    
    print(f'Fetched Keywords: {", ".join(keywords)}')
    start_crawler(keywords, id)

if __name__ == '__main__':
    main()
