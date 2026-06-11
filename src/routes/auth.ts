import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createToken,
  loginUser,
  resendVerificationForEmail,
  signupUser,
  verifyEmailByToken,
  verifyToken,
} from "../lib/authStore.js";
import { sendVerificationEmail } from "../lib/emailService.js";
import type { AuthUser } from "../lib/types.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export async function extractAuthUser(
  request: FastifyRequest,
): Promise<AuthUser | null> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  return verifyToken(token);
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = await extractAuthUser(request);
  if (!user) {
    reply.status(401).send({ error: "Unauthorized" });
    return;
  }
  request.authUser = user;
}

async function dispatchVerificationEmail(
  email: string,
  displayName: string,
  verificationToken: string,
): Promise<void> {
  try {
    await sendVerificationEmail(email, displayName, verificationToken);
  } catch (err) {
    console.error("[auth] Failed to send verification email:", err);
    throw new Error(
      "Compte créé mais l'email de vérification n'a pas pu être envoyé. Réessayez « Renvoyer l'email ».",
    );
  }
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email?: string; password?: string } }>(
    "/api/auth/login",
    async (request, reply) => {
      try {
        const email = request.body?.email ?? "";
        const password = request.body?.password ?? "";
        const user = loginUser(email, password);
        const token = await createToken(user);
        return { user, token };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Login failed";
        const status = message.includes("confirmer") ? 403 : 401;
        return reply.status(status).send({ error: message });
      }
    },
  );

  app.post<{
    Body: { email?: string; password?: string; displayName?: string };
  }>("/api/auth/signup", async (request, reply) => {
    try {
      const email = request.body?.email ?? "";
      const password = request.body?.password ?? "";
      const displayName = request.body?.displayName ?? "";
      const { user, verificationToken } = signupUser(email, password, displayName);
      await dispatchVerificationEmail(user.email, user.displayName, verificationToken);
      return reply.status(201).send({
        pendingVerification: true,
        email: user.email,
        message:
          "Un email de vérification a été envoyé. Consultez votre boîte mail pour activer votre compte.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Signup failed";
      const status = message.includes("déjà") ? 409 : 400;
      return reply.status(status).send({ error: message });
    }
  });

  app.get<{ Querystring: { token?: string } }>(
    "/api/auth/verify-email",
    async (request, reply) => {
      try {
        const token = request.query?.token ?? "";
        const user = verifyEmailByToken(token);
        const jwt = await createToken(user);
        return { ok: true, user, token: jwt };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Verification failed";
        return reply.status(400).send({ error: message });
      }
    },
  );

  app.post<{ Body: { email?: string } }>(
    "/api/auth/resend-verification",
    async (request, reply) => {
      try {
        const email = request.body?.email ?? "";
        const result = resendVerificationForEmail(email);
        if (!result) {
          return reply.status(200).send({
            ok: true,
            message:
              "Si un compte non vérifié existe pour cet email, un message a été envoyé.",
          });
        }
        await dispatchVerificationEmail(
          result.user.email,
          result.user.displayName,
          result.verificationToken,
        );
        return {
          ok: true,
          message: "Email de vérification renvoyé.",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Resend failed";
        return reply.status(500).send({ error: message });
      }
    },
  );

  app.get("/api/auth/me", async (request, reply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    return { user: request.authUser };
  });
}
