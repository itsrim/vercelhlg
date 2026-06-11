import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "hlg-dev-secret-change-in-production");
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const usersByEmail = new Map();
const usersById = new Map();
const usersByVerificationToken = new Map();
function registerUser(user) {
    usersByEmail.set(user.email, user);
    usersById.set(user.id, user);
    if (user.verificationToken) {
        usersByVerificationToken.set(user.verificationToken, user);
    }
}
function clearVerificationToken(user) {
    if (user.verificationToken) {
        usersByVerificationToken.delete(user.verificationToken);
        user.verificationToken = undefined;
        user.verificationExpiresAt = undefined;
    }
}
function toAuthUser(user) {
    return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        emailVerified: user.emailVerified,
    };
}
function createVerificationToken() {
    return randomBytes(32).toString("hex");
}
function seedDemoUser(user) {
    user.emailVerified = true;
    clearVerificationToken(user);
    registerUser(user);
}
seedDemoUser({
    id: "user_demo_001",
    email: "demo@hlg.com",
    displayName: "Utilisateur Demo",
    password: "password",
    emailVerified: true,
});
seedDemoUser({
    id: "user_admin_001",
    email: "rim",
    displayName: "Admin",
    password: "1234",
    emailVerified: true,
});
export async function createToken(user) {
    return new SignJWT({
        email: user.email,
        displayName: user.displayName,
        emailVerified: user.emailVerified ?? true,
    })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(user.id)
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(JWT_SECRET);
}
export async function verifyToken(token) {
    try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        const id = payload.sub;
        const email = payload.email;
        const displayName = payload.displayName;
        if (typeof id !== "string" || typeof email !== "string" || typeof displayName !== "string") {
            return null;
        }
        const stored = usersById.get(id);
        return {
            id,
            email,
            displayName,
            emailVerified: stored?.emailVerified ?? payload.emailVerified === true,
        };
    }
    catch {
        return null;
    }
}
export function loginUser(email, password) {
    const user = usersByEmail.get(email.trim().toLowerCase());
    if (!user || user.password !== password) {
        throw new Error("Email ou mot de passe incorrect");
    }
    if (!user.emailVerified) {
        throw new Error("Veuillez confirmer votre email avant de vous connecter. Consultez votre boîte mail ou renvoyez l'email de vérification.");
    }
    return toAuthUser(user);
}
export function signupUser(email, password, displayName) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password || !displayName.trim()) {
        throw new Error("Tous les champs sont requis");
    }
    if (password.length < 6) {
        throw new Error("Le mot de passe doit contenir au moins 6 caractères");
    }
    if (usersByEmail.has(normalizedEmail)) {
        throw new Error("Cet email est déjà utilisé");
    }
    const verificationToken = createVerificationToken();
    const user = {
        id: `user_${Date.now()}_${randomBytes(4).toString("hex")}`,
        email: normalizedEmail,
        displayName: displayName.trim(),
        password,
        emailVerified: false,
        verificationToken,
        verificationExpiresAt: Date.now() + VERIFICATION_TTL_MS,
    };
    registerUser(user);
    return { user: toAuthUser(user), verificationToken };
}
export function verifyEmailByToken(token) {
    const trimmed = token.trim();
    if (!trimmed) {
        throw new Error("Lien de vérification invalide");
    }
    const user = usersByVerificationToken.get(trimmed);
    if (!user) {
        throw new Error("Lien de vérification invalide ou déjà utilisé");
    }
    if (user.verificationExpiresAt != null && Date.now() > user.verificationExpiresAt) {
        throw new Error("Ce lien a expiré. Demandez un nouvel email de vérification.");
    }
    user.emailVerified = true;
    clearVerificationToken(user);
    return toAuthUser(user);
}
export function resendVerificationForEmail(email) {
    const user = usersByEmail.get(email.trim().toLowerCase());
    if (!user || user.emailVerified) {
        return null;
    }
    clearVerificationToken(user);
    user.verificationToken = createVerificationToken();
    user.verificationExpiresAt = Date.now() + VERIFICATION_TTL_MS;
    usersByVerificationToken.set(user.verificationToken, user);
    return { user: toAuthUser(user), verificationToken: user.verificationToken };
}
export function getUserById(userId) {
    const user = usersById.get(userId);
    if (!user)
        return null;
    return toAuthUser(user);
}
