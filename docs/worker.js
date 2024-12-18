直接丢csv给action 我发现运行到第30个词 就全是0了  想着先分成30个一组吧

const FILE_STORAGE_PATH = "results"; // Storage path in github repo
const GITHUB_REPO = "wanghaisheng/keywords-kgr-calculator";
const GITHUB_TOKEN = 'xxxx';
const ACTION_WORKFLOW = "main.yml";
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "https://wanghaisheng.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
};

// Main event listener
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

// Main request handler
async function handleRequest(request) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: CORS_HEADERS
        });
    }

    if (request.method !== "POST") {
        return new Response("Invalid request method. Use POST.", { 
            status: 405, 
            headers: CORS_HEADERS 
        });
    }

    try {
        let workflowInputs = {};
        const contentType = request.headers.get("Content-Type") || "";
        console.log('Content-Type:', contentType);

        if (contentType.includes("application/json")) {
            const jsonData = await request.json();
            console.log('Received JSON data:', jsonData);

            if (!jsonData.id || !jsonData.keywords) {
                return new Response("Missing required fields: id and keywords", { 
                    status: 400, 
                    headers: CORS_HEADERS 
                });
            }

            workflowInputs = {
                ref: "main",
                inputs: {
                    id: jsonData.id,
                    keywords: jsonData.keywords,
                    csvFile: ""
                }
            };
        } else if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            const id = formData.get("id");
            const csvFile = formData.get("csvFile");
            console.log('Received FormData - ID:', id);

            if (!id || !csvFile) {
                return new Response("Missing required fields: id and csvFile", { 
                    status: 400, 
                    headers: CORS_HEADERS 
                });
            }

            const fileBuffer = await csvFile.arrayBuffer();
            const base64File = arrayBufferToBase64(fileBuffer);

            workflowInputs = {
                ref: "main",
                inputs: {
                    id: id,
                    keywords: "",
                    csvFile: base64File
                }
            };
        } else {
            return new Response("Unsupported Content-Type", { 
                status: 415, 
                headers: CORS_HEADERS 
            });
        }

        console.log('Triggering GitHub workflow...');
        const githubResponse = await triggerGitHubAction(workflowInputs);

        if (!githubResponse.ok) {
            const errorText = await githubResponse.text();
            console.error('GitHub API Error:', githubResponse.status, errorText);
            return new Response(`Failed to trigger GitHub Action: ${errorText}`, { 
                status: githubResponse.status, 
                headers: CORS_HEADERS 
            });
        }

        return new Response("GitHub Action triggered successfully!", { 
            status: 200, 
            headers: CORS_HEADERS 
        });
    } catch (error) {
        console.error('Request Handler Error:', error);
        return new Response(`Error: ${error.message}`, { 
            status: 500, 
            headers: CORS_HEADERS 
        });
    }
}

// GitHub Action trigger function
async function triggerGitHubAction(data) {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${ACTION_WORKFLOW}/dispatches`;
    console.log('GitHub API URL:', url);
    console.log('Workflow Input Data:', data);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${GITHUB_TOKEN}`,
                "Content-Type": "application/json",
                "User-Agent": "Cloudflare-Worker",
                "Accept": "application/vnd.github.v3+json"
            },
            body: JSON.stringify(data)
        });

        console.log('GitHub API Response Status:', response.status);
        return response;
    } catch (error) {
        console.error('GitHub Action Trigger Error:', error);
        throw error;
    }
}

// File check handler
async function handleFileCheck(request) {
    const url = new URL(request.url);
    const id = url.pathname.split("/check-file/")[1];

    if (!id) {
        return new Response("Invalid file ID", {
            status: 400,
            headers: CORS_HEADERS
        });
    }

    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_STORAGE_PATH}/${id}.csv`;
    console.log("Checking file at:", apiUrl);

    try {
        const response = await fetch(apiUrl, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "Cloudflare-Worker"
            },
        });

        console.log("GitHub API Status:", response.status);
        console.log("GitHub API Headers:", Object.fromEntries(response.headers));

        if (response.status === 404) {
            return new Response("File not found or still processing.", {
                status: 404,
                headers: CORS_HEADERS
            });
        }

        if (response.status === 401 || response.status === 403) {
            console.error("GitHub API Authentication Error");
            return new Response("Authentication error with GitHub", {
                status: 401,
                headers: CORS_HEADERS
            });
        }

        const responseText = await response.text();
        console.log("Raw GitHub Response:", responseText);

        try {
            const data = JSON.parse(responseText);
            
            if (data.download_url) {
                const responseData = JSON.stringify({
                    download_url: data.download_url,
                    raw_url: data.download_url.replace('githubusercontent.com', 'raw.githubusercontent.com')
                });

                return new Response(responseData, {
                    status: 200,
                    headers: {
                        ...CORS_HEADERS,
                        'Content-Type': 'application/json'
                    }
                });
            } else {
                console.error("No download_url in response:", data);
                return new Response("File metadata incomplete", {
                    status: 500,
                    headers: CORS_HEADERS
                });
            }
        } catch (parseError) {
            console.error("JSON Parse Error:", parseError);
            console.error("Response that failed to parse:", responseText);

            if (response.headers.get('content-type')?.includes('text/plain')) {
                return new Response(responseText, {
                    status: 200,
                    headers: CORS_HEADERS
                });
            }

            return new Response("Error parsing GitHub response", {
                status: 500,
                headers: CORS_HEADERS
            });
        }
    } catch (networkError) {
        console.error("Network Error:", networkError);
        return new Response(`Network error while checking file: ${networkError.message}`, {
            status: 503,
            headers: CORS_HEADERS
        });
    }
}
