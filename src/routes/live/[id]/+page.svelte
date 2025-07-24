<script lang="ts">
	import { BroadcastChunk, BroadcastReader } from '@mixednuts/demo';
	import type { PageProps } from './$types';
	const { params }: PageProps = $props();

	const url = $derived(new URL(`/live/${params.id}`));

	$inspect(url);

	const reader = $derived(BroadcastReader.new(url));
	$inspect(reader);

	const stream = $derived(reader.stream({}));
	$inspect(stream);

	// let chunks: Readonly<BroadcastChunk>[] = $derived(await Array.fromAsync(stream));

	// async function stream() {
	// 	chunks.length = 0;
	// 	for await (const chunk of reader.stream()) {
	// 		chunks.push(chunk);
	// 	}
	// }

	// $effect(() => {
	// 	if (reader) {
	// 		console.log();
	// 		console.log(reader);
	// 		stream();
	// 	}
	// });
</script>
