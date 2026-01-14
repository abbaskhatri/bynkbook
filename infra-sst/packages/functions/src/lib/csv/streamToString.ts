export async function streamToString(body: any): Promise<string> {
  if (!body) return "";
  // AWS SDK v3 GetObject Body can be a stream with async iterator
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return buf.toString("utf8");
}
