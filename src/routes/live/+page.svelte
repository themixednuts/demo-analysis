<script lang="ts">
	import { page } from '$app/state';
	import { BroadcastChunk, BroadcastReader } from '@mixednuts/demo';

	const id = $derived(page.url.searchParams.get('id'));
	$inspect(id);
	const url = $derived(`https://dist1-ord1.steamcontent.com/tv/${id}`);
	$inspect(url);

	const reader = $derived(BroadcastReader.new(url));
	$inspect(reader);

	const stream = $derived(reader.stream());
	$inspect(stream);

	let chunks: Readonly<BroadcastChunk>[] = $derived(await Array.fromAsync(stream));

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

{#each chunks as chunk}
	<div>{chunk.tick}</div>
{/each}
