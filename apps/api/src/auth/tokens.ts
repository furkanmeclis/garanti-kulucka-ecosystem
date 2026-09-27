import { jwtVerify, SignJWT } from "jose";
import type { ApiConfig } from "../config.js";

const encoder = new TextEncoder();

export interface AccessTokenClaims {
  user_public_id: string;
  session_public_id: string;
  role: string;
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  config: ApiConfig,
): Promise<string> {
  return new SignJWT({
    user_public_id: claims.user_public_id,
    session_public_id: claims.session_public_id,
    role: claims.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTtlSeconds}s`)
    .sign(encoder.encode(config.jwtSecret));
}

export async function verifyAccessToken(token: string, config: ApiConfig): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, encoder.encode(config.jwtSecret));

  if (
    typeof payload.user_public_id !== "string" ||
    typeof payload.session_public_id !== "string" ||
    typeof payload.role !== "string"
  ) {
    throw new Error("Invalid access token claims");
  }

  return {
    user_public_id: payload.user_public_id,
    session_public_id: payload.session_public_id,
    role: payload.role,
  };
}
