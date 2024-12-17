import os
import csv
from DrissionPage import Chromium
import requests
from time import sleep

# Fetch keywords either from a CSV file or a comma-separated string
def fetch_keywords(input_csv_path, input_keywords):
    keywords = []

    # If a CSV file path is provided, parse the CSV
    if input_csv_path and os.path.exists(input_csv_path):
        with open(input_csv_path, 'r', encoding='utf-8') as file:
            reader = csv.reader(file)
            keywords = [row[0] for row in reader]

    # If keywords are provided as a string, split by commas
    if input_keywords:
        keywords.extend(input_keywords.split(','))
    
    return [keyword.strip() for keyword in keywords if keyword.strip()]

# Start crawling using DrissionPage to scrape the search results count from Google
async def start_crawler(keywords, id):
    results = []
    retry_list = []

    # Initialize Drission for browser control (with Firefox by default)
    browser = Chromium()


    for keyword in keywords:
        for search_type in ['intitle', 'allintitle']:
            url = f"https://www.google.com/search?q={search_type}%3A%22{requests.utils.quote(keyword)}%22"
            try:
                # Fetch page content using Drission
                page = await browser.get(url)

                # Extract result stats from the page content
                result_stats = page.ele('#result-stats')

                match = None
                if "About" in result_stats:
                    match = result_stats.split('About')[1].split("results")[0].strip()
                count = int(match.replace(',', '')) if match else 0

                # Log the results
                results.append({"keyword": keyword, "search_type": search_type, "count": count})
                print(f'Keyword: "{keyword}", Type: "{search_type}", Count: {count}')
            
            except Exception as e:
                print(f"Error for '{keyword}' ({search_type}): {str(e)}")
                retry_list.append({"keyword": keyword, "search_type": search_type})  # Retry failed requests
    
    # Retry failed requests
    if retry_list:
        print(f"Retrying {len(retry_list)} failed requests...")
        for item in retry_list:
            keyword = item['keyword']
            search_type = item['search_type']
            url = f"https://www.google.com/search?q={search_type}%3A%22{requests.utils.quote(keyword)}%22"
            try:
                page = await drission.get(url)
                result_stats = page.text()
                match = None
                if "About" in result_stats:
                    match = result_stats.split('About')[1].split("results")[0].strip()
                count = int(match.replace(',', '')) if match else 0
                results.append({"keyword": keyword, "search_type": search_type, "count": count})
                print(f"Retried Keyword: '{keyword}', Type: '{search_type}', Count: {count}")
            except Exception as e:
                print(f"Error retrying '{keyword}' ({search_type}): {str(e)}")

    # Save results as CSV
    result_path = os.path.join('results', f'{id}.csv')
    os.makedirs(os.path.dirname(result_path), exist_ok=True)

    with open(result_path, 'w', newline='', encoding='utf-8') as file:
        writer = csv.DictWriter(file, fieldnames=["keyword", "search_type", "count"])
        writer.writeheader()
        writer.writerows(results)

    print(f"Results saved to {result_path}")

# Main function to handle the command line input and orchestrate the crawler execution
async def main():
    import sys
    if len(sys.argv) < 4:
        print("Usage: python script.py <id> <input_keywords> <input_csv_path>")
        return

    id = sys.argv[1]
    input_keywords = sys.argv[2]
    input_csv_path = sys.argv[3] if len(sys.argv) > 3 else None

    print(f"Starting crawler with ID: {id}")
    keywords = fetch_keywords(input_csv_path, input_keywords)

    if not keywords:
        print("No keywords provided. Exiting...")
        return

    print(f"Fetched Keywords: {', '.join(keywords)}")
    await start_crawler(keywords, id)

# Run the main function
if __name__ == '__main__':
    import asyncio
    asyncio.run(main())
