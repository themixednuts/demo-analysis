export const GET = async ({ params, fetch }) => {
	const { id } = params;
	const url = `https://dist1-ord1.steamcontent.com/tv/${id}`;
	const resp = await fetch(url);
	return resp;
};
