import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createToken,
  loginUser,
  resendVerificationForEmail,
  signupUser,
  verifyEmailByToken,
  verifyToken,
} from "../lib/authStore.js";
import { shouldSkipEmailVerification } from "../lib/appConfig.js";
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
  await sendVerificationEmail(email, displayName, verificationToken);
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
      const skipVerify = await shouldSkipEmailVerification();
      const { user, verificationToken } = signupUser(email, password, displayName, {
        skipEmailVerification: skipVerify,
      });

      if (skipVerify) {
        const token = await createToken(user);
        return reply.status(201).send({
          user,
          token,
          pendingVerification: false,
          message: "Compte créé — connexion automatique (vérification email désactivée).",
        });
      }

      try {
        await dispatchVerificationEmail(user.email, user.displayName, verificationToken);
        return reply.status(201).send({
          pendingVerification: true,
          email: user.email,
          userId: user.id,
          displayName: user.displayName,
          message:
            "Un email de vérification a été envoyé. Consultez votre boîte mail pour activer votre compte.",
        });
      } catch (emailErr) {
        console.error("[auth] verification email failed after signup:", emailErr);
        return reply.status(201).send({
          pendingVerification: true,
          email: user.email,
          userId: user.id,
          displayName: user.displayName,
          emailDeliveryFailed: true,
          message:
            "Compte créé, mais l'email de vérification n'a pas pu être envoyé. Cliquez sur « Renvoyer l'email » ci-dessous.",
        });
      }
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
        try {
          await dispatchVerificationEmail(
            result.user.email,
            result.user.displayName,
            result.verificationToken,
          );
          return {
            ok: true,
            message: "Email de vérification renvoyé.",
          };
        } catch (emailErr) {
          console.error("[auth] resend verification email failed:", emailErr);
          return reply.status(200).send({
            ok: false,
            emailDeliveryFailed: true,
            message:
              "L'email n'a pas pu être envoyé (Resend). Réessayez plus tard ou demandez à l'admin d'activer l'inscription sans vérification email.",
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Resend failed";
        return reply.status(400).send({ error: message });
      }
    },
  );

  app.get("/api/auth/me", async (request, reply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    return { user: request.authUser };
  });
}
