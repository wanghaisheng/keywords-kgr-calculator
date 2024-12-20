// sse.js

const KeywordAnalyzer = (function() {
    // Configuration
    const API_URL = 'https://your-worker-url.workers.dev'; // Replace with your actual worker URL
    let currentProcessId = null;
    let eventSource = null;
    let timerInterval = null;
    let startTime = null;

    // Initialize all event listeners
    function initializeEventListeners() {
        console.log('Initializing event listeners...');

        // Tab switching
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                console.log('Tab clicked:', button.dataset.tab);
                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.input-content').forEach(c => c.classList.remove('active'));
                button.classList.add('active');
                document.getElementById(`${button.dataset.tab}Input`).classList.add('active');
            });
        });

        // File upload handling
        const fileUpload = document.querySelector('.file-upload');
        const fileInput = document.getElementById('csvFile');
        const fileName = document.querySelector('.file-name');

        if (fileUpload && fileInput) {
            fileUpload.addEventListener('click', () => fileInput.click());
            
            fileUpload.addEventListener('dragover', (e) => {
                e.preventDefault();
                fileUpload.style.borderColor = 'var(--primary-color)';
            });

            fileUpload.addEventListener('dragleave', () => {
                fileUpload.style.borderColor = '#ddd';
            });

            fileUpload.addEventListener('drop', (e) => {
                e.preventDefault();
                fileUpload.style.borderColor = '#ddd';
                if (e.dataTransfer.files.length) {
                    handleFile(e.dataTransfer.files[0]);
                }
            });

            fileInput.addEventListener('change', () => {
                if (fileInput.files.length) {
                    handleFile(fileInput.files[0]);
                }
            });
        }

        // Submit button click handler
        const submitButton = document.getElementById('submitButton');
        if (submitButton) {
            console.log('Adding submit button listener');
            submitButton.addEventListener('click', handleSubmit);
        }

        // Filter button click handler
        const filterButton = document.getElementById('applyFilters');
        if (filterButton) {
            filterButton.addEventListener('click', applyFilters);
        }
    }

    function handleFile(file) {
        if (!file.name.endsWith('.csv')) {
            alert('Please upload a CSV file');
            return;
        }
        document.querySelector('.file-name').textContent = file.name;
    }

    async function handleSubmit(e) {
        e.preventDefault();
        console.log('Submit button clicked');

        const submitButton = document.getElementById('submitButton');
        submitButton.disabled = true;

        try {
            const activeTab = document.querySelector('.tab-button.active').dataset.tab;
            let keywords;

            if (activeTab === 'text') {
                keywords = document.getElementById('keywordsText').value.trim();
                if (!keywords) {
                    throw new Error('Please enter keywords');
                }
            } else {
                const file = document.getElementById('csvFile').files[0];
                if (!file) {
                    throw new Error('Please select a CSV file');
                }
                keywords = await file.text();
            }

            await submitKeywords(keywords);
        } catch (error) {
            console.error('Submission error:', error);
            alert(`Error: ${error.message}`);
        } finally {
            submitButton.disabled = false;
        }
    }

    async function submitKeywords(keywords) {
        try {
            console.log('Submitting keywords:', keywords);
            
            const response = await fetch(`${API_URL}/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ keywords })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('Submit response:', data);

            if (data.status === 'success') {
                currentProcessId = data.process_id;
                showProgress();
                startTimer();
                startEventSource();
            } else {
                throw new Error(data.message || 'Unknown error occurred');
            }
        } catch (error) {
            console.error('Submit error:', error);
            throw error;
        }
    }

    function showProgress() {
        const progressSection = document.getElementById('progressSection');
        if (progressSection) {
            progressSection.style.display = 'block';
        }
    }

    function startTimer() {
        startTime = Date.now();
        if (timerInterval) {
            clearInterval(timerInterval);
        }
        
        const timeElapsed = document.getElementById('timeElapsed');
        timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            timeElapsed.textContent = `Time: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }, 1000);
    }

    function startEventSource() {
        if (eventSource) {
            eventSource.close();
        }

        eventSource = new EventSource(`${API_URL}/events?processId=${currentProcessId}`);
        
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleUpdate(data);
            } catch (error) {
                console.error('Error parsing SSE data:', error);
            }
        };

        eventSource.onerror = (error) => {
            console.error('SSE error:', error);
            eventSource.close();
            if (timerInterval) {
                clearInterval(timerInterval);
            }
            alert('Connection lost. Please refresh the page.');
        };
    }

    function handleUpdate(data) {
        if (data.type === 'batch_update') {
            updateProgress(data);
            if (data.status.status === 'completed') {
                updateResults(data.status.results);
            }
        }
    }

    function updateProgress(data) {
        const progressFill = document.getElementById('progressFill');
        const batchStatus = document.getElementById('batchStatus');
        const batchProgress = document.getElementById('batchProgress');
        
        if (!progressFill || !batchStatus || !batchProgress) return;

        if (data.status.status === 'completed') {
            progressFill.style.width = '100%';
            batchStatus.textContent = 'Processing complete!';
            batchProgress.textContent = `Completed all batches`;
            if (eventSource) {
                eventSource.close();
            }
            if (timerInterval) {
                clearInterval(timerInterval);
            }
        } else {
            // Calculate progress based on completed batches
            const progress = (data.completedBatches / data.totalBatches) * 100;
            progressFill.style.width = `${progress}%`;
            batchStatus.textContent = `Processing batch ${data.completedBatches + 1} of ${data.totalBatches}`;
            batchProgress.textContent = `Processing batch: ${data.completedBatches + 1}/${data.totalBatches}`;
        }
    }

    function updateResults(results) {
        const resultsSection = document.getElementById('resultsSection');
        const tbody = document.getElementById('resultsTableBody');
        
        if (!resultsSection || !tbody) return;

        resultsSection.style.display = 'block';
        
        tbody.innerHTML = results.map(row => `
            <tr class="${getKGRClass(row.kgr_score)}">
                <td>${row.keyword}</td>
                <td>${row.search_volume.toLocaleString()}</td>
                <td>${row.allintitle_count.toLocaleString()}</td>
                <td>${row.intitle_count.toLocaleString()}</td>
                <td>${row.kgr_score.toFixed(2)}</td>
                <td>${row.difficulty_score.toFixed(2)}</td>
                <td>${row.opportunity_score.toFixed(2)}</td>
            </tr>
        `).join('');
    }

    function getKGRClass(kgrScore) {
        if (kgrScore <= 0.25) return 'kgr-excellent';
        if (kgrScore <= 0.5) return 'kgr-good';
        if (kgrScore <= 1) return 'kgr-moderate';
        return 'kgr-difficult';
    }

    function applyFilters() {
        const minSearchVolume = document.getElementById('minSearchVolume').value;
        const maxKgr = document.getElementById('maxKgr').value;
        
        if (!currentProcessId) return;

        fetch(`${API_URL}/results?processId=${currentProcessId}&minSearchVolume=${minSearchVolume}&maxKgrScore=${maxKgr}`)
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    updateResults(data.results);
                }
            })
            .catch(error => {
                console.error('Filter error:', error);
                alert(`Error applying filters: ${error.message}`);
            });
    }

    function cleanup() {
        if (eventSource) {
            eventSource.close();
        }
        if (timerInterval) {
            clearInterval(timerInterval);
        }
        currentProcessId = null;
    }

    // Handle page unload
    window.addEventListener('beforeunload', cleanup);

    // Public API
    return {
        init: initializeEventListeners,
        cleanup: cleanup
    };
})();

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing...');
    KeywordAnalyzer.init();
});

// Add this line at the end of the file to make sure it's loaded
console.log('sse.js loaded');
