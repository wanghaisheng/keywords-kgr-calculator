import sys
import json
import time
import os
import boto3
from getbrowser import setup_chrome

def main(keywords):
    # Split keywords string into a list if it contains commas
    keywords = keywords.split(",") if "," in keywords else [keywords]
    
    results = []

    for keyword in keywords:
        results.extend(perform_search(keyword.strip()))  # Ensure each keyword is stripped of leading/trailing spaces

    with open('results.json', 'w') as f:
        json.dump(results, f)

    upload_results_to_r2()

def perform_search(keyword):
    browser = setup_chrome()
    search_query = f'intitle:"{keyword}"'
    driver=browser.new_tab()
    driver.get(f'https://www.google.com/search?q={search_query}')

    element = driver.ele('#result-stats')
    data=element.text
    driver.close()
    return data

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
