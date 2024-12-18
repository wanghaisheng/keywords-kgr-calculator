把上传的csv拆成8个，如果挨个运行action 又很慢 同时运行的话 提交文件会冲突
还是用数据库好了

const FILE_STORAGE_PATH = "results";
const GITHUB_REPO = "wanghaisheng/keywords-kgr-calculator";
const GITHUB_TOKEN = '';
const ACTION_WORKFLOW = "main.yml";
const KEYWORDS_PER_BATCH = 30; // Maximum keywords per batch
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "https://wanghaisheng.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
};

addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    console.log('Request Method:', event.request.method);
    console.log('Request Path:', url.pathname);

    if (url.pathname.startsWith("/check-file/")) {
        event.respondWith(handleFileCheck(event.request));
    } else {
        event.respondWith(handleRequest(event.request));
    }
});

// Utility function to convert ArrayBuffer to Base64
const arrayBufferToBase64 = (buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

// Function to parse CSV content
async function parseCSV(csvContent) {
    const lines = csvContent.split('\n');
    return lines
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => line.split(',')[0].trim()); // Take first column
}

// Function to split keywords into batches
function splitIntoBatches(keywords) {
    const batches = [];
    for (let i = 0; i < keywords.length; i += KEYWORDS_PER_BATCH) {
        batches.push(keywords.slice(i, i + KEYWORDS_PER_BATCH));
    }
    return batches;
}

// Function to trigger multiple GitHub Actions
async function triggerBatchedActions(batches, baseId) {
    const promises = batches.map(async (keywords, index) => {
        const batchId = `${baseId}-batch${index + 1}`;
        const workflowInputs = {
            ref: "main",
            inputs: {
                id: batchId,
                keywords: keywords.join(','),
                csvFile: ""
            }
        };

        return triggerGitHubAction(workflowInputs);
    });

    return Promise.all(promises);
}

async function handleRequest(request) {
    if (request.method === "OPTIONS") {
        return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
        return new Response("Invalid request method. Use POST.", { 
            status: 405, 
            headers: CORS_HEADERS 
        });
    }

    try {
        const contentType = request.headers.get("Content-Type") || "";
        const baseId = 'req-' + Math.random().toString(36).substring(2, 15);
        let keywords = [];

        if (contentType.includes("application/json")) {
            const jsonData = await request.json();
            if (!jsonData.id || !jsonData.keywords) {
                return new Response("Missing required fields", { 
                    status: 400, 
                    headers: CORS_HEADERS 
                });
            }
            keywords = jsonData.keywords.split(',').map(k => k.trim());

        } else if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            const csvFile = formData.get("csvFile");
            if (!csvFile) {
                return new Response("Missing CSV file", { 
                    status: 400, 
                    headers: CORS_HEADERS 
                });
            }

            const csvText = await csvFile.text();
            keywords = await parseCSV(csvText);
        } else {
            return new Response("Unsupported Content-Type", { 
                status: 415, 
                headers: CORS_HEADERS 
            });
        }

        // Split keywords into batches if needed
        if (keywords.length > KEYWORDS_PER_BATCH) {
            const batches = splitIntoBatches(keywords);
            console.log(`Split into ${batches.length} batches`);

            try {
                await triggerBatchedActions(batches, baseId);
                
                // Store batch information for later combination
                const batchInfo = {
                    totalBatches: batches.length,
                    baseId: baseId,
                    status: 'processing',
                    completedBatches: [],
                    timestamp: new Date().toISOString()
                };

                // You might want to store this information somewhere
                // For now, we'll return it to the client
                return new Response(JSON.stringify({
                    message: "Multiple batches triggered successfully",
                    batchInfo: batchInfo
                }), { 
                    status: 200, 
                    headers: {
                        ...CORS_HEADERS,
                        'Content-Type': 'application/json'
                    }
                });
            } catch (error) {
                console.error('Batch processing error:', error);
                return new Response("Error processing batches", { 
                    status: 500, 
                    headers: CORS_HEADERS 
                });
            }
        } else {
            // Handle single batch normally
            const workflowInputs = {
                ref: "main",
                inputs: {
                    id: baseId,
                    keywords: keywords.join(','),
                    csvFile: ""
                }
            };

            const response = await triggerGitHubAction(workflowInputs);
            if (!response.ok) {
                throw new Error(`GitHub API Error: ${response.status}`);
            }

            return new Response("GitHub Action triggered successfully!", { 
                status: 200, 
                headers: CORS_HEADERS 
            });
        }
    } catch (error) {
        console.error('Request Handler Error:', error);
        return new Response(`Error: ${error.message}`, { 
            status: 500, 
            headers: CORS_HEADERS 
        });
    }
}

async function handleFileCheck(request) {
    const url = new URL(request.url);
    const id = url.pathname.split("/check-file/")[1];

    if (!id) {
        return new Response("Invalid file ID", {
            status: 400,
            headers: CORS_HEADERS
        });
    }

    // Check if this is a batch ID
    if (id.includes('-batch')) {
        // This is part of a batch, need to check all related batches
        const baseId = id.split('-batch')[0];
        try {
            const results = await checkBatchResults(baseId);
            return new Response(JSON.stringify(results), {
                status: 200,
                headers: {
                    ...CORS_HEADERS,
                    'Content-Type': 'application/json'
                }
            });
        } catch (error) {
            return new Response(`Error checking batch results: ${error.message}`, {
                status: 500,
                headers: CORS_HEADERS
            });
        }
    }

    // Regular single file check
    try {
        const response = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_STORAGE_PATH}/${id}.csv`,
            {
                headers: {
                    "Authorization": `Bearer ${GITHUB_TOKEN}`,
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "Cloudflare-Worker"
                },
            }
        );

        if (response.status === 404) {
            return new Response("File not found or still processing.", {
                status: 404,
                headers: CORS_HEADERS
            });
        }

        const data = await response.json();
        if (data.download_url) {
            return new Response(JSON.stringify({
                download_url: data.download_url,
                raw_url: data.download_url.replace('githubusercontent.com', 'raw.githubusercontent.com')
            }), {
                status: 200,
                headers: {
                    ...CORS_HEADERS,
                    'Content-Type': 'application/json'
                }
            });
        }

        return new Response("File metadata incomplete", {
            status: 500,
            headers: CORS_HEADERS
        });
    } catch (error) {
        return new Response(`Error checking file: ${error.message}`, {
            status: 500,
            headers: CORS_HEADERS
        });
    }
}

// Function to check batch results
async function checkBatchResults(baseId) {
    const batchResults = [];
    let batchNumber = 1;
    let allComplete = true;

    while (true) {
        const batchId = `${baseId}-batch${batchNumber}`;
        try {
            const response = await fetch(
                `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_STORAGE_PATH}/${batchId}.csv`,
                {
                    headers: {
                        "Authorization": `Bearer ${GITHUB_TOKEN}`,
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "Cloudflare-Worker"
                    },
                }
            );

            if (response.status === 404) {
                if (batchNumber === 1) {
                    // No batches found yet
                    return { status: 'processing', message: 'No results available yet' };
                }
                break; // No more batches
            }

            const data = await response.json();
            if (!data.download_url) {
                allComplete = false;
            } else {
                batchResults.push({
                    batchId,
                    download_url: data.download_url
                });
            }
            batchNumber++;
        } catch (error) {
            console.error(`Error checking batch ${batchNumber}:`, error);
            allComplete = false;
            break;
        }
    }

    if (batchResults.length === 0) {
        return { status: 'processing', message: 'No results available yet' };
    }

    if (!allComplete) {
        return {
            status: 'processing',
            message: 'Some batches still processing',
            completedBatches: batchResults
        };
    }

    return {
        status: 'complete',
        message: 'All batches complete',
        results: batchResults
    };
}

// GitHub Action trigger function
async function triggerGitHubAction(data) {
    console.log('Triggering GitHub Action with data:', data);
    
    const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${ACTION_WORKFLOW}/dispatches`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${GITHUB_TOKEN}`,
                "Content-Type": "application/json",
                "User-Agent": "Cloudflare-Worker",
            },
            body: JSON.stringify(data)
        }
    );

    console.log('GitHub API Response Status:', response.status);
    return response;
}
