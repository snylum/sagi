export async function onRequestGet(context) {
  const { env, params } = context;
  const book = await env.DB
    .prepare("SELECT * FROM books WHERE id = ?")
    .bind(params.id)
    .first();

  if (!book) {
    return new Response("Not found", { status: 404 });
  }
  return Response.json(book);
}
