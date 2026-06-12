import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createSessionFromUser,
  createToken,
  requestPasswordResetForEmail,
  resendVerificationForEmail,
  signupUser,
  verifyToken,
} from "../lib/authStore.js";
import { shouldSkipEmailVerification } from "../lib/appConfig.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../lib/emailService.js";
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
  /** JWT pour le chat — après login validé côté front (Google Sheets). */
  app.post<{
    Body: {
      id?: string;
      email?: string;
      displayName?: string;
      emailVerified?: boolean;
    };
  }>("/api/auth/session", async (request, reply) => {
    const id = request.body?.id?.trim() ?? "";
    const email = request.body?.email?.trim() ?? "";
    const displayName = request.body?.displayName?.trim() ?? "";
    if (!id || !email || !displayName) {
      return reply.status(400).send({ error: "id, email et displayName requis" });
    }
    return createSessionFromUser({
      id,
      email,
      displayName,
      emailVerified: request.body?.emailVerified === true,
    });
  });

  app.post<{
    Body: {
      email?: string;
      password?: string;
      displayName?: string;
      userId?: string;
      verificationToken?: string;
      verificationExpiresAt?: number | null;
    };
  }>("/api/auth/signup", async (request, reply) => {
    try {
      const email = request.body?.email ?? "";
      const password = request.body?.password ?? "";
      const displayName = request.body?.displayName ?? "";
      const skipVerify = await shouldSkipEmailVerification();
      const { user, verificationToken, sheetAuth } = signupUser(
        email,
        password,
        displayName,
        {
          skipEmailVerification: skipVerify,
          userId: request.body?.userId,
          verificationToken: request.body?.verificationToken,
          verificationExpiresAt: request.body?.verificationExpiresAt,
        },
      );

      if (skipVerify) {
        const { token } = await createSessionFromUser(user);
        return reply.status(201).send({
          user,
          token,
          sheetAuth,
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
          sheetAuth,
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
          sheetAuth,
          emailDeliveryFailed: true,
          message:
            "Compte créé, mais l'email de vérification n'a pas pu être envoyé. Cliquez sur « Renvoyer l'email » ci-dessous.",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Signup failed";
      return reply.status(400).send({ error: message });
    }
  });

  app.post<{
    Body: {
      email?: string;
      displayName?: string;
      verificationToken?: string;
      verificationExpiresAt?: number | null;
    };
  }>(
    "/api/auth/resend-verification",
    async (request, reply) => {
      try {
        const email = request.body?.email?.trim() ?? "";
        const displayName = request.body?.displayName?.trim() ?? email;
        if (!email) {
          return reply.status(400).send({ error: "Email requis" });
        }

        const { verificationToken, sheetAuth } = resendVerificationForEmail(
          email,
          displayName,
          {
            verificationToken: request.body?.verificationToken,
            verificationExpiresAt: request.body?.verificationExpiresAt,
          },
        );

        try {
          await dispatchVerificationEmail(email, displayName, verificationToken);
          return {
            ok: true,
            verificationToken,
            verificationExpiresAt: sheetAuth.verificationExpiresAt,
            message: "Email de vérification renvoyé.",
          };
        } catch (emailErr) {
          console.error("[auth] resend verification email failed:", emailErr);
          return reply.status(200).send({
            ok: false,
            emailDeliveryFailed: true,
            message:
              "L'email n'a pas pu être envoyé (Mailjet). Réessayez plus tard ou demandez à l'admin d'activer l'inscription sans vérification email.",
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Envoi email impossible";
        return reply.status(400).send({ error: message });
      }
    },
  );

  const FORGOT_PASSWORD_MESSAGE =
    "Si un compte existe pour cet email, un lien de réinitialisation a été envoyé.";

  app.post<{ Body: { email?: string; displayName?: string } }>(
    "/api/auth/forgot-password",
    async (request, reply) => {
      const email = request.body?.email?.trim() ?? "";
      const displayName = request.body?.displayName?.trim() ?? email;
      if (!email) {
        return reply.status(400).send({ error: "Email requis" });
      }

      const result = requestPasswordResetForEmail(email, displayName);

      try {
        await sendPasswordResetEmail(
          result.email,
          result.displayName,
          result.passwordResetToken,
        );
        return {
          ok: true,
          message: FORGOT_PASSWORD_MESSAGE,
          passwordResetToken: result.passwordResetToken,
          passwordResetExpiresAt: result.passwordResetExpiresAt,
        };
      } catch (emailErr) {
        console.error("[auth] password reset email failed:", emailErr);
        return reply.status(200).send({
          ok: false,
          emailDeliveryFailed: true,
          message:
            "L'email n'a pas pu être envoyé. Réessayez plus tard ou contactez le support.",
        });
      }
    },
  );

  app.get("/api/auth/me", async (request, reply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    return { user: request.authUser };
  });
}
