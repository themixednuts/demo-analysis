<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:boundary>
	{#snippet pending()}
		<p>loading...</p>
	{/snippet}
	{@render children()}
</svelte:boundary>
