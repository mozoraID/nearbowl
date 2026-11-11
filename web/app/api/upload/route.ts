import { BLOB_TOKEN_MISSING, COIN_IMAGE_MAX_BYTES, COIN_IMAGE_TYPES, isCoinImagePath } from "@/lib/image";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenReady(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function GET() {
  return NextResponse.json({ configured: tokenReady() });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!tokenReady()) {
    return NextResponse.json({ error: BLOB_TOKEN_MISSING }, { status: 400 });
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "The upload request could not be read." }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!isCoinImagePath(pathname)) {
          throw new Error("Pictures are stored under coins/.");
        }
        return {
          allowedContentTypes: [...COIN_IMAGE_TYPES],
          maximumSizeInBytes: COIN_IMAGE_MAX_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The picture could not be uploaded.";
    const friendly = /BLOB_READ_WRITE_TOKEN|token/i.test(message) ? BLOB_TOKEN_MISSING : message;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }
}
