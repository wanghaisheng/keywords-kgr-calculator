import sys
import json
import time
import os
import boto3
import re
from getbrowser import setup_chrome

def main(keywords):
    # Split keywords string into a list if it contains commas
    keywords = keywords.split(",") if "," in keywords else [keywords]
    
    results = []

    for keyword in keywords:
        results.append(perform_search(keyword.strip()))  # Ensure each keyword is stripped of leading/trailing spaces

    with open('results.json', 'w') as f:
        print('Results:', results)
        json.dump(results, f)

    upload_results_to_r2()

def perform_search(keyword):
    browser = setup_chrome()
    driver = browser.new_tab()

    # Perform the first search
    search_query = f'intitle:"{keyword}"'
    driver.get(f'https://www.google.com/search?q={search_query}')
    element = driver.ele('#result-stats')
    intitle_count = extract_count(element.text)

    # Perform the second search
    search_query = f'allintitle:"{keyword}"'
    driver.get(f'https://www.google.com/search?q={search_query}')
    element = driver.ele('#result-stats')
    allintitle_count = extract_count(element.text)

    driver.close()
    return {'keyword': keyword, 'intitle': intitle_count, 'allintitle': allintitle_count}

def extract_count(result_stats):
    # Use regex to find the number in the result stats text
    match = re.search(r'About ([\d,]+) results', result_stats)
    if match:
        return match.group(1).replace(',', '')  # Remove commas for easier processing
    return '0'

def upload_results_to_r2():
    # Get environment variables
    access_key_id = os.getenv('R2_ACCESS_KEY_ID')
    secret_access_key = os.getenv('R2_SECRET_ACCESS_KEY')
    bucket_name = os.getenv('R2_BUCKET_NAME')
    endpoint_url = os.getenv('R2_ENDPOINT_URL')

    if not all([access_key_id, secret_access_key, bucket_name, endpoint_url]):
        raise ValueError("One or more environment variables are missing")

    # Initialize the s3 client with the R2 endpoint
    s3 = boto3.client(
        's3',
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key
    )

    # Read the results from the file
    with open('results.json', 'rb') as f:
        s3.put_object(
            Bucket=bucket_name,
            Key=f'results/{int(time.time())}.json',
            Body=f
        )

if __name__ == "__main__":
    main(sys.argv[1])
