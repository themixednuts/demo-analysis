<script lang="ts">
	import { BroadcastChunk, BroadcastReader } from '@mixednuts/demo';

	import type { PageProps } from './$types';
	import { onMount } from 'svelte';
	const { params, data }: PageProps = $props();

	const url = $derived(new URL(`${data.origin}/api/live/${params.id}`));

	$inspect(url);

	const reader = $derived(BroadcastReader.new(url));
	$inspect(reader);

	const stream = $derived(reader.stream({}));
	$inspect(stream);

	let chunks: Readonly<{ fragment: number; chunk: BroadcastChunk }>[] = $state([]);

	onMount(() => {
		(async () => {
			chunks.length = 0;
			for await (const chunk of reader.stream({})) {
				chunks.push(chunk);
			}
		})();
	});
</script>

<div>
	{#each chunks as { fragment, chunk }}
		{fragment}: {chunk.size} bytes
	{/each}
</div>
