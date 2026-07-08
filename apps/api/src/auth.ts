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
  const existing = await prisma.user.findUnique({ where: { email: config.adminEmail } });
  if (existing) return existing;

  const passwordHash = await hashPassword(config.adminPassword);

  return prisma.user.create({
    data: {
      name: config.adminName,
      email: config.adminEmail,
      passwordHash,
      role: UserRole.ADMIN
    }
  });
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  const authUser: AuthUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  const options: SignOptions = { expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] };
  const token = jwt.sign(authUser, config.jwtSecret, options);
  return { user: authUser, token };
}

export function requireAuth(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Token não informado'), { statusCode: 401 });
  }

  const token = header.replace('Bearer ', '').trim();
  try {
    return jwt.verify(token, config.jwtSecret) as AuthUser;
  } catch {
    throw Object.assign(new Error('Token inválido ou expirado'), { statusCode: 401 });
  }
}

export function requireAdmin(request: FastifyRequest) {
  const user = requireAuth(request);
  if (user.role !== UserRole.ADMIN) {
    throw Object.assign(new Error('Permissão insuficiente'), { statusCode: 403 });
  }
  return user;
}
