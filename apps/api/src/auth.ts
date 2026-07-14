import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';
import { config } from './config.js';
import { prisma } from './db.js';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

type TokenPayload = {
  id: string;
};

export function safeUser(user: { id: string; name: string; email: string; role: UserRole; isActive?: boolean; createdAt?: Date; updatedAt?: Date }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    ...(user.isActive !== undefined ? { isActive: user.isActive } : {}),
    ...(user.createdAt ? { createdAt: user.createdAt } : {}),
    ...(user.updatedAt ? { updatedAt: user.updatedAt } : {})
  };
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function ensureAdminUser() {
  if (!config.bootstrapAdminEnabled) return null;

  const existing = await prisma.user.findUnique({ where: { email: config.adminEmail.toLowerCase() } });
  if (existing) return existing;

  const passwordHash = await hashPassword(config.adminPassword);

  return prisma.user.create({
    data: {
      name: config.adminName,
      email: config.adminEmail.toLowerCase(),
      passwordHash,
      role: UserRole.ADMIN
    }
  });
}

export async function login(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !user.isActive) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  const authUser: AuthUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  const options: SignOptions = {
    expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'],
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    subject: user.id
  };
  const token = jwt.sign({ id: user.id } satisfies TokenPayload, config.jwtSecret, options);
  return { user: authUser, token };
}

function readBearerToken(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Token não informado'), { statusCode: 401 });
  }

  return header.slice('Bearer '.length).trim();
}

export async function requireAuth(request: FastifyRequest): Promise<AuthUser> {
  const token = readBearerToken(request);

  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      issuer: config.jwtIssuer,
      audience: config.jwtAudience
    });

    if (typeof decoded === 'string' || typeof decoded.id !== 'string') {
      throw new Error('Payload inválido');
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, name: true, email: true, role: true, isActive: true }
    });

    if (!user?.isActive) {
      throw Object.assign(new Error('Usuário inativo ou inexistente'), { statusCode: 401 });
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error) throw error;
    throw Object.assign(new Error('Token inválido ou expirado'), { statusCode: 401 });
  }
}

export async function requireRole(request: FastifyRequest, allowedRoles: UserRole[]) {
  const user = await requireAuth(request);
  if (!allowedRoles.includes(user.role)) {
    throw Object.assign(new Error('Permissão insuficiente'), { statusCode: 403 });
  }
  return user;
}

export function requireAdmin(request: FastifyRequest) {
  return requireRole(request, [UserRole.ADMIN]);
}

export function requireEditor(request: FastifyRequest) {
  return requireRole(request, [UserRole.ADMIN, UserRole.EDITOR]);
}
