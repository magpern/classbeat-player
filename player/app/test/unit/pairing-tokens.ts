// Test tokens, made at run time so no token-shaped string is ever in the repository (ADR 0002,
// section 2: CI fails on one).
import { randomBytes } from "node:crypto";

export const newToken = (type: "dc" | "dev"): string => ["cbp", type, randomBytes(32).toString("base64url")].join("_");
export const USER_CODE = "BCDF-GHJK";
export const ORIGIN = "https://player.example.test";
export const PAGE = `${ORIGIN}/pair`;
