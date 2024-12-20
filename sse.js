// sse.js

// Wrap everything in an IIFE (Immediately Invoked Function Expression)
const KeywordAnalyzer = (function() {
    // Configuration
    const API_URL = 'https://kgr-backend-websocket.v2ray-tokyo.workers.dev'; // Replace with your actual worker URL
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

    // Rest of your functions...
    // [Previous functions remain the same, just indent them to be inside the IIFE]

    // Initialize when DOM is loaded
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM loaded, initializing...');
        initializeEventListeners();
    });

    // Public API
    return {
        init: initializeEventListeners,
        cleanup: cleanup
    };
})();

// Add this line at the end of the file to make sure it's loaded
console.log('sse.js loaded');
