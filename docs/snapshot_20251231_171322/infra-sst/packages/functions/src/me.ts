export async function handler(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  const claims = auth?.jwt?.claims ?? auth?.claims ?? {};

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      user: {
        sub: claims.sub,
        email: claims.email,
      },
    }),
  };
}
