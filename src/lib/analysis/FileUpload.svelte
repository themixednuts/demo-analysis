<script lang="ts">
	import { onMount } from 'svelte';
	import { DemoPacket } from '@mixednuts/demo';
	import { DemoAnalyzer, type DemoAnalysis as DemoAnalysisData } from './index';
	import DemoAnalysis from './DemoAnalysis.svelte';

	// State
	let analysisData = $state<DemoAnalysisData | null>(null);
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let fileName = $state<string | null>(null);
	let fileHistory = $state<StoredFile[]>(loadFileHistory());

	interface StoredFile {
		hash: string;
		name: string;
		size: number;
		uploadDate: string;
		data?: ArrayBuffer; // Fallback for browsers without File System Access API
		fileHandle?: FileSystemFileHandle; // File System Access API handle
		requiresReselection?: boolean; // Indicates if file might need re-selection after refresh
	}

	// Check if File System Access API is supported
	const supportsFileSystemAccess = 'showOpenFilePicker' in window;

	// Generate hash from file content
	async function generateFileHash(buffer: ArrayBuffer): Promise<string> {
		const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	// Load file history from localStorage
	function loadFileHistory(): StoredFile[] {
		try {
			const stored = localStorage.getItem('demo-file-history');
			if (!stored) return [];

			const parsed = JSON.parse(stored);
			// Convert data back to ArrayBuffer if it exists (fallback mode)
			return parsed.map((item: any) => ({
				...item,
				data: item.data ? new Uint8Array(item.data).buffer : undefined,
				fileHandle: undefined, // File handles can't be serialized, will be recreated
				requiresReselection: item.requiresReselection ?? false
			}));
		} catch {
			return [];
		}
	}

	// Save file history to localStorage
	function saveFileHistory(files: StoredFile[]) {
		try {
			// Convert ArrayBuffer to array for JSON serialization (only for fallback mode)
			const serializable = files.map((file) => ({
				hash: file.hash,
				name: file.name,
				size: file.size,
				uploadDate: file.uploadDate,
				// Only store data for fallback mode (when File System Access API not available)
				data:
					!supportsFileSystemAccess && file.data ? Array.from(new Uint8Array(file.data)) : undefined
			}));
			localStorage.setItem('demo-file-history', JSON.stringify(serializable));
		} catch (err) {
			console.warn('Failed to save file history:', err);
		}
	}

	// Store file in history
	async function storeFile(file: File, buffer: ArrayBuffer, fileHandle?: FileSystemFileHandle) {
		const hash = await generateFileHash(buffer);
		const maxStorageSize = 50 * 1024 * 1024; // 50MB limit for localStorage

		const storedFile: StoredFile = {
			hash,
			name: file.name,
			size: file.size,
			uploadDate: new Date().toISOString(),
			// Always store data for smaller files, optional for larger files with file handle
			data: file.size <= maxStorageSize || !supportsFileSystemAccess ? buffer : undefined,
			// Store file handle if supported
			fileHandle: fileHandle,
			// Flag to indicate if this file might need re-selection after refresh
			requiresReselection: supportsFileSystemAccess && file.size > maxStorageSize
		};

		// Remove existing file with same hash
		const newHistory = fileHistory.filter((f) => f.hash !== hash);

		// Add new file at the beginning
		newHistory.unshift(storedFile);

		// Keep only last 10 files
		if (newHistory.length > 10) {
			newHistory.splice(10);
		}

		fileHistory = newHistory;
		saveFileHistory(fileHistory);
	}

	// Use File System Access API to pick file
	async function pickFileWithSystemAPI() {
		try {
			const [fileHandle] = await (window as any).showOpenFilePicker({
				types: [
					{
						description: 'Demo files',
						accept: {
							'application/octet-stream': ['.bin', '.demo']
						}
					}
				],
				multiple: false
			});

			const file = await fileHandle.getFile();
			await analyzeFile(file, fileHandle);
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				console.error('File picker error:', err);
				error = 'Failed to pick file';
			}
		}
	}

	// Analyze a file (common logic for both input methods)
	async function analyzeFile(file: File | StoredFile, fileHandle?: FileSystemFileHandle) {
		isLoading = true;
		error = null;

		try {
			let buffer: ArrayBuffer;
			let fileName: string;

			// Handle different input types
			if (file instanceof File) {
				// Direct file upload
				buffer = await file.arrayBuffer();
				fileName = file.name;

				// Store file for later use
				await storeFile(file, buffer, fileHandle);
			} else {
				// Stored file from history
				fileName = file.name;

				// Try to use File System Access API first (if supported and handle exists)
				if (supportsFileSystemAccess && file.fileHandle) {
					try {
						const actualFile = await file.fileHandle.getFile();
						buffer = await actualFile.arrayBuffer();
					} catch (handleError) {
						console.warn(
							'Failed to read from file handle (likely stale after refresh):',
							handleError
						);

						// If we have stored data as fallback, use it
						if (file.data) {
							console.log('Using stored data as fallback');
							buffer = file.data;
						} else {
							// No stored data available - just fail silently
							console.log('No stored data available, clearing error');
							return;
						}
					}
				}
				// Fallback to stored data
				else if (file.data) {
					buffer = file.data;
				}
				// No data available - just fail silently
				else {
					console.log('No file data available, clearing error');
					return;
				}
			}

			// Analyze the demo
			const analyzer = new DemoAnalyzer();
			const analysis = analyzer.analyzeFragment(buffer);

			analysisData = analysis;
			console.log('Demo analysis completed:', analysis);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to analyze demo file';
			console.error('Demo analysis failed:', err);
		} finally {
			isLoading = false;
		}
	}

	// Traditional file input handler
	async function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];

		if (!file) return;
		await analyzeFile(file);
	}

	// Delete file from history
	function deleteFromHistory(hash: string) {
		fileHistory = fileHistory.filter((f) => f.hash !== hash);
		saveFileHistory(fileHistory);
	}

	// Clear all history
	function clearAllHistory() {
		if (confirm('Are you sure you want to clear all file history?')) {
			fileHistory = [];
			saveFileHistory(fileHistory);
		}
	}

	// Check and remove broken files from history
	async function cleanupBrokenFiles() {
		const validFiles: StoredFile[] = [];

		for (const storedFile of fileHistory) {
			let isValid = false;

			// Check if file is accessible
			if (supportsFileSystemAccess && storedFile.fileHandle) {
				try {
					await storedFile.fileHandle.getFile();
					isValid = true;
				} catch {
					// File handle is stale, check if we have stored data
					isValid = !!storedFile.data;
				}
			} else if (storedFile.data) {
				// Has stored data, always valid
				isValid = true;
			}

			if (isValid) {
				validFiles.push(storedFile);
			}
		}

		// Update history if any files were removed
		if (validFiles.length !== fileHistory.length) {
			fileHistory = validFiles;
			saveFileHistory(fileHistory);
		}
	}

	// Load and analyze a file from history
	async function loadFromHistory(storedFile: StoredFile) {
		await analyzeFile(storedFile);
	}

	// Format file size for display
	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}

	// Copy to clipboard function
	async function copyToClipboard(text: string, button: HTMLElement) {
		try {
			await navigator.clipboard.writeText(text);

			// Show visual feedback
			const originalContent = button.innerHTML;
			button.innerHTML = '✓';
			button.classList.add('copied');

			// Reset after 2 seconds
			setTimeout(() => {
				button.innerHTML = originalContent;
				button.classList.remove('copied');
			}, 2000);
		} catch (err) {
			console.error('Failed to copy text: ', err);
			alert('Failed to copy to clipboard');
		}
	}

	function reset() {
		analysisData = null;
		error = null;
		fileName = null;
	}

	onMount(async () => {
		await cleanupBrokenFiles();
	});
</script>

<div class="file-upload-container">
	{#if !analysisData && !isLoading}
		<div class="upload-section">
			<div class="upload-header">
				<h1>Demo File Analyzer</h1>
				<p>Upload a demo file to analyze its structure and network packets</p>
			</div>

			<div class="upload-area">
				<div class="upload-box">
					<svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
						<polyline points="14,2 14,8 20,8"></polyline>
						<line x1="12" y1="18" x2="12" y2="12"></line>
						<polyline points="9,15 12,12 15,15"></polyline>
					</svg>

					<h3>Choose Demo File</h3>
					<p>Select a .bin or demo file to analyze</p>

					{#if !supportsFileSystemAccess}
						<input type="file" accept=".bin,.demo" onchange={handleFileUpload} class="file-input" />
					{/if}

					<button
						class="upload-btn"
						onclick={supportsFileSystemAccess
							? pickFileWithSystemAPI
							: () => (document.querySelector('.file-input') as HTMLInputElement)?.click()}
					>
						{supportsFileSystemAccess ? 'Choose File' : 'Browse Files'}
					</button>
				</div>

				{#if fileHistory.length > 0}
					<div class="or-divider">
						<span>or load recent</span>
					</div>

					<div class="file-history">
						<div class="history-header">
							<h4>Recent Files</h4>
							<button class="clear-all-btn" onclick={clearAllHistory} title="Clear all history">
								Clear All
							</button>
						</div>
						{#if supportsFileSystemAccess}
							<p class="history-note">Files are read directly from your disk</p>
						{/if}
						<div class="history-list">
							{#each fileHistory as storedFile}
								<div class="history-item">
									<button
										class="history-content"
										onclick={() => loadFromHistory(storedFile)}
										disabled={isLoading}
									>
										<div class="history-info">
											<div class="history-name">
												{storedFile.name}
											</div>
											<div class="history-meta">
												{formatFileSize(storedFile.size)} • {new Date(
													storedFile.uploadDate
												).toLocaleDateString()}
												{#if storedFile.requiresReselection && !storedFile.data}
													<span class="reselection-warning">⚠️ May require re-selection</span>
												{/if}
											</div>
										</div>
									</button>
									<button
										class="delete-btn"
										onclick={() => deleteFromHistory(storedFile.hash)}
										disabled={isLoading}
										title="Delete from history"
									>
										🗑️
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			{#if error}
				<div class="error-message">
					<div class="error-content">
						<strong>Error:</strong>
						<span class="error-text">{error}</span>
						<button
							class="copy-btn"
							onclick={(e) => copyToClipboard(error!, e.currentTarget)}
							title="Copy error message"
						>
							📋
						</button>
					</div>
				</div>
			{/if}
		</div>
	{:else if isLoading}
		<div class="loading-section">
			<div class="spinner"></div>
			<h2>Analyzing Demo File...</h2>
			<p>{fileName || 'Processing file'}</p>
		</div>
	{:else if analysisData}
		<div class="analysis-section">
			<div class="analysis-header">
				<button class="back-btn" onclick={reset}> ← Upload New File </button>
				<div class="file-info">
					<strong>File:</strong>
					{fileName}
				</div>
			</div>

			<svelte:boundary onerror={(err) => console.error('Demo analysis error:', err)}>
				<DemoAnalysis data={analysisData} />

				{#snippet failed(err: any, reset)}
					<div class="error-boundary">
						<h2>Analysis Failed</h2>
						<div class="error-content">
							<p>
								<strong>Error:</strong>
								<span class="error-text">{err?.message || String(err)}</span>
							</p>
							<button
								class="copy-btn"
								onclick={(e) => copyToClipboard(err?.message || String(err), e.currentTarget)}
								title="Copy error message"
							>
								📋
							</button>
						</div>
						<div class="error-actions">
							<button class="error-retry-btn" onclick={reset}>Retry Analysis</button>
							<button
								class="back-btn"
								onclick={() => {
									analysisData = null;
									error = null;
								}}
							>
								Back to Upload
							</button>
						</div>
					</div>
				{/snippet}
			</svelte:boundary>
		</div>
	{/if}
</div>

<style>
	.file-upload-container {
		min-height: 100vh;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.upload-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 20px;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
	}

	.upload-header {
		text-align: center;
		margin-bottom: 40px;
	}

	.upload-header h1 {
		font-size: 2.5rem;
		margin: 0 0 16px;
		font-weight: 600;
	}

	.upload-header p {
		font-size: 1.125rem;
		opacity: 0.9;
		margin: 0;
	}

	.upload-area {
		background: white;
		border-radius: 16px;
		padding: 40px;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
		color: #333;
		min-width: 400px;
		max-width: 500px;
	}

	.upload-box {
		text-align: center;
		padding: 20px;
		border: 2px dashed #e1e5e9;
		border-radius: 12px;
		margin-bottom: 24px;
		transition: border-color 0.2s;
	}

	.upload-box:hover {
		border-color: #667eea;
	}

	.upload-icon {
		width: 48px;
		height: 48px;
		color: #667eea;
		margin-bottom: 16px;
	}

	.upload-box h3 {
		margin: 0 0 8px;
		font-size: 1.25rem;
		color: #333;
	}

	.upload-box p {
		margin: 0 0 20px;
		color: #666;
	}

	.file-input {
		display: none;
	}

	.upload-btn {
		background: #667eea;
		color: white;
		border: none;
		padding: 12px 24px;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.upload-btn:hover {
		background: #5a6fd8;
	}

	.or-divider {
		text-align: center;
		margin: 24px 0;
		position: relative;
		color: #666;
	}

	.or-divider::before {
		content: '';
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 1px;
		background: #e1e5e9;
		z-index: 1;
	}

	.or-divider span {
		background: white;
		padding: 0 16px;
		position: relative;
		z-index: 2;
	}

	.file-history {
		margin-top: 20px;
	}

	.history-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 12px;
	}

	.history-header h4 {
		margin: 0;
		color: #333;
	}

	.clear-all-btn {
		background: #6c757d;
		color: white;
		border: none;
		padding: 6px 12px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.75rem;
		transition: background-color 0.2s;
	}

	.clear-all-btn:hover {
		background: #5a6268;
	}

	.history-note {
		font-size: 0.875rem;
		color: #666;
		margin: 0 0 12px;
	}

	.history-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.history-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		border: 1px solid #ddd;
		border-radius: 6px;
		background: white;
		overflow: hidden;
	}

	.history-content {
		flex: 1;
		background: none;
		border: none;
		padding: 12px;
		cursor: pointer;
		text-align: left;
		transition: background-color 0.2s;
	}

	.history-content:hover:not(:disabled) {
		background: #f8f9fa;
	}

	.history-content:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.history-info {
		width: 100%;
	}

	.history-name {
		font-weight: 500;
		color: #333;
		margin-bottom: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-decoration: none;
		text-overflow: ellipsis;
	}

	.history-meta {
		font-size: 0.875rem;
		color: #666;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.reselection-warning {
		color: #f57c00;
		font-size: 0.75rem;
		background: #fff3e0;
		padding: 2px 6px;
		border-radius: 3px;
		border: 1px solid #ffcc02;
	}

	.delete-btn {
		background: #dc3545;
		color: white;
		border: none;
		border-left: 1px solid #ddd;
		padding: 12px 16px;
		margin-right: 1rem;
		cursor: pointer;
		font-size: 0.875rem;
		transition: background-color 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 2rem;
		width: 2rem;
		aspect-ratio: 1 / 1;
	}

	.delete-btn:hover:not(:disabled) {
		background: #c82333;
	}

	.delete-btn:disabled {
		background: #ccc;
		cursor: not-allowed;
	}

	.loading-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 20px;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
	}

	.spinner {
		width: 48px;
		height: 48px;
		border: 4px solid rgba(255, 255, 255, 0.3);
		border-top: 4px solid white;
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-bottom: 24px;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	.loading-section h2 {
		margin: 0 0 8px;
		font-size: 1.5rem;
	}

	.loading-section p {
		margin: 0;
		opacity: 0.8;
	}

	.analysis-section {
		min-height: 100vh;
	}

	.analysis-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 24px;
		background: white;
		border-bottom: 1px solid #e1e5e9;
		position: sticky;
		top: 0;
		z-index: 100;
	}

	.back-btn {
		background: #667eea;
		color: white;
		border: none;
		padding: 8px 16px;
		border-radius: 6px;
		font-size: 0.875rem;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.back-btn:hover {
		background: #5a6fd8;
	}

	.file-info {
		color: #666;
		font-size: 0.875rem;
	}

	.error-message {
		background: #f8d7da;
		color: #721c24;
		padding: 12px 16px;
		border-radius: 8px;
		margin-top: 20px;
		border: 1px solid #f5c6cb;
	}

	.error-boundary {
		background: #f8d7da;
		color: #721c24;
		padding: 24px;
		border-radius: 8px;
		border: 1px solid #f5c6cb;
		margin: 20px;
		text-align: center;
	}

	.error-boundary h2 {
		margin: 0 0 12px;
		color: #721c24;
	}

	.error-boundary p {
		margin: 0 0 16px;
	}

	.error-actions {
		display: flex;
		gap: 12px;
		justify-content: center;
	}

	.error-retry-btn {
		background: #dc3545;
		color: white;
		border: none;
		padding: 8px 16px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.875rem;
		transition: background-color 0.2s;
	}

	.error-retry-btn:hover {
		background: #c82333;
	}

	/* Copy button styles */
	.copy-btn {
		background: #f8f9fa;
		border: 1px solid #dee2e6;
		border-radius: 4px;
		padding: 4px 6px;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.2s;
		margin-left: 8px;
		flex-shrink: 0;
	}

	.copy-btn:hover {
		background: #e9ecef;
		border-color: #adb5bd;
	}

	.error-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.error-text {
		color: #dc3545;
		font-weight: 500;
	}

	/* Responsive */
	@media (max-width: 640px) {
		.upload-area {
			min-width: auto;
			margin: 0 20px;
			padding: 24px;
		}

		.upload-header h1 {
			font-size: 2rem;
		}

		.analysis-header {
			flex-direction: column;
			gap: 12px;
			align-items: flex-start;
		}
	}
</style>
