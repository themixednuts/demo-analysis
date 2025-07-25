import { error } from '@sveltejs/kit';

export const handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	console.log(pathname);
	if (!pathname.startsWith('/api/live')) {
		return resolve(event);
	}

	const path = pathname.replace('/api/live/', '');
	const url = `https://dist1-ord1.steamcontent.com/tv/${path}`;
	const resp = await fetch(url);
	if (!resp.ok) return error(400);

	console.log(resp);
	return resp;
};
