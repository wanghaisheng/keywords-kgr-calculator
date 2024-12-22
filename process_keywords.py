import sys
import json
import time
import boto3
from selenium import webdriver

def main(keywords):
    keywords = json.loads(keywords)
    results = []

    for keyword in keywords:
        results.extend(perform_search(keyword))

    with open('results.json', 'w') as f:
        json.dump(results, f)

    upload_results_to_r2(results)

def perform_search(keyword):
    driver = webdriver.Chrome()
    driver.get(f'https://www.google.com/search?q={keyword}')
    
    results = []
    for element in driver.find_elements_by_css_selector('h3'):
        results.append(element.text)

    driver.quit()
    return results

def upload_results_to_r2(results):
    s3 = boto3.client(
        's3',
        endpoint_url='https://<your-cloudflare-r2-endpoint>',
        aws_access_key_id='<your-access-key>',
        aws_secret_access_key='<your-secret-key>'
    )
    s3.put_object(
        Bucket='your-r2-bucket',
        Key=f'results/{time.time()}.json',
        Body=json.dumps(results)
    )

if __name__ == "__main__":
    main(sys.argv[1])
