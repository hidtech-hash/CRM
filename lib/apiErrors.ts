import { NextResponse } from "next/server";

// Turns the Prisma errors that a user can legitimately cause (duplicate
// value, missing row, bad reference) into proper 4xx answers instead of
// an unhandled 500. Returns null for anything else so the caller can
// rethrow / return its own 500.
export function prismaErrorResponse(e: any): NextResponse | null {
  switch (e?.code) {
    case "P2002":
      return NextResponse.json({ error: "A record with that value already exists." }, { status: 409 });
    case "P2025":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "P2003":
      return NextResponse.json({ error: "A referenced record does not exist." }, { status: 400 });
    default:
      return null;
  }
}
