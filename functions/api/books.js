export async function onRequestGet(context) {
  const { env } = context;
  const result = await env.DB.prepare("SELECT id, title, cover FROM books").all();
  return Response.json(result.results);
}

export async function onRequestPost(context) {
  const { env } = context;
  const data = await context.request.json();
  const { title, cover, content } = data;

  await env.DB.prepare(
    "INSERT INTO books (title, cover, content) VALUES (?, ?, ?)"
  ).bind(title, cover, content).run();

  return Response.json({ ok: true });
}
