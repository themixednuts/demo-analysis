<script lang="ts">
	import type { DemoAnalysis, ChunkAnalysis } from './index';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';

	interface Props {
		data: DemoAnalysis;
	}

	const { data = $bindable() }: Props = $props();

	// State
	let filter = $state('all');
	let searchQuery = $state('');
	let expandedChunks = new SvelteSet<number>();

	// Derived filtered chunks
	let filteredChunks = $derived.by((): ChunkAnalysis[] => {
		let chunks = data.chunks;

		// Apply filter
		if (filter !== 'all') {
			chunks = chunks.filter((chunk) => {
				if (filter === 'error') return !chunk.success;
				return chunk.analysisType === filter;
			});
		}

		// Apply search
		if (searchQuery) {
			const query = searchQuery.toLowerCase();
			chunks = chunks.filter(
				(chunk) =>
					chunk.commandName.toLowerCase().includes(query) ||
					chunk.error?.toLowerCase().includes(query) ||
					chunk.networkPackets?.some(
						(packet) =>
							packet.typeName.toLowerCase().includes(query) ||
							packet.error?.toLowerCase().includes(query)
					)
			);
		}

		return chunks;
	});

	// Sorting state
	let sortBy = $state('index'); // 'index', 'parseTime', 'size'
	let sortDesc = $state(false);

	// Derived sorted chunks (after filtering)
	let sortedChunks = $derived.by((): ChunkAnalysis[] => {
		let chunks = [...filteredChunks];

		chunks.sort((a, b) => {
			let compareValue = 0;

			switch (sortBy) {
				case 'parseTime':
					compareValue = a.parseTimeMs - b.parseTimeMs;
					break;
				case 'size':
					compareValue = a.size - b.size;
					break;
				case 'index':
				default:
					compareValue = a.index - b.index;
					break;
			}

			return sortDesc ? -compareValue : compareValue;
		});

		return chunks;
	});

	// Helper functions
	function toggleChunkExpansion(index: number) {
		if (expandedChunks.has(index)) {
			expandedChunks.delete(index);
		} else {
			expandedChunks.add(index);
		}
	}

	function setSortBy(newSortBy: string) {
		if (sortBy === newSortBy) {
			sortDesc = !sortDesc;
		} else {
			sortBy = newSortBy;
			sortDesc = false;
		}
	}

	function scrollToChunk(chunkIndex: number) {
		const element = document.getElementById(`chunk-${chunkIndex}`);
		if (element) {
			element.scrollIntoView({ behavior: 'smooth', block: 'center' });
			// Expand the chunk if it's collapsed
			if (!expandedChunks.has(chunkIndex)) {
				toggleChunkExpansion(chunkIndex);
			}
			// Add highlight effect
			element.classList.add('chunk-highlight');
			setTimeout(() => {
				element.classList.remove('chunk-highlight');
			}, 2000);
		}
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

	function formatJSONFull(obj: any): string {
		try {
			return JSON.stringify(
				obj,
				(key, value) => {
					// Handle BigInt values
					if (typeof value === 'bigint') {
						return value.toString() + 'n';
					}
					// Handle other non-serializable values
					if (typeof value === 'function') {
						return '[Function]';
					}
					if (typeof value === 'symbol') {
						return value.toString();
					}
					if (value instanceof Error) {
						return {
							name: value.name,
							message: value.message,
							stack: value.stack
						};
					}
					return value;
				},
				2
			);
		} catch (error) {
			return `[Serialization Error: ${error instanceof Error ? error.message : String(error)}]`;
		}
	}

	function getSuccessRate(): number {
		const total = data.chunks.length;
		const successful = data.chunks.filter((c) => c.success).length;
		return total > 0 ? Math.round((successful / total) * 100) : 0;
	}

	function getChunkTypeColor(type: string): string {
		switch (type) {
			case 'network_packets':
				return '#e3f2fd';
			case 'protobuf':
				return '#f3e5f5';
			default:
				return '#fff3e0';
		}
	}
</script>

<div class="demo-analysis">
	<!-- Header -->
	<header class="header">
		<h1>Demo Analysis Dashboard</h1>
		<div class="header-meta">
			<span class="fragment-size">{data.fragmentSize.toLocaleString()} bytes</span>
			<span class="success-rate">{getSuccessRate()}% success rate</span>
		</div>
	</header>

	<!-- Summary Cards -->
	<section class="summary" style="content-visibility: auto;">
		<div class="stat-card">
			<div class="stat-value">{data.totalChunks}</div>
			<div class="stat-label">Total Chunks</div>
		</div>
		<div class="stat-card">
			<div class="stat-value">{data.summary.networkPacketChunks}</div>
			<div class="stat-label">Network Packet Chunks</div>
		</div>
		<div class="stat-card">
			<div class="stat-value">{data.summary.protobufChunks}</div>
			<div class="stat-label">Protobuf Chunks</div>
		</div>
		<div class="stat-card">
			<div class="stat-value">{data.summary.totalNetworkPackets}</div>
			<div class="stat-label">Total Network Packets</div>
		</div>
		<div class="stat-card">
			<div class="stat-value">{data.summary.errors}</div>
			<div class="stat-label">Chunk Errors</div>
		</div>
		<div class="stat-card">
			<div class="stat-value">{data.summary.packetErrors}</div>
			<div class="stat-label">Packet Parse Errors</div>
		</div>
		<div class="stat-card">
			<div class="stat-value">{data.summary.packetDecodeErrors}</div>
			<div class="stat-label">Packet Decode Errors</div>
		</div>
	</section>

	<!-- Performance Metrics -->
	<section class="performance" style="content-visibility: auto;">
		<div class="perf-banner">
			<div class="perf-item">
				<strong>{data.totalParseTimeMs.toFixed(2)}ms</strong> total
			</div>
			<div class="perf-item">
				<strong>{data.performance.averageChunkParseTimeMs.toFixed(2)}ms</strong>
				avg
			</div>
			<div class="perf-item">
				<strong>{data.performance.slowestChunk.timeMs.toFixed(2)}ms</strong>
				<button
					class="chunk-link"
					onclick={() => scrollToChunk(data.performance.slowestChunk.index)}
				>
					#{data.performance.slowestChunk.index}
				</button> slowest
			</div>
			<div class="perf-item">
				<strong>{data.performance.fastestChunk.timeMs.toFixed(2)}ms</strong>
				<button
					class="chunk-link"
					onclick={() => scrollToChunk(data.performance.fastestChunk.index)}
				>
					#{data.performance.fastestChunk.index}
				</button> fastest
			</div>
			{#if data.summary.errors + data.summary.packetErrors + data.summary.packetDecodeErrors > 0}
				<div class="perf-item perf-errors">
					<strong
						>{data.summary.errors +
							data.summary.packetErrors +
							data.summary.packetDecodeErrors}</strong
					> total errors
				</div>
			{/if}
		</div>
	</section>

	<!-- Controls -->
	<section class="controls" style="content-visibility: auto;">
		<div class="filters">
			<button class="filter-btn" class:active={filter === 'all'} onclick={() => (filter = 'all')}>
				All ({data.chunks.length})
			</button>
			<button
				class="filter-btn"
				class:active={filter === 'network_packets'}
				onclick={() => (filter = 'network_packets')}
			>
				Network Packets ({data.summary.networkPacketChunks})
			</button>
			<button
				class="filter-btn"
				class:active={filter === 'protobuf'}
				onclick={() => (filter = 'protobuf')}
			>
				Protobuf ({data.summary.protobufChunks})
			</button>
			<button
				class="filter-btn"
				class:active={filter === 'error'}
				onclick={() => (filter = 'error')}
			>
				Errors Only ({data.summary.errors})
			</button>
		</div>

		<div class="search">
			<input
				type="text"
				placeholder="Search chunks, commands, or errors..."
				bind:value={searchQuery}
				class="search-input"
			/>
		</div>

		<div class="sort-controls">
			<span>Sort by:</span>
			<button class="sort-btn" class:active={sortBy === 'index'} onclick={() => setSortBy('index')}>
				Index {sortBy === 'index' ? (sortDesc ? '↓' : '↑') : ''}
			</button>
			<button
				class="sort-btn"
				class:active={sortBy === 'parseTime'}
				onclick={() => setSortBy('parseTime')}
			>
				Parse Time {sortBy === 'parseTime' ? (sortDesc ? '↓' : '↑') : ''}
			</button>
			<button class="sort-btn" class:active={sortBy === 'size'} onclick={() => setSortBy('size')}>
				Size {sortBy === 'size' ? (sortDesc ? '↓' : '↑') : ''}
			</button>
		</div>
	</section>

	<!-- Chunks List -->
	<section class="chunks-list">
		<svelte:boundary onerror={(error) => console.error('Chunk rendering error:', error)}>
			{#each sortedChunks as chunk (chunk.index)}
				<article
					id="chunk-{chunk.index}"
					class="chunk"
					class:success={chunk.success}
					class:error={!chunk.success}
					style="
            content-visibility: auto;
            background-color: {getChunkTypeColor(chunk.analysisType)};
          "
				>
					<header
						class="chunk-header"
						role="button"
						tabindex="0"
						onclick={() => toggleChunkExpansion(chunk.index)}
						onkeydown={(e) => e.key === 'Enter' && toggleChunkExpansion(chunk.index)}
					>
						<h3>
							Chunk {chunk.index}: {chunk.commandName} ({chunk.command})
							{#if !chunk.success}
								<span class="error-indicator">⚠️</span>
							{/if}
						</h3>
						<div class="chunk-meta">
							<span class="size">{chunk.size.toLocaleString()} bytes</span>
							<span>{chunk.tick}</span>
							<span class="type">{chunk.analysisType}</span>
							<span class="parse-time">{chunk.parseTimeMs.toFixed(3)}ms</span>
							{#if chunk.isCompressed}
								<span class="compressed">Compressed</span>
							{/if}
							<button class="expand-btn" class:expanded={expandedChunks.has(chunk.index)}>
								{expandedChunks.has(chunk.index) ? '▼' : '▶'}
							</button>
						</div>
					</header>

					{#if expandedChunks.has(chunk.index)}
						<div
							class="chunk-content"
							style="content-visibility: auto; contain-intrinsic-size: auto 1200px;"
						>
							{#if chunk.error}
								<div class="error-message">
									<div class="error-content">
										<strong>Error:</strong>
										<span class="error-text">{chunk.error}</span>
										<button
											class="copy-btn"
											onclick={(e) => copyToClipboard(chunk.error!, e.currentTarget)}
											title="Copy error message"
										>
											📋
										</button>
									</div>
								</div>
							{/if}

							{#if chunk.networkPackets && chunk.networkPackets.length > 0}
								<section class="network-packets">
									<h4>
										Network Packets ({chunk.networkPackets.length})
									</h4>
									<div class="packets-grid">
										{#each chunk.networkPackets as packet (packet.packetIndex)}
											<div class="packet" class:packet-error={packet.error}>
												<div class="packet-header">
													<strong>Packet {packet.packetIndex}:</strong>
													<span class="packet-type">{packet.typeName} ({packet.type})</span>
													<span class="packet-size">{packet.size} bytes</span>
													<span class="packet-time">{packet.parseTimeMs.toFixed(4)}ms</span>
												</div>

												{#if packet.error}
													<div class="packet-error-msg">
														<div class="error-content">
															Error: <span class="error-text">{packet.error}</span>
															<button
																class="copy-btn"
																onclick={(e) => copyToClipboard(packet.error!, e.currentTarget)}
																title="Copy error message"
															>
																📋
															</button>
														</div>
													</div>
												{/if}

												{#if packet.rawDataSample}
													<div class="packet-raw">
														<div class="code-content">
															Raw: <span class="code-text">{packet.rawDataSample}</span>
															<button
																class="copy-btn"
																onclick={(e) =>
																	copyToClipboard(packet.rawDataSample!, e.currentTarget)}
																title="Copy raw data"
															>
																📋
															</button>
														</div>
													</div>
												{/if}

												{#if packet.decodeSuccess && packet.decodedData}
													<details
														class="packet-decoded"
														style="content-visibility: auto; contain-intrinsic-size: auto 600px;"
													>
														<summary>Decoded Protobuf Data</summary>
														<svelte:boundary
															onerror={(error) =>
																console.error('Packet decode display error:', error)}
														>
															<div class="json-container">
																<pre
																	class="json-display"
																	style="scrollbar-gutter: stable;">{formatJSONFull(
																		packet.decodedData
																	)}</pre>

																<button
																	class="copy-btn json-copy"
																	onclick={(e) =>
																		copyToClipboard(
																			formatJSONFull(packet.decodedData),
																			e.currentTarget
																		)}
																	title="Copy JSON data"
																>
																	📋
																</button>
															</div>

															{#snippet failed(error: any, reset)}
																<div class="error-boundary">
																	<div class="error-content">
																		<p>
																			<strong>Failed to display packet data:</strong>
																			<span class="error-text"
																				>{error?.message || String(error)}</span
																			>
																		</p>
																		<button
																			class="copy-btn"
																			onclick={(e) =>
																				copyToClipboard(
																					error?.message || String(error),
																					e.currentTarget
																				)}
																			title="Copy error message"
																		>
																			📋
																		</button>
																	</div>
																	<button class="error-retry-btn" onclick={reset}>Retry</button>
																</div>
															{/snippet}
														</svelte:boundary>
													</details>
												{:else if packet.decodeError}
													<div class="decode-error">
														<div class="error-content">
															Decode Error: <span class="error-text">{packet.decodeError}</span>
															<button
																class="copy-btn"
																onclick={(e) =>
																	copyToClipboard(packet.decodeError!, e.currentTarget)}
																title="Copy error message"
															>
																📋
															</button>
														</div>
													</div>
												{/if}

												<div class="packet-stats">
													<span>Cursor: {packet.cursor}</span>
													<span
														>Remaining: {packet.remainingBytesAfter}
														bytes</span
													>
												</div>
											</div>
										{/each}
									</div>
								</section>
							{/if}

							{#if chunk.protobufData}
								<section
									class="protobuf-data"
									style="content-visibility: auto; contain-intrinsic-size: auto 800px;"
								>
									<h4>Protobuf Data</h4>
									<svelte:boundary
										onerror={(error) => console.error('Protobuf display error:', error)}
									>
										<div class="json-container">
											<pre class="json-display" style="scrollbar-gutter: stable;">{formatJSONFull(
													chunk.protobufData
												)}</pre>

											<button
												class="copy-btn json-copy"
												onclick={(e) =>
													copyToClipboard(formatJSONFull(chunk.protobufData), e.currentTarget)}
												title="Copy JSON data"
											>
												📋
											</button>
										</div>

										{#snippet failed(error: any, reset)}
											<div class="error-boundary">
												<div class="error-content">
													<p>
														<strong>Failed to display protobuf data:</strong>
														<span class="error-text">{error?.message || String(error)}</span>
													</p>
													<button
														class="copy-btn"
														onclick={(e) =>
															copyToClipboard(error?.message || String(error), e.currentTarget)}
														title="Copy error message"
													>
														📋
													</button>
												</div>
												<button class="error-retry-btn" onclick={reset}>Retry</button>
											</div>
										{/snippet}
									</svelte:boundary>
								</section>
							{/if}

							{#if chunk.rawDataSample}
								<details class="raw-data">
									<summary>Raw Data Sample</summary>
									<div class="raw-bytes">
										<div class="raw-byte-line">
											<strong>First 20 bytes:</strong>
											<span class="code-text">{chunk.rawDataSample.first20Bytes}</span>
											<button
												class="copy-btn"
												onclick={(e) =>
													copyToClipboard(chunk.rawDataSample!.first20Bytes, e.currentTarget)}
												title="Copy raw bytes"
											>
												📋
											</button>
										</div>
										<div class="raw-byte-line">
											<strong>Last 10 bytes:</strong>
											<span class="code-text">{chunk.rawDataSample.last10Bytes}</span>
											<button
												class="copy-btn"
												onclick={(e) =>
													copyToClipboard(chunk.rawDataSample!.last10Bytes, e.currentTarget)}
												title="Copy raw bytes"
											>
												📋
											</button>
										</div>
									</div>
								</details>
							{/if}
						</div>
					{/if}
				</article>
			{/each}

			{#if sortedChunks.length === 0}
				<div class="no-results">
					<p>No chunks match the current filter and search criteria.</p>
				</div>
			{/if}

			{#snippet failed(error: any, reset)}
				<div class="error-boundary">
					<h3>Failed to render chunks</h3>
					<p>
						<strong>Error:</strong>
						{error?.message || String(error)}
					</p>
					<button class="error-retry-btn" onclick={reset}>Retry Analysis</button>
				</div>
			{/snippet}
		</svelte:boundary>
	</section>
</div>

<style>
	.demo-analysis {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		max-width: 1400px;
		margin: 0 auto;
		padding: 20px;
		background: #fafafa;
		min-height: 100vh;
	}

	.header {
		background: white;
		padding: 24px;
		border-radius: 12px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		margin-bottom: 24px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.header h1 {
		margin: 0;
		color: #1a1a1a;
		font-size: 2rem;
		font-weight: 600;
	}

	.header-meta {
		display: flex;
		gap: 16px;
		font-size: 0.875rem;
		color: #666;
	}

	.fragment-size,
	.success-rate {
		padding: 4px 8px;
		background: #f5f5f5;
		border-radius: 4px;
	}

	.summary {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 16px;
		margin-bottom: 20px;
	}

	.performance {
		margin-bottom: 20px;
	}

	.perf-banner {
		display: flex;
		align-items: center;
		gap: 20px;
		padding: 12px 16px;
		background: linear-gradient(135deg, #e8f5e8 0%, #f0f8f0 100%);
		border: 1px solid #d4edda;
		border-radius: 8px;
		font-size: 0.875rem;
		color: #155724;
	}

	.perf-item {
		display: flex;
		align-items: center;
		gap: 4px;
		color: #555;
		font-size: 0.875rem;
	}

	.perf-item strong {
		color: #28a745;
		font-weight: 600;
	}

	.perf-errors {
		color: #dc3545;
		font-weight: 600;
	}

	.chunk-link {
		background: #007bff;
		color: white;
		border: none;
		padding: 2px 6px;
		border-radius: 3px;
		cursor: pointer;
		font-size: 0.75rem;
		text-decoration: none;
		transition: background-color 0.2s;
	}

	.chunk-link:hover {
		background: #218838;
		transform: translateY(-1px);
	}

	.stat-card {
		background: white;
		padding: 20px;
		border-radius: 8px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		text-align: center;
		transition: transform 0.2s ease;
	}

	.stat-card:hover {
		transform: translateY(-2px);
	}

	.stat-value {
		font-size: 2.5rem;
		font-weight: bold;
		color: #007bff;
		margin-bottom: 8px;
	}

	.stat-label {
		color: #666;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.controls {
		background: white;
		padding: 20px;
		border-radius: 8px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		margin-bottom: 24px;
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: center;
	}

	.filters {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.filter-btn {
		padding: 8px 16px;
		border: 2px solid #e9ecef;
		border-radius: 20px;
		background: white;
		color: #495057;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.filter-btn:hover {
		border-color: #007bff;
		color: #007bff;
	}

	.filter-btn.active {
		background: #007bff;
		border-color: #007bff;
		color: white;
	}

	.search {
		flex: 1;
		min-width: 250px;
	}

	.search-input {
		width: 100%;
		padding: 10px 16px;
		border: 2px solid #e9ecef;
		border-radius: 8px;
		font-size: 0.875rem;
		transition: border-color 0.2s ease;
	}

	.search-input:focus {
		outline: none;
		border-color: #007bff;
	}

	.sort-controls {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
		font-size: 0.875rem;
	}

	.sort-controls span {
		color: #666;
		font-weight: 500;
	}

	.sort-btn {
		background: #f8f9fa;
		border: 1px solid #dee2e6;
		padding: 4px 8px;
		border-radius: 4px;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.sort-btn:hover {
		background: #e9ecef;
		border-color: #adb5bd;
	}

	.sort-btn.active {
		background: #007bff;
		color: white;
		border-color: #007bff;
	}

	.chunks-list {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.chunk {
		background: white;
		border-radius: 8px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		overflow: hidden;
		transition: box-shadow 0.2s ease;
		contain: layout style paint;
	}

	.chunk:hover {
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.chunk.success {
		border-left: 4px solid #28a745;
	}

	.chunk.error {
		border-left: 4px solid #dc3545;
	}

	.chunk-highlight {
		animation: highlight-pulse 2s ease-out;
	}

	@keyframes highlight-pulse {
		0% {
			box-shadow: 0 0 20px rgba(40, 167, 69, 0.6);
			transform: scale(1.02);
		}
		50% {
			box-shadow: 0 0 30px rgba(40, 167, 69, 0.4);
		}
		100% {
			box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
			transform: scale(1);
		}
	}

	.chunk-header {
		padding: 16px 20px;
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		align-items: center;
		transition: background-color 0.2s ease;
		border: none;
		background: transparent;
		width: 100%;
		text-align: left;
	}

	.chunk-header:focus {
		outline: 2px solid #007bff;
		outline-offset: -2px;
	}

	.chunk-header:hover {
		background-color: rgba(0, 0, 0, 0.02);
	}

	.chunk-header h3 {
		margin: 0;
		font-size: 1.125rem;
		color: #1a1a1a;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.error-indicator {
		font-size: 1rem;
	}

	.chunk-meta {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 0.875rem;
		color: #666;
	}

	.size,
	.type,
	.compressed,
	.parse-time {
		padding: 2px 6px;
		background: #f8f9fa;
		border-radius: 4px;
		font-weight: 500;
	}

	.compressed {
		background: #e3f2fd;
		color: #1976d2;
	}

	.parse-time {
		background: #e8f5e8;
		color: #28a745;
	}

	.expand-btn {
		background: none;
		border: none;
		font-size: 1rem;
		cursor: pointer;
		padding: 4px;
		transition: transform 0.2s ease;
	}

	.expand-btn.expanded {
		transform: rotate(0deg);
	}

	.chunk-content {
		padding: 0 20px 20px;
		border-top: 1px solid #e9ecef;
	}

	.error-message {
		background: #f8d7da;
		color: #721c24;
		padding: 12px;
		border-radius: 4px;
		margin-bottom: 16px;
		border: 1px solid #f5c6cb;
	}

	.network-packets {
		margin-bottom: 20px;
	}

	.network-packets h4 {
		margin: 16px 0 12px;
		color: #1a1a1a;
		font-size: 1.1rem;
	}

	.packets-grid {
		display: grid;
		gap: 12px;
	}

	.packet {
		background: #f8f9fa;
		padding: 12px;
		border-radius: 6px;
		border: 1px solid #e9ecef;
		font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
		font-size: 0.875rem;
	}

	.packet.packet-error {
		border-color: #dc3545;
		background: #f8d7da;
	}

	.packet-header {
		margin-bottom: 8px;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}

	.packet-type {
		background: #e3f2fd;
		padding: 2px 6px;
		border-radius: 3px;
		font-weight: 500;
	}

	.packet-size {
		background: #f3e5f5;
		padding: 2px 6px;
		border-radius: 3px;
	}

	.packet-time {
		background: #e8f5e8;
		color: #28a745;
		padding: 2px 6px;
		border-radius: 3px;
		font-weight: 500;
		font-size: 0.8rem;
	}

	.packet-error-msg,
	.decode-error {
		color: #721c24;
		font-weight: 500;
		margin: 4px 0;
	}

	.packet-raw {
		color: #666;
		margin: 4px 0;
		word-break: break-all;
	}

	.packet-decoded {
		margin: 8px 0;
	}

	.packet-decoded summary {
		cursor: pointer;
		font-weight: 500;
		color: #007bff;
		margin-bottom: 8px;
	}

	.packet-stats {
		margin-top: 8px;
		display: flex;
		gap: 16px;
		font-size: 0.8rem;
		color: #666;
	}

	.json-display {
		background: #f8f9fa;
		border: 1px solid #e9ecef;
		border-radius: 4px;
		padding: 12px;
		overflow-x: auto;
		font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
		font-size: 0.8rem;
		min-height: 120px;
		max-height: 400px;
		overflow-y: auto;
		content-visibility: auto;
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

	/* Content containers with copy buttons */
	.error-content,
	.code-content {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.json-container {
		position: relative;
		border: 1px solid #e9ecef;
		border-radius: 4px;
		/* Performance optimizations */
		contain: layout style paint;
		will-change: auto;
	}

	/* Scrollbar handling for JSON containers */
	@supports (scrollbar-gutter: stable) {
		.json-container {
			scrollbar-gutter: stable;
		}
	}

	/* Webkit scrollbar styling for better integration */
	.json-display::-webkit-scrollbar {
		width: 12px;
		height: 12px;
	}

	.json-display::-webkit-scrollbar-track {
		background: #f1f1f1;
	}

	.json-display::-webkit-scrollbar-thumb {
		background: #c1c1c1;
		border-radius: 6px;
	}

	.json-display::-webkit-scrollbar-thumb:hover {
		background: #a8a8a8;
	}

	.json-copy {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 10;
		background: rgba(248, 249, 250, 0.95);
		backdrop-filter: blur(2px);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	.json-copy:hover {
		background: rgba(233, 236, 239, 0.98);
	}

	/* Account for scrollbar space in positioned clipboard button */
	@supports (scrollbar-gutter: stable) {
		.json-copy {
			right: 24px; /* Fixed spacing from edge accounting for scrollbar */
		}
	}

	/* Fallback for browsers without scrollbar-gutter support */
	@supports not (scrollbar-gutter: stable) {
		.json-copy {
			right: 20px; /* More generous spacing for older browsers */
		}
	}

	/* Performance optimizations for large content sections */
	.protobuf-data,
	.packet-decoded {
		contain: layout style paint;
		will-change: contents;
	}

	/* Optimize chunk content for performance */
	.chunk-content {
		contain: layout style;
		transform: translateZ(0); /* GPU acceleration */
	}

	.json-display {
		margin: 0; /* Remove margin since container has border */
		border: none; /* Remove border since container has it */
		/* Performance optimizations */
		contain: layout style paint;
		content-visibility: auto;
		transform: translateZ(0); /* Force GPU acceleration for smooth scrolling */
		will-change: scroll-position; /* Optimize for scrolling */
		-webkit-overflow-scrolling: touch; /* Smooth scrolling on iOS */
		/* Better padding to account for controls */
		padding: 12px;
		padding-top: 40px; /* Space for floating controls */
	}

	.raw-byte-line {
		display: flex;
		align-items: center;
		margin: 4px 0;
		word-break: break-all;
	}

	.error-text {
		color: #dc3545;
		font-weight: 500;
	}

	.code-text {
		font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
		background: #f8f9fa;
		padding: 2px 4px;
		border-radius: 3px;
		word-break: break-all;
	}

	.protobuf-data h4 {
		margin: 16px 0 8px;
		color: #1a1a1a;
	}

	.raw-data {
		margin-top: 16px;
	}

	.raw-data summary {
		cursor: pointer;
		font-weight: 500;
		color: #666;
		margin-bottom: 8px;
	}

	.raw-bytes {
		background: #f8f9fa;
		padding: 12px;
		border-radius: 4px;
		font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
		font-size: 0.875rem;
	}

	.raw-bytes div {
		margin: 4px 0;
		word-break: break-all;
	}

	.no-results {
		text-align: center;
		padding: 40px;
		color: #666;
		background: white;
		border-radius: 8px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	/* Responsive design */
	@media (max-width: 768px) {
		.demo-analysis {
			padding: 12px;
		}

		.header {
			flex-direction: column;
			gap: 12px;
			text-align: center;
		}

		.header h1 {
			font-size: 1.5rem;
		}

		.controls {
			flex-direction: column;
			align-items: stretch;
		}

		.perf-banner {
			flex-direction: column;
			align-items: flex-start;
			gap: 8px;
		}

		.chunk-header {
			flex-direction: column;
			gap: 8px;
			align-items: flex-start;
		}

		.packet-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	/* Performance optimizations */
	.chunk {
		contain: layout style paint;
	}

	.packets-grid {
		contain: layout style;
	}

	.json-display {
		contain: size style;
	}

	.error-boundary {
		background: #f8d7da;
		color: #721c24;
		padding: 16px;
		border-radius: 8px;
		border: 1px solid #f5c6cb;
		margin: 12px 0;
	}

	.error-boundary h3 {
		margin: 0 0 8px;
		color: #721c24;
	}

	.error-boundary p {
		margin: 0 0 12px;
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
</style>
