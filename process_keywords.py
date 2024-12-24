import sys
import json
import time
import os
import boto3
import re
from getbrowser import setup_chrome
from datetime import datetime

def main(keywords, batch_id, batch_group_id):
    # Split keywords string into a list if it contains commas
    keywords = keywords.split(",") if "," in keywords else [keywords]
    
    results = []
    error_occurred = False

    try:
        for keyword in keywords:
            try:
                result = perform_search(keyword.strip())  # Ensure each keyword is stripped of leading/trailing spaces
                result['timestamp'] = datetime.utcnow().isoformat()
                results.append(result)
            except Exception as e:
                print(f"Error processing keyword {keyword}: {str(e)}")
                results.append({
                    'keyword': keyword,
                    'error': str(e),
                    'timestamp': datetime.utcnow().isoformat()
                })
                error_occurred = True

        with open('results.json', 'w') as f:
            print('Results:', results)
            json.dump(results, f)

        upload_results_to_r2(batch_id)
        update_batch_group_status(batch_group_id)

    except Exception as e:
        print(f"Fatal error in main: {str(e)}")
        error_results = [{
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }]
        with open('results.json', 'w') as f:
            json.dump(error_results, f)
        upload_results_to_r2(batch_id)
        update_batch_group_status(batch_group_id, error=True)

def perform_search(keyword):
    browser = setup_chrome()
    driver = browser.new_tab()

    try:
        # Perform the first search
        search_query = f'intitle:"{keyword}"'
        driver.get(f'https://www.google.com/search?q={search_query}')
        time.sleep(2)  # Add delay to respect rate limits
        element = driver.ele('#result-stats')
        intitle_count = extract_count(element.text)

        # Perform the second search
        search_query = f'allintitle:"{keyword}"'
        driver.get(f'https://www.google.com/search?q={search_query}')
        time.sleep(2)  # Add delay to respect rate limits
        element = driver.ele('#result-stats')
        allintitle_count = extract_count(element.text)

        return {
            'keyword': keyword, 
            'intitle': intitle_count, 
            'allintitle': allintitle_count
        }
    finally:
        try:
            driver.close()
        except:
            pass

def extract_count(result_stats):
    # Use regex to find the number in the result stats text
    match = re.search(r'About ([\d,]+) results', result_stats)
    if match:
        return int(match.group(1).replace(',', ''))  # Convert to integer
    return 0

def get_r2_client():
    # Get environment variables
    access_key_id = os.getenv('R2_ACCESS_KEY_ID')
    secret_access_key = os.getenv('R2_SECRET_ACCESS_KEY')
    bucket_name = os.getenv('R2_BUCKET_NAME')
    endpoint_url = os.getenv('R2_ENDPOINT_URL')

    if not all([access_key_id, secret_access_key, bucket_name, endpoint_url]):
        raise ValueError("One or more environment variables are missing")

    # Initialize the s3 client with the R2 endpoint
    return boto3.client(
        's3',
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key
    ), bucket_name

def upload_results_to_r2(batch_id):
    s3, bucket_name = get_r2_client()

    # Read the results from the file
    with open('results.json', 'rb') as f:
        s3.put_object(
            Bucket=bucket_name,
            Key=f'results/{batch_id}.json',
            Body=f
        )

def update_batch_group_status(batch_group_id, error=False):
    try:
        s3, bucket_name = get_r2_client()

        # Get current batch group status
        try:
            response = s3.get_object(
                Bucket=bucket_name,
                Key=f'batch-groups/{batch_group_id}.json'
            )
            batch_group = json.loads(response['Body'].read().decode('utf-8'))
        except s3.exceptions.NoSuchKey:
            print(f"Warning: Batch group {batch_group_id} not found")
            return

        # Update completed batches count
        batch_group['completedBatches'] += 1
        if error:
            batch_group['hasErrors'] = True

        # Save updated status
        s3.put_object(
            Bucket=bucket_name,
            Key=f'batch-groups/{batch_group_id}.json',
            Body=json.dumps(batch_group)
        )
        
        print(f"Updated batch group status: {batch_group_id}")
    except Exception as e:
        print(f"Error updating batch group status: {str(e)}")

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python script.py <keywords> <batch_id> <batch_group_id>")
        sys.exit(1)

    main(sys.argv[1], sys.argv[2], sys.argv[3])
