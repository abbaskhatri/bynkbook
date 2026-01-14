import { KMSClient, EncryptCommand, DecryptCommand } from "@aws-sdk/client-kms";

const kms = new KMSClient({});

function requireKeyArn(): string {
  const arn = (process.env.PLAID_TOKEN_KMS_KEY_ARN ?? "").trim();
  if (!arn) throw new Error("Missing env PLAID_TOKEN_KMS_KEY_ARN");
  return arn;
}

export async function encryptAccessToken(plaintext: string): Promise<string> {
  const KeyId = requireKeyArn();
  const res = await kms.send(
    new EncryptCommand({
      KeyId,
      Plaintext: Buffer.from(plaintext, "utf8"),
    })
  );
  const blob = res.CiphertextBlob;
  if (!blob) throw new Error("KMS Encrypt returned empty CiphertextBlob");
  return Buffer.from(blob).toString("base64");
}

export async function decryptAccessToken(ciphertextB64: string): Promise<string> {
  const res = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertextB64, "base64"),
    })
  );
  const pt = res.Plaintext;
  if (!pt) throw new Error("KMS Decrypt returned empty Plaintext");
  return Buffer.from(pt).toString("utf8");
}
