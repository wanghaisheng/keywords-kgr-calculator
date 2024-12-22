import sys
import json
import time
import boto3
from getbrowser import *

def main(keywords):
    keywords = json.loads(keywords)
    results = []

    for keyword in keywords:
        results.extend(perform_search(keyword))

    with open('results.json', 'w') as f:
        json.dump(results, f)

    upload_results_to_r2(results)

def perform_search(keyword):
    driver = setup_Chrome()
    searchQuery=f'intitle:"{keyword}"'
    driver.get(f'https://www.google.com/search?q={searchQuery}')

    results = []
    for element in driver.ele('#result-stats'):
        results.append(element.text)
    
    driver.quit()
    return results


def upload_results_to_r2(results):
    # Get environment variables
    access_key_id = os.getenv('R2_ACCESS_KEY_ID')
    secret_access_key = os.getenv('R2_SECRET_ACCESS_KEY')
    bucket_name = os.getenv('R2_BUCKET_NAME')
    endpoint_url = os.getenv('R2_ENDPOINT_URL')

    # Initialize the s3 client with the R2 endpoint
    s3 = boto3.client(
        's3',
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key
    )

    # Read the results from the file
    # with open(file_path, 'r') as f:
        # results = json.load(f)

    # Upload results to R2
    s3.put_object(
        Bucket=bucket_name,
        Key=f'results/{time.time()}.json',
        Body=json.dumps(results)
    )

if __name__ == "__main__":
    main(sys.argv[1])
